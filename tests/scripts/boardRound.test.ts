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
  /** どこで走っているか（`cloud` / `bridge`）。この周の一覧へそのまま載る。 */
  readonly env?: string;
}

interface World {
  readonly prs?: readonly Record<string, unknown>[];
  readonly issues?: readonly unknown[];
  readonly sessions?: readonly Session[];
  /** 一覧そのものを引けない周。 */
  readonly sessionsFail?: boolean;
  readonly ledger?: Record<string, string>;
  /** 手が空いたばかり（覚えがまだ無い）の形。既定は十分に空いたまま。 */
  readonly justIdle?: boolean;
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
  /** `describe-conflict.sh` が返す、ぶつかったファイルと相手。 */
  readonly conflict?: { readonly files: readonly string[]; readonly with: readonly number[] };
  /** 周が始まる時点で帳面に載っている行。 */
  readonly conflictLog?: string;
  /** 非0で終わらせる打ち手（スクリプトの名前）。 */
  readonly fails?: readonly string[];
  readonly ghFails?: boolean;
  /** `gh issue comment` だけが失敗する周（返す手が打てなかった形）。 */
  readonly commentFails?: boolean;
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
  /** `gh issue comment` が渡したファイルの中身。**消される前に読む**（打ち手が後片付けする）。 */
  readonly comments: readonly string[];
  /** 打った手の指紋。**手が空いた時刻の覚え（`idle:`）は含めない**——見るのは別の検査。 */
  readonly ledger: Record<string, string>;
  /** 手が空いた時刻の覚え。 */
  readonly idleMarks: Record<string, string>;
  /** 叩いたスクリプトへ足された環境変数（この周の一覧の在り処）。 */
  readonly envs: readonly (Record<string, string> | undefined)[];
  /** この周が書いた一覧。 */
  readonly liveTsv: string | undefined;
  /** ぶつかった実績の帳面（1行1件）。 */
  readonly conflicts: readonly Record<string, unknown>[];
}

const NOW = new Date('2026-09-05T02:00:00Z');

/** トレーラを載せたコミットの並び。**拾われるのは最後の1本**。 */
function commits(session: string) {
  return { nodes: [{ commit: { message: `題\n\nClaude-Session: https://claude.ai/code/${session}` } }] };
}

/**
 * 手が空いているセッションは、既定で**十分に空いたまま**として台帳へ置く（`board-move.mjs` の
 * `STALL_MINUTES`）。停滞を入口にする手はどれもそこを通るので、世界ごとに書くと書き忘れた世界
 * だけが黙って手を出さなくなる。空いたばかりの形を見たい検査は `justIdle` を立てる。
 */
const LONG_IDLE = '2026-09-04T02:00:00Z';

/** 台帳を、打った手の指紋と、手が空いた時刻の覚えに分ける。 */
function split(ledger: Record<string, string>) {
  const marks: Record<string, string> = {};
  const idleMarks: Record<string, string> = {};
  for (const [key, value] of Object.entries(ledger)) {
    (key.startsWith('idle:') ? idleMarks : marks)[key] = value;
  }
  return { ledger: marks, idleMarks };
}

function playRound(world: World = {}): Result {
  const stateDir = mkdtempSync(join(tmpdir(), 'unmapped-island-round-'));
  try {
    const idled: Record<string, string> = {};
    for (const session of world.sessions ?? []) {
      if (world.justIdle !== true && session.status !== 'SESSION_STATUS_RUNNING') {
        idled[`idle:${session.id}`] = LONG_IDLE;
      }
    }
    writeFileSync(join(stateDir, 'taken.json'), JSON.stringify({ ...idled, ...world.ledger }), 'utf-8');
    if (world.conflictLog !== undefined) {
      writeFileSync(join(stateDir, 'conflicts.jsonl'), world.conflictLog, 'utf-8');
    }

    const out: string[] = [];
    const calls: string[] = [];
    const ghCalls: string[] = [];
    const comments: string[] = [];

    const gh = (args: readonly string[]): string | undefined => {
      ghCalls.push(args.join(' '));
      if (world.ghFails === true) return undefined;
      const [first, second, third] = args;
      if (first === 'issue' && second === 'comment') {
        if (world.commentFails === true) return undefined;
        comments.push(readFileSync(args[args.indexOf('--body-file') + 1], 'utf-8'));
        return '';
      }
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

    const envs: (Record<string, string> | undefined)[] = [];
    const runScript = (
      name: string,
      args: readonly string[],
      options?: { capture?: boolean; env?: Record<string, string> },
    ) => {
      envs.push(options?.env);
      if (name === 'usage-record.sh') return { status: 0, stdout: '' };
      calls.push([name, ...args].join(' '));
      if ((world.fails ?? []).includes(name)) return { status: 1, stdout: '' };
      // 畳んでよいかの判定は持たない（それは `archive-session.sh` の仕事）。渡された相手について、
      // 決めた行を1本返すだけ。
      if (name === 'archive-session.sh' && options?.capture === true) {
        return { status: 0, stdout: `${world.archiveVerdict ?? 'ARCHIVED'} session_a\n` };
      }
      if (name === 'describe-conflict.sh') {
        const found = world.conflict ?? { files: [], with: [] };
        const lines = [
          ...found.files.map((path) => `FILE ${path}`),
          ...found.with.map((number) => `WITH ${number}`),
        ];
        return { status: 0, stdout: lines.length === 0 ? '' : `${lines.join('\n')}\n` };
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
    const livePath = join(stateDir, 'live-sessions.tsv');
    const conflictsPath = join(stateDir, 'conflicts.jsonl');
    return {
      ok,
      log: out.join('\n'),
      calls,
      gh: ghCalls,
      comments,
      ...split(existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf-8')) : {}),
      envs,
      liveTsv: existsSync(livePath) ? readFileSync(livePath, 'utf-8') : undefined,
      conflicts: existsSync(conflictsPath)
        ? readFileSync(conflictsPath, 'utf-8')
            .split('\n')
            .filter((line) => line !== '')
            .map((line) => JSON.parse(line))
        : [],
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

  // 返すのはコメントで、ラベルは `board-labels.yml` が付ける（2.15.3）。**盤面がラベルを直に
  // 触ると、返る道が2つに割れる**——ワーカーが自分で返す道と食い違っても、誰も気づけない。
  // **どの `env:` がどこを指すかは盤面が持つ**（2.16.1）ので、こちらは受け取った引数をそのまま
  // `dispatch-task.sh` の後ろへ足す。補足のファイルは一時的なもので、名前は毎回変わる。
  it('投入先を寄越された手は、その引数を付けて投入する', () => {
    const result = playRound({
      issues: [{ number: 9, labels: [{ name: 'task' }, { name: 'env:bridge' }], blockedBy: { nodes: [] } }],
    });

    expect(result.calls[0]).toMatch(/^dispatch-task\.sh 9 \S+ --bridge$/);
  });

  it('投入先が無ければ、引数を足さない', () => {
    const result = playRound({
      issues: [{ number: 9, labels: [{ name: 'task' }], blockedBy: { nodes: [] } }],
    });

    expect(result.calls[0]).toMatch(/^dispatch-task\.sh 9 \S+$/);
  });

  it('起こしても動かないワーカーの仕事を、コメントで人へ返す', () => {
    const result = playRound({
      issues: [{ number: 8, labels: [{ name: 'task' }], blockedBy: { nodes: [] } }],
      sessions: [idle('session_a', 'task-8')],
      ledger: { 'resume:session_a': 'stall:8' },
    });

    expect(result.gh.filter((call) => call.startsWith('issue comment'))).toHaveLength(1);
    expect(result.comments[0]?.split('\n')[0]).toBe('[返却] 起こしても手が動かなかった');
    expect(result.ledger).toEqual({ 'resume:session_a': 'returned:8' });
    // ラベルを触っていない。
    expect(result.gh.filter((call) => call.startsWith('issue edit'))).toEqual([]);
  });

  it('返せなかったら、指紋を残さない', () => {
    const result = playRound({
      issues: [{ number: 8, labels: [{ name: 'task' }], blockedBy: { nodes: [] } }],
      sessions: [idle('session_a', 'task-8')],
      ledger: { 'resume:session_a': 'stall:8' },
      commentFails: true,
    });

    expect(result.log).toContain('打てなかった: RETURN 8');
    expect(result.ledger).toEqual({ 'resume:session_a': 'stall:8' });
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

  // **ぶつかった実績を控える**（3.1）。盤面は同じファイルを書く issue を並べて投入するので、
  // 実際にぶつかった組を残しておかないと、`area:` の錠を足すべき資源が後から分からない。
  it('コンフリクトしたPRを、ぶつかったファイルと相手とともに帳面へ書く', () => {
    const result = playRound({
      prs: [pr(10, { mergeable: 'CONFLICTING' })],
      conflict: { files: ['docs/engine/GameElementDefinition.md'], with: [7] },
    });

    // 時刻は**この周のもの**（`board.now`）。台帳の `idle:` と同じ値なので、後から並べて読める。
    expect(result.conflicts).toEqual([
      {
        at: NOW.toISOString(),
        pr: 10,
        head: 'aaa111',
        files: ['docs/engine/GameElementDefinition.md'],
        with: [7],
      },
    ]);
    expect(result.log).toContain('ぶつかった: PR #10 docs/engine/GameElementDefinition.md … #7');
  });

  // 押し返されるまで盤面は `CONFLICTING` を返し続ける。**同じ差分を毎周書くと、数えたときに
  // 周の回数を数えることになる。**
  it('同じ差分のコンフリクトは、二度書かない', () => {
    const result = playRound({
      prs: [pr(10, { mergeable: 'CONFLICTING' })],
      conflictLog: `${JSON.stringify({ at: '古い', pr: 10, head: 'aaa111', files: [], with: [] })}\n`,
      conflict: { files: ['docs/x.md'], with: [7] },
    });

    expect(result.conflicts).toHaveLength(1);
    expect(result.calls).not.toContain('describe-conflict.sh 10');
  });

  // **併合し直せてしまったものは、空のまま書く。** `mergeable` は `main` が動くたびに古くなるので、
  // `CONFLICTING` と言われた差分が手元では綺麗に併合できることがある。**調べた結果であって失敗では
  // ない**ので、指紋を埋めて次の周から見ない。
  it('手元では併合できたPRは、空のまま帳面へ書いて、そう言う', () => {
    const result = playRound({
      prs: [pr(10, { mergeable: 'CONFLICTING' })],
      conflict: { files: [], with: [] },
    });

    expect(result.conflicts).toEqual([
      { at: NOW.toISOString(), pr: 10, head: 'aaa111', files: [], with: [] },
    ]);
    expect(result.log).toContain('PR #10 は手元では併合できた');
  });

  // **見るだけのつもりで測定を消さない。** 指紋を埋めると、その組は本番の周でも二度と記録されない。
  it('DRY_RUN の周は、ぶつかった実績を控えない', () => {
    const result = playRound({
      prs: [pr(10, { mergeable: 'CONFLICTING' })],
      conflict: { files: ['docs/x.md'], with: [7] },
      dryRun: true,
    });

    expect(result.conflicts).toEqual([]);
    expect(result.calls).toEqual([]);
  });

  // **調べられなかったものは書かない。** 指紋を埋めずに残して、次の周に調べ直す。
  it('ぶつかった中身を調べられなかった周は、帳面へ書かない', () => {
    const result = playRound({
      prs: [pr(10, { mergeable: 'CONFLICTING' })],
      fails: ['describe-conflict.sh'],
    });

    expect(result.conflicts).toEqual([]);
  });

  // 積まれたPRの `CONFLICTING` は、その base との衝突。`main` との衝突を調べる
  // `describe-conflict.sh` とは別物なので数えない。
  it('他のPRの上に積まれたPRのコンフリクトは数えない', () => {
    const result = playRound({
      prs: [pr(10, { mergeable: 'CONFLICTING', baseRefName: 'claude/under' })],
      conflict: { files: ['docs/x.md'], with: [7] },
    });

    expect(result.conflicts).toEqual([]);
    expect(result.calls).not.toContain('describe-conflict.sh 10');
  });

  it('DRY_RUN では、手を並べるだけで打たない', () => {
    const result = playRound({ prs: [pr(10, passed)], dryRun: true });

    expect(result.calls).toEqual([]);
    expect(result.log).toContain('打たない手: MERGE 10');
  });

  /**
   * **一覧はこの周に1回だけ引き、叩く相手へはファイルで渡す**（`.claude/board-design.md` 1.7）。
   * `list_sessions` は1000回/時で頭打ちになるので、要る側が別々に引くと盤面の回る速さがそこで決まる。
   */
  describe('この周の一覧を、叩くスクリプトへ渡す', () => {
    it('引いた一覧をファイルへ置き、在り処を環境変数で渡す', () => {
      const result = playRound({
        prs: [pr(10, passed)],
        sessions: [
          {
            id: 'session_a',
            status: 'SESSION_STATUS_RUNNING',
            bucket: 'B',
            tags: ['task-1', 'review-2'],
            env: 'cloud',
          },
        ],
      });

      expect(result.liveTsv).toBe('session_a\tSESSION_STATUS_RUNNING\tB\ttask-1,review-2\tcloud\n');
      for (const env of result.envs) expect(env?.LIVE_SESSIONS_TSV).toMatch(/live-sessions\.tsv$/);
    });

    // **`process.env` は書き換えない。** 同じプロセスで動く他の呼び手にも見えてしまう
    // （渡した覚えの無いところへ効き、試験は並ぶ順で落ちる）。
    it('自分のプロセスの環境変数は書き換えない', () => {
      expect(process.env.LIVE_SESSIONS_TSV).toBeUndefined();

      playRound({ prs: [pr(10, passed)] });

      expect(process.env.LIVE_SESSIONS_TSV).toBeUndefined();
    });
  });

  /**
   * **手が空いたのはいつからか**を覚える（`board-move.mjs` の `STALL_MINUTES`）。停滞を「空いて
   * いること」だけで読むと、手番の切れ目ごとに空くワーカーを毎回停滞と読む。
   */
  describe('手が空いた時刻を覚える', () => {
    const worker = (status: string) => ({
      id: 'session_a',
      status,
      bucket: 'SESSION_STATUS_BUCKET_WORKING',
      tags: ['task-8'],
    });
    const openTask = [{ number: 8, labels: [{ name: 'task' }], blockedBy: { nodes: [] } }];

    it('空いているセッションの、空いた時刻を残す', () => {
      const result = playRound({
        issues: openTask,
        sessions: [worker('SESSION_STATUS_IDLE')],
        justIdle: true,
      });

      expect(result.idleMarks['idle:session_a']).toBe(NOW.toISOString());
      // 覚えたばかりなので、まだ起こさない。
      expect(result.calls).toEqual([]);
    });

    // **動き出したら、覚えも「起こしたが動かなかった」の記録も嘘になる。** 残すと、次に空いた
    // 瞬間に起こす手順を飛ばして人へ返す。
    it('動き出したら、覚えと起こした記録を捨てる', () => {
      const result = playRound({
        issues: openTask,
        sessions: [worker('SESSION_STATUS_RUNNING')],
        ledger: { 'idle:session_a': LONG_IDLE, 'resume:session_a': 'stall:8' },
      });

      expect(result.idleMarks).toEqual({});
      expect(result.ledger['resume:session_a']).toBeUndefined();
    });

    // 人へ返した記録は、動き出しても消さない——返した issue は人が `判断待ち` を外すまで戻らない。
    it('人へ返した記録は、動き出しても残す', () => {
      const result = playRound({
        issues: openTask,
        sessions: [worker('SESSION_STATUS_RUNNING')],
        ledger: { 'resume:session_a': 'returned:8' },
      });

      expect(result.ledger['resume:session_a']).toBe('returned:8');
    });
  });
});
