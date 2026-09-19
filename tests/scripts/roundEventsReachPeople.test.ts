import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { publish } from '../../scripts/daemon/board-publish.mjs';
import { FAILED, PLAYED, SETTLED, round } from '../../scripts/daemon/board-round.mjs';
import { JOURNAL_TAIL_BYTES, journalPath, readRounds } from '../../scripts/daemon/board-state.mjs';
import { EVENT_WINDOW_HOURS, MOVE_RESULTS, issueBody } from '../../scripts/daemon/board.mjs';

/**
 * **周の出来事が、`~/daemon.log` の外へ届くこと**の検査（`agent-ops/board-design.md` 2.20.3）。
 *
 * 1周を回す側（`board-round.mjs`）と書き出す側（`board-publish.mjs`）は**別の周期で走る別の
 * プロセス**なので、**デーモンの台帳と帳面を通す以外に、周の出来事が人の見に来る場所へ届く道は
 * 無い。** ここが見るのはその道の通し——片方だけの検査（`boardRound.test.ts`・`board.test.ts`）は、
 * **書いた側と読む側が別の置き場を見ていても緑のまま**になる。
 *
 * **叩くのは本物の `publish`**（差し替えるのは `gh` と、セッションの一覧だけ）。渡す口を検査から
 * 埋めると、**デーモンが実際に通る既定の配線**が1本も見られない。
 */

const NOW = new Date('2026-09-05T02:00:00Z');

/** 1周を回すのに要る世界。**打てる手が1つも無い**ので、見たい手だけが出る。 */
interface World {
  readonly prs?: readonly Record<string, unknown>[];
  readonly issues?: readonly Record<string, unknown>[];
  readonly ledger?: Record<string, string>;
  /** 非0で終わらせる打ち手。 */
  readonly fails?: readonly string[];
  /** 人が手綱で止めているとして返す打ち手（終了コード3。`brake.sh`）。 */
  readonly braked?: readonly string[];
  /** セッションの一覧を引けない周（盤面を引けない側へ倒れる）。 */
  readonly sessionsFail?: boolean;
  /** マージ済みPRの一覧だけを引けない周（盤面は欠けるが、捨てはしない）。 */
  readonly mergedPrsFail?: boolean;
}

/** `main` の先頭の指紋。CIの色はこれで絞って引いたぶんだけが返る。 */
const MAIN_HEAD = 'e0e0e0e0';

/**
 * 掘り起こす係と見回る係は、**どの世界にも当たる**ので間隔の中に置く（`boardRound.test.ts` と
 * 同じ足場）。置かないと、見たい手の1手ぶんがそちらに埋まる。
 */
const SCAFFOLD = { 'cycle:dig': '2026-09-05T01:00:00Z', 'cycle:patrol': '2026-09-05T01:30:00Z' };

let stateDir: string;
let saved: string | undefined;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'unmapped-island-reach-'));
  // **書き出す側は `BOARD_STATE` から置き場を引く**（`board-state.mjs` の `boardState`）。ここを
  // 渡さずに叩くと、本物のデーモンの台帳を読みに行く。
  saved = process.env.BOARD_STATE;
  process.env.BOARD_STATE = stateDir;
});

afterEach(() => {
  if (saved === undefined) delete process.env.BOARD_STATE;
  else process.env.BOARD_STATE = saved;
  rmSync(stateDir, { recursive: true, force: true });
});

const gh =
  (world: World) =>
  (args: readonly string[], options?: { sayWhyNot?: (line: string) => void }): string | undefined => {
    const [first, second] = args;
    if ((first === 'issue' || first === 'pr') && second === 'comment') return '';
    if (first === 'issue' && second === 'edit') return '';
    if (first === 'pr' && second === 'list') {
      if (args.includes('merged') && world.mergedPrsFail === true) {
        // **道具が言った理由は呼び手へ渡る**（`spawn.mjs` の `sayWhyNot`）。本物と同じ形で返す。
        options?.sayWhyNot?.('gh pr list …: 引けない');
        return undefined;
      }
      return JSON.stringify(args.includes('merged') ? [] : (world.prs ?? []));
    }
    if (first === 'issue' && second === 'list') return JSON.stringify(world.issues ?? []);
    if (first === 'api' && second === 'repos/{owner}/{repo}/commits/main') return `${MAIN_HEAD}\n`;
    if (first === 'api' && second.startsWith('graphql')) {
      return JSON.stringify({ data: { repository: { pullRequests: { nodes: [] } } } });
    }
    if (first === 'api') {
      const query = new URLSearchParams(second.split('?')[1] ?? '');
      const runs =
        query.get('head_sha') === MAIN_HEAD ? [{ status: 'COMPLETED', conclusion: 'SUCCESS' }] : [];
      return JSON.stringify({ workflow_runs: runs });
    }
    return '';
  };

/** 1周回してから、常設の issue へ書き出す。返るのは**人が読む本文**。 */
async function roundThenPublish(world: World = {}): Promise<string> {
  await round({
    stateDir,
    dryRun: false,
    settleMinutes: 10,
    now: () => NOW,
    log: () => {},
    echo: () => {},
    warn: () => {},
    gh: gh(world),
    sessions: () => {
      if (world.sessionsFail === true) throw new Error('list_sessions: 失敗: HTTP 401');
      return [];
    },
    pendingDecisions: () => 0,
    unsummarizedAnalyses: () => 0,
    pendingRefAudit: () => false,
    runScript: (name: string) => {
      if ((world.fails ?? []).includes(name)) return { status: 1, stdout: '' };
      if ((world.braked ?? []).includes(name)) return { status: 3, stdout: '' };
      return { status: 0, stdout: '' };
    },
  });

  let written = '';
  await publish({
    gh: (args: readonly string[]) => {
      const at = args.indexOf('--body-file');
      if (at >= 0) written = readFileSync(args[at + 1] ?? '', 'utf-8');
      return '';
    },
    issue: '99',
    warn: () => {},
    // **一覧だけは差し替える**（`publish` は本文を組む側へ渡さないので、既定では本物を引きに行く）。
    body: (given) =>
      issueBody({
        ...given,
        gh: gh(world) as never,
        sessions: () => [],
        warn: () => {},
        now: NOW,
      }),
  });
  return written;
}

/** 台帳の足場を先に置いてから回す。 */
async function withLedger(ledger: Record<string, string>, world: World = {}): Promise<string> {
  writeFileSync(join(stateDir, 'taken.json'), JSON.stringify({ ...SCAFFOLD, ...ledger }), 'utf-8');
  return roundThenPublish(world);
}

describe('周の出来事は、人の見に来る場所へ届く', () => {
  // **2026-09-12 の形。** 盤面は20分以上まったく同じ覚え書きを出し続けたのに、常設の盤には
  // 1文字も出ず、赤い `main` を人が直すまで全部が止まった。
  it('配れない理由が、常設の盤面の本文に出る', async () => {
    const body = await withLedger(
      {},
      { issues: [{ number: 8, labels: [{ name: 'kind:task' }], blockedBy: { nodes: [] } }] },
    );

    expect(body).toContain('## 周の出来事');
    expect(body).toContain('向かう先(`goal:`)の無い kind:task がある');
  });

  // **盤面が欠けた周は、そのぶん出ない手がある**（後片付けも、スメルを拾う係も）。ここに出ないと、
  // **欠けたまま何時間も回り続ける**ことが誰にも見えない。
  it('この周の盤面が欠けている理由が、常設の盤面の本文に出る', async () => {
    const body = await withLedger({}, { mergedPrsFail: true });

    expect(body).toContain('**この周の盤面が欠けています**');
    expect(body).toContain('マージ済みPRを引けなかった');
    // **道具が言った理由まで届く**（1.7）。「引けなかった」だけでは直す先が渡らない。
    expect(body).toContain('gh pr list …: 引けない');
  });

  // **どの結果も届く。** 打てた手だけを出すと、**転んだ手が並んでいる周が「やることが無い周」と
  // 同じ顔になる。**
  it.each([
    // 人が通した緑のPR → `MERGE`。
    [PLAYED, ['通してよい'], {}, 'MERGE 打てた'],
    [FAILED, ['通してよい'], { fails: ['merge-pr.sh'] }, 'MERGE 打てなかった'],
    // 札の無い緑のPR → `REVIEW`。**投入の関門が止めた手は「転んだのではない」**（`brake.sh`）。
    [SETTLED, [], { braked: ['dispatch-review.sh'] }, 'REVIEW 打てなかった（答えは返っている）'],
  ])('打った手（%s）が、常設の盤面の本文に出る', async (_result, labels, world, shown) => {
    const green = {
      number: 10,
      isDraft: false,
      labels: labels.map((name) => ({ name })),
      mergeable: 'MERGEABLE',
      statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
      updatedAt: '2026-01-01T00:00:00Z',
      headRefOid: 'aaa111',
      body: 'Closes #9\n',
    };
    const body = await withLedger({}, { ...world, prs: [green] });

    expect(body).toContain(`| ${shown} | 1 |`);
  });

  // **結果が増えたら、人へ見せる語も要る。** 落とすと、その結果の手は帳面に載るのに**盤面には
  // 英語のまま出る**——打った側と見せる側で綴りが1つずれたことに、誰も気づけない。
  it('手の結果は、どれも人へ見せる語を持つ', () => {
    expect(new Set(Object.keys(MOVE_RESULTS))).toEqual(new Set([PLAYED, FAILED, SETTLED]));
  });

  // **窓のぶんが、末尾から読む量に収まっている。** 収まらないと、**窓の中の出来事が本文から静かに
  // 落ちる**——落ちたことは、出来事が1つも無い周と見分けが付かない。窓を広げるか周を速くしたら、
  // `JOURNAL_TAIL_BYTES` も見直す、をここで留める。
  it('窓のぶんの出来事は、末尾から読む量に収まる', () => {
    // 周の間隔は [`daemon.sh`](../../scripts/daemon/daemon.sh) が持つ。**写さずに引く**
    // ——写すと、向こうを速くした日にここだけ古い値で通る。
    const daemon = readFileSync(join(import.meta.dirname, '../../scripts/daemon/daemon.sh'), 'utf-8');
    const interval = Number(/INTERVAL="\$\{INTERVAL:-(\d+)\}"/.exec(daemon)?.[1]);
    expect(interval).toBeGreaterThan(0);

    const rounds = Math.ceil((EVENT_WINDOW_HOURS * 3600) / interval);
    const lines = Array.from(
      { length: rounds },
      (_, index) =>
        `${JSON.stringify({
          at: new Date(NOW.getTime() - index * interval * 1000).toISOString(),
          kind: 'move',
          move: 'RESUME',
          target: 'session_0123456789abcdefghijklmn',
          result: 'played',
        })}\n`,
    );
    writeFileSync(journalPath(stateDir), lines.join(''), 'utf-8');

    // **末尾から読んだぶんに、窓のいちばん古い1件が残っている。**
    expect(readRounds(stateDir)).toHaveLength(rounds);
    expect(lines.join('').length).toBeLessThanOrEqual(JOURNAL_TAIL_BYTES);
  });

  // **直った周に台帳の印は消える。** 帳面へ閉じていないと、2026-09-18 のように同じ日に331分
  // 止まっていても、後から見た者には在ったことすら分からない。
  it('閉じた「盤面を引けなかった区間」が、常設の盤面の本文に出る', async () => {
    const body = await withLedger({
      'unreadable:since': '2026-09-05T01:00:00Z',
      'unreadable:until': '2026-09-05T01:59:30Z',
      'unreadable:rounds': '23',
      'unreadable:reason': 'list_sessions: 失敗: HTTP 401',
    });

    expect(body).toContain(
      '| 2026-09-05T01:00:00Z | 2026-09-05T01:59:30Z | 23 | list_sessions: 失敗: HTTP 401 |',
    );
  });

  // **引けていない間も届く。** 引けない周にデーモンが打てる手は無いので（2.21.1）、人へ渡すのは
  // 「いつから・何周・道具が言った理由」まで。
  it('引けていない区間が、周の数と理由ごと本文に出る', async () => {
    const body = await withLedger({}, { sessionsFail: true });

    expect(body).toContain('**盤面を引けていません**');
    expect(body).toContain('1周');
    expect(body).toContain('list_sessions: 失敗: HTTP 401');
  });
});
