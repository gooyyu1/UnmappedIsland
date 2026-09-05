import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { round } from '../../scripts/agent/board-round.mjs';

/**
 * `scripts/agent/board-round.mjs` の検査。
 *
 * 手を決めるのは [`board-move.mjs`](../../scripts/agent/board-move.mjs)（検査は `boardMove.test.ts`）
 * なので、ここが守るのは**引くことと打つこと**——盤面を組み立てられること・1周に1手しか打たないこと・
 * 打てなかった手で周ごと止まらないこと・台帳が育っても回り続けること。
 *
 * **外を触る手は全部渡す**（`gh`・一覧・隣のスクリプト）ので、プロセスは1つも起きない。実物を
 * 起こしていた頃、この検査は1件あたり736msかかっていた（#1552）。
 */

interface Session {
  readonly id: string;
  readonly status: string;
  readonly bucket: string;
  readonly tags: readonly string[];
}

interface World {
  readonly prs?: readonly Record<string, unknown>[];
  readonly issues?: readonly unknown[];
  readonly sessions?: readonly Session[];
  /** 一覧そのものを引けない周。 */
  readonly sessionsFail?: boolean;
  readonly ledger?: Record<string, string>;
  /** `gh issue view <番号> --json state` が返す `state`。挙がっていない番号は引けない。 */
  readonly issueStates?: Readonly<Record<number, string | undefined>>;
  /** PRごとの、コミットの `Claude-Session:` トレーラが指すセッション。 */
  readonly prSessions?: Record<number, string>;
  /** そのトレーラを引く `gh api graphql` が失敗するか。 */
  readonly prSessionsFail?: boolean;
  /** `main` の先頭のCI。既定は緑。 */
  readonly mainChecks?: readonly { readonly status: string; readonly conclusion: string }[];
  /** `archive-session.sh` が渡された相手について返す行の頭。既定は畳めた。 */
  readonly archiveVerdict?: 'ARCHIVED' | 'KEPT' | 'UNARCHIVED';
  /** 非0で終わらせる打ち手（スクリプトの名前）。 */
  readonly fails?: readonly string[];
  readonly ghFails?: boolean;
  readonly dryRun?: boolean;
}

interface Result {
  /** 盤面を引けたか。 */
  readonly ok: boolean;
  /** ログと、叩いたスクリプトの出力を並べたもの。 */
  readonly log: string;
  /** 打つ側の道具の呼び出し。**使用量の記録は毎周かならず走るので、手には数えない。** */
  readonly calls: readonly string[];
  /** `gh` に渡された引数。閉じた issue を引きに行った回数を見るのに使う。 */
  readonly gh: readonly string[];
  readonly ledger: Record<string, string>;
}

const NOW = new Date('2026-09-05T02:00:00Z');

/** トレーラを載せたコミットの並び。**拾われるのは最後の1本**。 */
function commits(session: string) {
  return { nodes: [{ commit: { message: `題\n\nClaude-Session: https://claude.ai/code/${session}` } }] };
}

function playRound(world: World = {}): Result {
  const stateDir = mkdtempSync(join(tmpdir(), 'unmapped-island-round-'));
  try {
    if (world.ledger !== undefined) {
      writeFileSync(join(stateDir, 'taken.json'), JSON.stringify(world.ledger), 'utf-8');
    }

    const out: string[] = [];
    const calls: string[] = [];
    const ghCalls: string[] = [];

    const gh = (args: readonly string[]): string | undefined => {
      ghCalls.push(args.join(' '));
      if (world.ghFails === true) return undefined;
      const [first, second, third] = args;
      if (first === 'pr' && second === 'list') return JSON.stringify(world.prs ?? []);
      if (first === 'issue' && second === 'list') return JSON.stringify(world.issues ?? []);
      if (first === 'issue' && second === 'view') {
        const state = (world.issueStates ?? {})[Number(third)];
        return state === undefined ? undefined : `${state}\n`;
      }
      if (first === 'api' && second === 'graphql') {
        if (world.prSessionsFail === true) return undefined;
        const nodes = Object.entries(world.prSessions ?? {}).map(([number, session]) => ({
          number: Number(number),
          commits: commits(session),
        }));
        return JSON.stringify({ data: { repository: { pullRequests: { nodes } } } });
      }
      return JSON.stringify({
        check_runs: world.mainChecks ?? [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
      });
    };

    const runScript = (name: string, args: readonly string[], options?: { capture?: boolean }) => {
      if (name === 'usage-record.sh') return { status: 0, stdout: '' };
      calls.push([name, ...args].join(' '));
      if ((world.fails ?? []).includes(name)) return { status: 1, stdout: '' };
      // 畳んでよいかの判定は持たない（それは `archive-session.sh` の仕事）。渡された相手について、
      // 決めた行を1本返すだけ。
      if (name === 'archive-session.sh' && options?.capture === true) {
        return { status: 0, stdout: `${world.archiveVerdict ?? 'ARCHIVED'} session_a\n` };
      }
      return { status: 0, stdout: '' };
    };

    const ok = round({
      stateDir,
      dryRun: world.dryRun ?? false,
      settleMinutes: 10,
      now: () => NOW,
      log: (line: string) => out.push(line),
      echo: (text: string) => out.push(text.trimEnd()),
      warn: (line: string) => out.push(line),
      gh,
      sessions: () => {
        if (world.sessionsFail === true) throw new Error('セッションの一覧を引けなかった');
        return world.sessions ?? [];
      },
      runScript,
    });

    const ledgerPath = join(stateDir, 'taken.json');
    return {
      ok,
      log: out.join('\n'),
      calls,
      gh: ghCalls,
      ledger: existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf-8')) : {},
    };
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
}

/** 緑のPR。本文の `Closes` は、直しの相手を引くのに使われる。 */
function pr(number: number, over: Record<string, unknown> = {}) {
  return {
    number,
    isDraft: false,
    labels: [],
    mergeable: 'MERGEABLE',
    statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
    updatedAt: '2026-01-01T00:00:00Z',
    headRefOid: 'aaa111',
    body: `Closes #${number - 1}\n`,
    ...over,
  };
}

const passed = { labels: [{ name: '通してよい' }] };

/** 手が空いているセッション。**`status_bucket` は固まることがある**ので、そちらは動いた形のまま。 */
const idle = (id: string, ...tags: string[]): Session => ({
  id,
  status: 'SESSION_STATUS_IDLE',
  bucket: 'SESSION_STATUS_BUCKET_WORKING',
  tags,
});
const working = (id: string, ...tags: string[]): Session => ({
  id,
  status: 'SESSION_STATUS_RUNNING',
  bucket: 'SESSION_STATUS_BUCKET_WORKING',
  tags,
});

describe('board-round.mjs', () => {
  it('打つのは1周に1手だけ', () => {
    const result = playRound({ prs: [pr(10, passed), pr(20, passed)] });

    expect(result.calls).toEqual(['merge-and-close.sh 10']);
  });

  // 打てなかった手で周ごと止めると、止まっている種類と関係のない手まで巻き添えになる。
  it('打てなかった手の次へ進む', () => {
    const result = playRound({ prs: [pr(10, passed), pr(20)], fails: ['merge-and-close.sh'] });

    expect(result.calls).toEqual(['merge-and-close.sh 10', 'dispatch-review.sh 20']);
  });

  it('打った手は、そのときの指紋とともに台帳へ残る', () => {
    const result = playRound({ prs: [pr(10)] });

    expect(result.calls).toEqual(['dispatch-review.sh 10']);
    expect(result.ledger).toEqual({ 'review:10': 'aaa111' });
  });

  // 残すと、番号が回り込んだときに古い指紋が効く。
  it('消えたPRと畳まれたセッションの記録は、台帳から捨てる', () => {
    const result = playRound({
      prs: [pr(10)],
      sessions: [working('session_a', 'task-9')],
      ledger: { 'review:10': 'aaa111', 'review:99': 'zzz999', 'resume:session_gone': 'stall:5' },
    });

    expect(result.ok).toBe(true);
    expect(result.ledger).toEqual({ 'review:10': 'aaa111' });
  });

  // 畳む条件は担当の issue が閉じたこと（2.10）。**PRがマージされたかでは決めない**ので、PRが
  // 1本も無くても畳む。
  it('担当の issue が閉じたワーカーを畳む', () => {
    const result = playRound({
      sessions: [idle('session_a', 'task-8')],
      issueStates: { 8: 'CLOSED' },
    });

    expect(result.calls).toEqual(['archive-session.sh --keep-untagged task-,review-']);
    expect(result.log).toContain('ARCHIVED session_a');
    // 畳めたので、台帳へは残さない（相手も次の周には消える）。
    expect(result.ledger).toEqual({});
  });

  // `KEPT` は「畳んではいけない」という安定した答え。残さないと、1周1手のうちの1手がこれで埋まり続ける。
  it('畳めない相手だと分かったら、指紋を残して次の周は打たない', () => {
    const result = playRound({
      sessions: [idle('session_a', 'task-8')],
      issueStates: { 8: 'CLOSED' },
      archiveVerdict: 'KEPT',
    });

    expect(result.log).toContain('KEPT session_a');
    expect(result.ledger).toEqual({ 'archive:session_a': 'closed:8' });
  });

  // 失敗は答えではないので、次の周にもう一度試す。
  it('畳もうとして失敗したら、指紋を残さない', () => {
    const result = playRound({
      sessions: [idle('session_a', 'task-8')],
      issueStates: { 8: 'CLOSED' },
      archiveVerdict: 'UNARCHIVED',
    });

    expect(result.calls).toEqual(['archive-session.sh --keep-untagged task-,review-']);
    expect(result.ledger).toEqual({});
  });

  // 探すのはワーカーの側から（2.10）。開いている一覧に載っているぶんは既に盤面が持っているので、
  // 引き直さない。
  it('開いている issue を担当しているワーカーのぶんは、issue を引き直さない', () => {
    const result = playRound({
      issues: [{ number: 8, labels: [{ name: 'task' }], blockedBy: { nodes: [] } }],
      sessions: [working('session_a', 'task-8')],
    });

    expect(result.gh.filter((call) => call.startsWith('issue view'))).toEqual([]);
  });

  // 差し戻す相手はコミットのトレーラで引く（2.11）。`task-` のタグではない——`Closes` は
  // どの issue が閉じるかの印であって、誰が書いたかを指していない。
  it('差し戻す相手を、コミットのトレーラが指すセッションから引く', () => {
    const result = playRound({
      prs: [pr(10, { statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] })],
      prSessions: { 10: 'session_writer' },
      sessions: [idle('session_writer'), idle('session_holder', 'task-9')],
    });

    expect(result.calls).toEqual(['resume-session.sh session_writer mend 10']);
  });

  // `main` の色が盤面へ載っていなければ、判定の側は緑と読んで差し戻してしまう（2.14）。
  // **止まることを見るのは、載っていることを見ること。**
  it('main が赤い周は、直しの手を打たない', () => {
    const result = playRound({
      mainChecks: [{ status: 'COMPLETED', conclusion: 'FAILURE' }],
      prs: [pr(10, { statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] })],
      prSessions: { 10: 'session_writer' },
      sessions: [idle('session_writer')],
    });

    expect(result.calls).toEqual([]);
  });

  // 引けない日に盤面ごと落とすと、差し戻し以外の手まで止まる。
  it('トレーラを引けなかった周も、他の手は打つ', () => {
    const result = playRound({ prs: [pr(10, passed)], prSessionsFail: true });

    expect(result.ok).toBe(true);
    expect(result.log).toContain('差し戻す相手を引けなかった');
    expect(result.calls).toEqual(['merge-and-close.sh 10']);
  });

  // 一覧が欠けると**占有が全部「無い」に見えて投入が止まらない**——2026-09-05 に、書くセッションが
  // 6本立った。引けなかった周は、止まる側へ倒す。
  it('セッションの一覧を引けなかった周は、手を1つも打たない', () => {
    const result = playRound({ prs: [pr(10, passed)], sessionsFail: true });

    expect(result.ok).toBe(false);
    expect(result.calls).toEqual([]);
  });

  it('盤面を引けなかった周は、手を1つも打たない', () => {
    const result = playRound({ prs: [pr(10, passed)], ghFails: true });

    expect(result.ok).toBe(false);
    expect(result.calls).toEqual([]);
  });

  it('DRY_RUN では、手を並べるだけで打たない', () => {
    const result = playRound({ prs: [pr(10, passed)], dryRun: true });

    expect(result.calls).toEqual([]);
    expect(result.log).toContain('打たない手: MERGE 10');
  });
});
