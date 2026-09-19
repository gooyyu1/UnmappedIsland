import { describe, expect, it } from 'vitest';

import { FIRST_ISSUE_PULL } from '../../scripts/daemon/board-read.mjs';
import { board, issueBody } from '../../scripts/daemon/board.mjs';

/**
 * `scripts/daemon/board.mjs` の検査。
 *
 * ここが守るのは**突き合わせ**——`kind:task` の issue に「もう投入したか」「何に塞がれているか」が
 * 正しく付くこと、棚卸しの済んでいない issue だけが `未整理` に出ること。並べ方を間違えると、
 * 盤面を読んだ側は同じ issue を二重に投入するか、着手できる仕事を待ちだと読んで止める。
 *
 * 出口は端末（`board`）と常設 issue の本文（`issueBody`。`agent-ops/board-design.md` 2.20）の2つで、
 * **突き合わせは1箇所**。どちらの検査も同じ世界を渡して、同じ事実が両方に出ることを見る。
 */

interface LiveSession {
  readonly id: string;
  readonly status: string;
  readonly bucket: string;
  readonly env: string;
  /** 走る者が一度でも付いたか（`live-sessions.mjs` の `served`）。 */
  readonly served: boolean;
  readonly tags: readonly string[];
}

interface World {
  readonly prs?: readonly Record<string, unknown>[];
  readonly issues?: readonly Record<string, unknown>[];
  readonly sessions?: readonly LiveSession[];
  /** 一覧を引けない（[`live-sessions.mjs`](../../scripts/daemon/live-sessions.mjs) は投げる）。 */
  readonly sessionsFail?: boolean;
  readonly checked?: string;
  /** 盤面を引けていない区間（デーモンの台帳。`board-state.mjs` の `readUnreadable`）。 */
  readonly unreadable?: { since: string; until: string; rounds: number; reason: string };
  /** 今その周に出ている、配れない理由と、出始めた時刻（同 `readNotes`）。 */
  readonly blockedNotes?: readonly { text: string; since: string }[];
  /** 今その周の盤面が欠けている理由（同 `readPartialNotes`）。 */
  readonly partialNotes?: readonly string[];
  /** 周の出来事の帳面（同 `readRounds`）。 */
  readonly events?: readonly Record<string, unknown>[];
  /** 最後の見回り（デーモンの記録。`board-state.mjs` の `readLastPatrol`）。 */
  readonly patrol?: { at: string; verdict: string; summary: string };
  /** 見回りの記録が無い（走っていないか、読めない）。 */
  readonly patrolMissing?: boolean;
  /**
   * PR番号 → そのPRが名乗ったセッション（コミットの `Claude-Session:` トレーラ）。**既定は
   * 「どのPRも名乗っていない」**——`## 宛先の無いPR` を見る検査だけがここを組む。
   */
  readonly claims?: Readonly<Record<number, string>>;
  /** 名乗りを引けない（`board-read.mjs` の `readPrSessions` が `undefined` を返す）。 */
  readonly claimsFail?: boolean;
}

const deps = (world: World, warn: (line: string) => void) => ({
  // **`--limit` を実際に守る。** 守らない `gh` を渡すと、切られる形そのものが検査に出ない
  // ——いくつ渡しても全部が返るので、上限を固定へ戻しても緑のまま。
  gh: (args: readonly string[], options?: { sayWhyNot?: (line: string) => void }) => {
    if (args[0] === 'api') {
      if (world.claimsFail === true) {
        // **道具が言った理由は呼び手へ渡る**（`spawn.mjs` の `sayWhyNot`）。本物と同じ形で返す。
        options?.sayWhyNot?.('gh api graphql: 引けない');
        return undefined;
      }
      const nodes = Object.entries(world.claims ?? {}).map(([number, id]) => ({
        number: Number(number),
        commits: {
          nodes: [{ commit: { message: `直した理由。\n\nClaude-Session: https://claude.ai/code/${id}` } }],
        },
      }));
      return JSON.stringify({ data: { repository: { pullRequests: { nodes } } } });
    }
    if (args[0] === 'pr') return JSON.stringify(world.prs ?? []);
    const limit = Number(args[args.indexOf('--limit') + 1]);
    return JSON.stringify((world.issues ?? []).slice(0, limit));
  },
  sessions: () => {
    if (world.sessionsFail === true) throw new Error('セッションの一覧を引けなかった');
    return world.sessions ?? [];
  },
  warn,
});

async function show(world: World = {}): Promise<{ lines: string[]; warnings: string[] }> {
  const warnings: string[] = [];
  const lines = await board({
    ...deps(world, (line: string) => warnings.push(line)),
    checkedItems: () => world.checked ?? '',
  });
  return { lines: lines ?? [], warnings };
}

/** 常設 issue の本文。行で見たいので分けて返す。 */
async function body(world: World = {}): Promise<{ lines: string[]; warnings: string[] }> {
  const warnings: string[] = [];
  const text = await issueBody({
    ...deps(world, (line: string) => warnings.push(line)),
    now: new Date('2026-09-07T03:04:05.678Z'),
    unreadable: world.unreadable,
    blockedNotes: world.blockedNotes,
    partialNotes: world.partialNotes,
    events: world.events,
    // **見回りは、既定でたった今届いたことにする。** 断りは出る側なので、既定のままだと
    // 見回りと関わりのない検査の本文へ一律に1行増える。
    patrol:
      world.patrolMissing === true
        ? undefined
        : (world.patrol ?? { at: '2026-09-07T03:00:00Z', verdict: '異常なし', summary: '' }),
  });
  return { lines: (text ?? '').split('\n'), warnings };
}

const issue = (number: number, title: string, over: Record<string, unknown> = {}) => ({
  number,
  title,
  // **棚卸しを通った issue は向かう先を持つ**（`agent-ops/board-design.md` 2.17.1）ので、足場も
  // その形にする。足さないと、向かう先と関わりのない検査の `## 未整理` に issue が並ぶ。
  labels: [{ name: 'kind:task' }, { name: 'goal:upkeep' }],
  blockedBy: { nodes: [] },
  ...over,
});

/**
 * 畳まれていないセッション1件（`live-sessions.mjs` が返す形）。**何をしているかはタグで引く**
 * （`agent-ops/board-design.md` 1.2）——題は一覧に含まれない。
 */
const session = (id: string, tags: readonly string[] = []): LiveSession => ({
  id,
  status: 'SESSION_STATUS_RUNNING',
  bucket: 'SESSION_STATUS_BUCKET_WORKING',
  env: 'cloud',
  served: true,
  tags,
});

describe('board.mjs', () => {
  it('引けなければ、何も並べない', async () => {
    await expect(board({ gh: () => undefined, sessions: () => [], warn: () => {} })).resolves.toBeUndefined();
  });

  // 切られるのは古い側なので、**黙って切ると「そんな issue は無い」と同じ形**になる。担当の居る
  // task が消えた実績がある（2026-09-11、#1722）。**人の読む窓もデーモンと同じ手で引く**ので、
  // ここが切られると、盤面には載っているのに人からだけ消える帯ができる。
  it('1回で引きにいく数を超えて開いていても、1件も落ちない', async () => {
    // **並びは本物と同じ作成の新しい順**（番号の大きい側が先）。逆に並べると、切られるのが
    // いちばん新しい issue になり、**現に起きた壊れ方とは別のものを見る検査**になる。
    const count = FIRST_ISSUE_PULL + 2;
    const many = Array.from({ length: count }, (_, index) => issue(count - index, `見出し${count - index}`));
    const tasks = (await show({ issues: many })).lines.filter((line) => line.startsWith('TASK '));
    expect(tasks).toHaveLength(count);
    // **いちばん古い側が残っていることを名指しで見る。** 件数だけだと、切られた側がどこかを
    // 取り違えたまま緑になりうる。
    expect(tasks.at(-1)).toContain('TASK 1 ');
  });

  it('節は、中身が無くても出る', async () => {
    expect((await show()).lines).toEqual([
      '## 確定待ち',
      '（無し）',
      '## PR',
      '## TASK',
      '## 未整理',
      '（無し）',
      '## 走行',
      '（無し）',
    ]);
  });

  it('チェックの付いた項目を、確定待ちとして並べる', async () => {
    const { lines } = await show({ checked: '656 世界の広さは 3km 四方\n' });

    expect(lines).toContain('確定待ち 656 世界の広さは 3km 四方');
  });

  it('PRは、CIの色とマージ可否とラベルを添えて並べる', async () => {
    const { lines } = await show({
      prs: [
        {
          number: 10,
          title: '題',
          labels: [{ name: '通してよい' }, { name: '判断待ち' }],
          statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }],
          mergeable: 'MERGEABLE',
          baseRefName: 'main',
          body: '',
        },
      ],
    });

    expect(lines).toContain('PR 10 赤 マージ可 main 通してよい,判断待ち 題');
  });

  // チェックが1本も登録されないPRがある（`tests.yml` の `paths` に当たらない差分）。**「緑」とは
  // 言わない**——盤面が緑と読むかは落ち着いてからで、そちらの判定は `board-move.mjs` が持つ。
  it('チェックが1本も無いPRは、そう書く', async () => {
    const { lines } = await show({
      prs: [{ number: 10, title: '題', labels: [], statusCheckRollup: [], mergeable: 'UNKNOWN' }],
    });

    expect(lines).toContain('PR 10 チェック無 不明 main - 題');
  });

  it('`task-<番号>` のタグを持つセッションが在れば、投入済みと出す', async () => {
    const { lines } = await show({
      issues: [issue(8, '直す')],
      sessions: [session('session_a', ['task-8'])],
    });

    expect(lines).toContain('TASK 8 投入済み 直す');
  });

  // 引くのは**その issue のタグ**だけ（1.2）。他の仕事で走っている1本を投入済みと読むと、着手できる
  // 仕事が誰にも配られないまま止まる。
  it('別の仕事のセッションが走っていても、投入済みにしない', async () => {
    const { lines } = await show({
      issues: [issue(8, '直す')],
      sessions: [session('session_a', ['task-9']), session('session_b', ['review-10'])],
    });

    expect(lines).toContain('TASK 8 着手可 直す');
  });

  it('開いているPRが閉じる issue も、投入済みと出す', async () => {
    const { lines } = await show({
      issues: [issue(8, '直す')],
      prs: [{ number: 10, title: '題', labels: [], statusCheckRollup: [], body: 'Closes #8\n' }],
    });

    expect(lines).toContain('TASK 8 投入済み 直す');
  });

  // **`blockedBy` は issue 1件につき1回の `gh api` が要るぶん省かれやすい。** 塞いでいた issue が
  // 閉じても誰も気づかないと、着手できる仕事が止まったままになる。
  it('開いている依存があれば、待ちとして出す', async () => {
    const { lines } = await show({
      issues: [
        issue(8, '後', {
          blockedBy: {
            nodes: [
              { number: 7, state: 'CLOSED' },
              { number: 9, state: 'OPEN' },
            ],
          },
        }),
      ],
    });

    expect(lines).toContain('TASK 8 待ち:#9 後');
  });

  // 返された issue は `kind:task` が付いたまま残る（`agent-ops/board-design.md` 2.15.2）ので、状態で
  // 見分けが付かないと、人は列に並んでいるものと区別できない。
  it('人へ返された issue は、返却として出す', async () => {
    const { lines } = await show({
      issues: [
        issue(8, '決められない', {
          labels: [{ name: 'kind:task' }, { name: 'goal:upkeep' }, { name: '判断待ち' }],
        }),
      ],
    });

    expect(lines).toContain('TASK 8 返却 決められない');
  });

  // 走らせる先の指定は状態と別の軸（2.16）なので、状態を潰さずに後ろへ並べる。
  it('走らせる先の指定があれば、状態の後ろに出す', async () => {
    const { lines } = await show({
      issues: [
        issue(8, '盤面を直す', {
          labels: [{ name: 'kind:task' }, { name: 'goal:upkeep' }, { name: 'env:bridge' }],
        }),
      ],
    });

    expect(lines).toContain('TASK 8 着手可 env:bridge 盤面を直す');
  });

  it('依存が閉じていれば、着手可として出す', async () => {
    const { lines } = await show({
      issues: [issue(8, '後', { blockedBy: { nodes: [{ number: 7, state: 'CLOSED' }] } })],
    });

    expect(lines).toContain('TASK 8 着手可 後');
  });

  // **未整理は棚卸しの結論（`kind:` と `goal:`）が揃っていないことで表す**（2.17.1。否定の列挙では
  // 表さない）。依存が張ってあっても、棚卸しが分類を付けて出るので外す必要は無い。**常設の盤に
  // 向かう先は要らない**——投入する先が無いので。
  it('未整理に出るのは、棚卸しの結論が揃っていない issue', async () => {
    const { lines } = await show({
      issues: [
        issue(1, '結論が揃っている'),
        issue(2, '常設の盤', { labels: [{ name: 'kind:board' }] }),
        issue(3, '束ねた側', {
          labels: [{ name: 'kind:task' }, { name: 'goal:upkeep' }],
          blockedBy: { nodes: [{ number: 9, state: 'OPEN' }] },
        }),
        issue(4, '人の言葉のまま', { labels: [] }),
        issue(5, '分類の無い bug', { labels: [{ name: 'bug' }] }),
        issue(6, '向かう先がまだ', { labels: [{ name: 'kind:task' }] }),
      ],
    });

    expect(lines.filter((line) => line.startsWith('未整理 '))).toEqual([
      '未整理 4 - 人の言葉のまま',
      '未整理 5 bug 分類の無い bug',
      '未整理 6 kind:task 向かう先がまだ',
    ]);
  });

  // 何をしているかはタグで読む。**畳まれたものを外すのも、繰るのも `live-sessions.mjs`**（検査は
  // `liveSessions.test.ts`）なので、ここが見るのは並べ方だけ。
  it('走行は、走っている場所とタグを添えて並べる', async () => {
    const { lines } = await show({
      sessions: [
        session('session_a', ['task-8']),
        { ...session('session_b', []), env: 'bridge', status: 'SESSION_STATUS_IDLE' },
      ],
    });

    expect(lines.filter((line) => line.startsWith('走行 '))).toEqual([
      '走行 session_a RUNNING cloud task-8',
      '走行 session_b IDLE bridge -',
    ]);
  });

  it('一覧を引けなければ、投入済みの判定はPRだけで行うと断る', async () => {
    const { lines, warnings } = await show({ issues: [issue(8, '直す')], sessionsFail: true });

    expect(warnings).toEqual(['（セッションの一覧を引けなかった。投入済みの判定はPRだけで行う）']);
    expect(lines).toContain('TASK 8 着手可 直す');
  });
});

/**
 * 常設 issue の本文（`agent-ops/board-design.md` 2.20）。**読むのはスマホの人間**で、リポジトリも
 * ログも開かないので、ここが守るのは**本文だけで読み切れること**——いつ時点か・何件あるか・
 * 投入した1件ごとに今何が起きているか。
 */
describe('issueBody', () => {
  it('引けなければ、本文を作らない', async () => {
    await expect(
      issueBody({ gh: () => undefined, sessions: () => [], warn: () => {} }),
    ).resolves.toBeUndefined();
  });

  // **写しを持ってよいのは、いつ時点かを一緒に書くから**（2.20.1）。時刻が伸びないことが、
  // そのまま「デーモンが動いていない」を告げる。
  it('最終更新の時刻を書く', async () => {
    expect((await body()).lines).toContain('最終更新 2026-09-07T03:04:05Z');
  });

  // **盤面を引けない周に、デーモンにできるのはこれだけ**（2.21）。直せるのは Claude Code 本体を
  // 触れる人だけで、`~/daemon.log` を読めるのは手元で叩ける人だけ——**届く先はここしか無い。**
  it('盤面を引けていなければ、続いた長さと周の数と、道具が言った理由を添えて断る', async () => {
    const { lines } = await body({
      unreadable: {
        since: '2026-09-07T01:19:05Z',
        until: '2026-09-07T03:04:00Z',
        rounds: 51,
        reason: 'list_sessions: 失敗: HTTP 401 OAuth access token has expired.',
      },
    });

    expect(lines).toContain(
      '⚠ **盤面を引けていません**（2026-09-07T01:19:05Z から 1時間45分・51周）。GitHub か CCR から引けない周が続いています——**直せるのは人だけ**で、この間セッションは1本も立ちません。道具が言った理由: list_sessions: 失敗: HTTP 401 OAuth access token has expired.',
    );
  });

  it('引けている盤面には、断りを出さない', async () => {
    expect((await body()).lines.join('\n')).not.toContain('盤面を引けていません');
  });

  // 出どころは台帳のテキストなので、壊れていることがありうる。**壊れた値で嘘の長さを出さない。**
  it('読めない時刻なら、断りを出さない', async () => {
    const broken = { since: 'ゆうべ', until: 'ゆうべ', rounds: 1, reason: '' };

    expect((await body({ unreadable: broken })).lines.join('\n')).not.toContain('盤面を引けていません');
  });

  // ## 周の出来事（2.20.3）
  //
  // **届く先はここしか無い。** 1周を回す側が書くのは `~/daemon.log` で、**それを定期的に読む者は
  // 居ない**——2026-09-12 には、盤面が20分以上まったく同じ覚え書きを出し続けたのに、常設の盤には
  // 1文字も出なかった。

  it('配れない理由を、続いている長さとともに出す', async () => {
    const { lines } = await body({
      blockedNotes: [
        {
          text: 'PR #2063 はコンフリクトしているが、main が赤いので直しを頼まない',
          since: '2026-09-07T02:44:05Z',
        },
      ],
    });

    expect(lines).toContain('## 周の出来事');
    expect(lines).toContain('| PR #2063 はコンフリクトしているが、main が赤いので直しを頼まない | 20分 |');
  });

  // **盤面が欠けた周は、そのぶん出ない手がある。** ここに出ないと、**後片付けも係も出ないまま
  // 何時間も回り続ける**ことが誰にも見えない。
  it('この周の盤面が欠けている理由を、別の表で出す', async () => {
    const { lines } = await body({
      blockedNotes: [{ text: '3件の task が錠待ち', since: '2026-09-07T02:44:05Z' }],
      partialNotes: ['マージ済みPRを引けなかった（この周は、後片付けもスメルを拾う係も出ない）'],
    });

    expect(lines).toContain('**この周の盤面が欠けています**（そのぶん、出ない手があります）');
    expect(lines).toContain('| マージ済みPRを引けなかった（この周は、後片付けもスメルを拾う係も出ない） |');
    // **配れない理由の表とは分ける**（読む人がすることが違う。`board-state.mjs` の `PARTIAL_PREFIX`）。
    expect(lines).toContain('| 3件の task が錠待ち | 20分 |');
  });

  // **件数そのものが合図になる手がある**（`RETURN` が一度に何件出たか）。1件ずつは issue の側に
  // 出るが、**その回に何件返ったかは、ここに出るまで誰も数えない。**
  it('打った手を、結果ごとに数えて出す', async () => {
    const { lines } = await body({
      events: [
        { at: '2026-09-07T02:00:00Z', kind: 'move', move: 'RETURN', target: '1950', result: 'played' },
        { at: '2026-09-07T02:10:00Z', kind: 'move', move: 'RETURN', target: '1951', result: 'played' },
        { at: '2026-09-07T02:20:00Z', kind: 'move', move: 'MERGE', target: '2063', result: 'failed' },
      ],
    });

    expect(lines).toContain('| RETURN 打てた | 2 |');
    expect(lines).toContain('| MERGE 打てなかった | 1 |');
  });

  // **直った周に台帳の印は消える**ので、閉じた区間が帳面に残っていないと、**後から見た者には
  // 在ったことすら分からない**（2026-09-18 に実測。同じ日に331分止まっていた）。
  it('閉じた「盤面を引けなかった区間」を、何周と理由ごと出す', async () => {
    const { lines } = await body({
      events: [
        {
          at: '2026-09-07T02:00:00Z',
          kind: 'gap',
          from: '2026-09-07T00:24:00Z',
          until: '2026-09-07T01:59:30Z',
          rounds: 23,
          reason: 'list_sessions: 失敗: HTTP 401',
        },
      ],
    });

    expect(lines).toContain(
      '| 2026-09-07T00:24:00Z | 2026-09-07T01:59:30Z | 23 | list_sessions: 失敗: HTTP 401 |',
    );
  });

  // **窓の外の出来事は出さない。** 直った詰まりが今の詰まりと並ぶと、読む人はどちらが今かを
  // 読めない（`board.mjs` の `EVENT_WINDOW_HOURS`）。
  it('窓より古い出来事は出さない', async () => {
    const { lines } = await body({
      events: [{ at: '2026-09-06T03:00:00Z', kind: 'move', move: 'MERGE', target: '9', result: 'played' }],
    });

    expect(lines.join('\n')).not.toContain('## 周の出来事');
  });

  // **無い周は節ごと出さない**（`## 人の手番` と同じ理由）——毎周出る節は、当たっている周も
  // 読み飛ばされる。
  it('出来事が1つも無ければ、節ごと出さない', async () => {
    expect((await body()).lines.join('\n')).not.toContain('## 周の出来事');
  });

  // ## 見回りが届いているか（2.21.4）
  //
  // **「異常なし」と「係が立たなかった」を分けるのは、この行だけ。** 記録はこのPCにしか無く、
  // 読む人はスマホから読む——ここに出ないなら、届いていないのと同じ。
  it('最後の見回りを、判定ごと出す', async () => {
    const { lines } = await body({
      patrol: { at: '2026-09-07T02:30:00Z', verdict: '異常なし', summary: '8件の task は錠待ち' },
    });

    expect(lines).toContain('盤面の見回り 2026-09-07T02:30:00Z … 異常なし 8件の task は錠待ち');
  });

  // **立たなくなったことは、他のどこにも出ない**（間隔の3倍で断る。`board.mjs` の
  // `STALE_PATROL_HOURS`）。
  it('見回りが途切れていれば、断りにする', async () => {
    const { lines } = await body({
      patrol: { at: '2026-09-06T20:00:00Z', verdict: '異常なし', summary: '' },
    });

    expect(lines).toContain(
      '⚠ **盤面を見回る係が 7時間4分 立っていません。** 最後の記録は「盤面の見回り 2026-09-06T20:00:00Z … 異常なし」（2.21）',
    );
  });

  // **記録が無い周も、読めない周も同じ断り。** 人から見れば、走らなかったのと読めないのは同じ
  // だけ危ない（`board-state.mjs` の `readLastPatrol` が、どちらも `undefined` にして渡す）。
  it('見回りの記録が無ければ、断りにする', async () => {
    expect((await body({ patrolMissing: true })).lines).toContain(
      '⚠ **盤面を見回る係の記録がありません。** 立っていないか、記録が壊れています（2.21）',
    );
  });

  // ## 人の手番（2.13・2.20）
  //
  // **ラベルを付けるのは機械かレビュアーで、PRを出すのも issue を返すのも人と同じアカウント**
  // なので、GitHub の通知は鳴らない。端末の盤面にはラベルの列が出るが、**叩けない人が読めるのは
  // 本文だけ**——ここに出ないなら、人は自分の手番であることを知らないまま、錠を握られた task が
  // 全部止まる。
  it('`判断待ち` のPRを、何が止まるかと一緒に出す', async () => {
    const { lines } = await body({
      prs: [
        {
          number: 10,
          title: 'ラベルを割る',
          labels: [{ name: '通してよい' }, { name: '判断待ち' }],
          statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
          mergeable: 'MERGEABLE',
          body: '',
        },
      ],
    });

    expect(lines).toContain('## 人の手番');
    expect(lines).toContain('| PR #10 | マージされない | ラベルを割る |');
  });

  // **人の手番で止まっている間、盤面は `main` の動きで直しを頼まない**（2.13.8）ので、**待つほど
  // 衝突とCIの赤がそのまま残る。** 書かないと、読んだ人は「通す」を選んだつもりで押せないボタンの
  // 前に着く——**そこから先に何をすればよいかは、どこにも出ない。**
  it('取り込みが要るPRには、押せないことと次の手を添える', async () => {
    const { lines } = await body({
      prs: [
        {
          number: 10,
          title: 'ラベルを割る',
          labels: [{ name: '通してよい' }, { name: '判断待ち' }],
          statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }],
          mergeable: 'CONFLICTING',
          body: '',
        },
      ],
    });

    expect(lines).toContain('| PR #10 | マージされない（衝突・CIが赤い。取り込みが要る） | ラベルを割る |');
    expect(lines).toContain(
      '**`取り込みが要る` と出たPRは、画面のマージが押せません。** 通すなら「通してよい。`main` を取り込んで」と書いてラベルを外してください——書いた本人が1回で取り込み直し、緑になったらここへ戻ります（2.13.8）。',
    );
  });

  // 当たっていない周にも出る断りは、当たっている周も同じ見た目のまま読み飛ばされる。
  it('押せるPRだけの周には、取り込みの断りを出さない', async () => {
    const { lines } = await body({
      prs: [
        {
          number: 10,
          title: 'ラベルを割る',
          labels: [{ name: '判断待ち' }],
          statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
          mergeable: 'MERGEABLE',
          body: '',
        },
      ],
    });

    expect(lines.join('\n')).not.toContain('取り込みが要る');
  });

  // **`収束せず` も人の手番**（2.13.1 の表は `判断待ち` と同じ行に置いている）。出さないと、
  // `main` の動きで起こさなくなったぶん（2.13.8）が**誰にも見えないまま腐る。**
  it('`収束せず` のPRも、人の手番として出す', async () => {
    const { lines } = await body({
      prs: [
        {
          number: 11,
          title: '往復で決まらない',
          labels: [{ name: '収束せず' }],
          statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
          mergeable: 'MERGEABLE',
          body: '',
        },
      ],
    });

    expect(lines).toContain('| PR #11 | マージされない | 往復で決まらない |');
  });

  // **issue の `判断待ち` は、ワーカーが人へ返した印**（2.15）。件数の表には「返却」として数だけ
  // 出るが、**どれを返したかは番号が要る。**
  it('`判断待ち` の issue を、配られないものとして出す', async () => {
    const { lines } = await body({
      issues: [
        issue(8, '決められない', {
          labels: [{ name: 'kind:task' }, { name: 'goal:upkeep' }, { name: '判断待ち' }],
        }),
      ],
    });

    expect(lines).toContain('| #8 | 配られない | 決められない |');
  });

  // **毎周「（無し）」が出る節は、在る周も同じ見た目のまま読み飛ばされる。**
  it('人の手番が無ければ、節ごと出さない', async () => {
    expect((await body({ issues: [issue(1, '着手可')] })).lines).not.toContain('## 人の手番');
  });

  /**
   * ## 宛先の無いPR（2.11.4）
   *
   * 2026-09-11、PR #1922 の名乗りが引けないまま、ユーザーがPRへ書いた質問は作者へ一度も届かず、
   * 盤面は2時間手を1つも打たなかった（issue #1937）。**直す先が出るのはこの節しか無い**——周の
   * 出来事（2.20.3）が渡すのは「何が止めているか」までで、直し方は載らない。
   */
  describe('宛先の無いPR', () => {
    const stuck = (over: Record<string, unknown> = {}) => ({
      number: 10,
      title: '名乗りが引けないPR',
      labels: [],
      statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
      mergeable: 'MERGEABLE',
      body: '',
      ...over,
    });

    it('実在しない名乗りと、畳まれた名乗りを、別のものとして出す', async () => {
      const { lines } = await body({
        prs: [stuck(), stuck({ number: 11, title: '畳まれた作者のPR' })],
        claims: {
          10: 'session_cse_014cYXoMLEog6HpsE4m2bUn8',
          11: 'session_01TyQngmJGi4rLDAWmfqjG9T',
        },
      });

      expect(lines).toContain('## 宛先の無いPR');
      expect(lines.find((line) => line.startsWith('| PR #10 |'))).toContain(
        '名乗りが実在しないセッションを指している',
      );
      expect(lines.find((line) => line.startsWith('| PR #11 |'))).toContain(
        '名乗っているセッションが畳まれている',
      );
    });

    it('名乗りが生きたセッションを指していれば、出さない', async () => {
      const { lines } = await body({
        prs: [stuck()],
        claims: { 10: 'session_01TyQngmJGi4rLDAWmfqjG9T' },
        sessions: [session('session_01TyQngmJGi4rLDAWmfqjG9T')],
      });

      expect(lines).not.toContain('## 宛先の無いPR');
    });

    // **片方でも欠けた周に「引けない」と読むと、健全なPRが全部そう見える。**
    it('名乗りを引けなかった周は、節ごと出さない', async () => {
      const { lines, warnings } = await body({ prs: [stuck()], claimsFail: true });

      expect(lines).not.toContain('## 宛先の無いPR');
      // **道具が言った理由まで載せる**（1.7）。断りだけでは、読む人に直す先が渡らない。
      expect(warnings).toContain(
        '（差し戻す相手を引けなかった。宛先の無いPRは出せない）: gh api graphql: 引けない',
      );
    });

    it('セッションの一覧を引けなかった周も、節ごと出さない', async () => {
      const { lines } = await body({
        prs: [stuck()],
        claims: { 10: 'session_01TyQngmJGi4rLDAWmfqjG9T' },
        sessionsFail: true,
      });

      expect(lines).not.toContain('## 宛先の無いPR');
    });
  });

  it('配ってよいかで数えた件数を出す', async () => {
    const { lines } = await body({
      issues: [
        issue(1, '着手可'),
        issue(2, '投入済み'),
        issue(3, '塞がっている', { blockedBy: { nodes: [{ number: 9, state: 'OPEN' }] } }),
        issue(4, '返された', {
          labels: [{ name: 'kind:task' }, { name: 'goal:upkeep' }, { name: '判断待ち' }],
        }),
        issue(5, '未整理', { labels: [] }),
      ],
      sessions: [session('session_a', ['task-2'])],
      prs: [{ number: 10, title: '題', labels: [], statusCheckRollup: [], body: '' }],
    });

    expect(lines).toContain('| 着手可 | 1 |');
    expect(lines).toContain('| 投入済み | 1 |');
    expect(lines).toContain('| 待ち | 1 |');
    expect(lines).toContain('| 返却 | 1 |');
    expect(lines).toContain('| 未整理 | 1 |');
    expect(lines).toContain('| 開いているPR | 1 |');
    expect(lines).toContain('| 畳んでいないセッション | 1 |');
  });

  // 完了の条件（#1597）。**状態はラベルの写しではない**ので、走っているセッションとPRのCI・
  // マージ可否から出す。
  it('投入済みの1件ごとに、番号・題・状態・PRを並べる', async () => {
    const { lines } = await body({
      issues: [issue(8, '直す')],
      sessions: [session('session_a', ['task-8'])],
      prs: [
        {
          number: 10,
          title: '題',
          labels: [],
          statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
          mergeable: 'MERGEABLE',
          body: 'Closes #8\n',
        },
      ],
    });

    expect(lines).toContain('| #8 | 直す | 作業中 | #10 緑 マージ可 |');
  });

  it('レビューのセッションが走っていれば、そう出す', async () => {
    const { lines } = await body({
      issues: [issue(8, '直す')],
      sessions: [
        { ...session('session_a', ['task-8']), status: 'SESSION_STATUS_IDLE' },
        session('session_b', ['review-10']),
      ],
      prs: [
        {
          number: 10,
          title: '題',
          labels: [],
          statusCheckRollup: [{ status: 'IN_PROGRESS' }],
          mergeable: 'CONFLICTING',
          body: 'Closes #8\n',
        },
      ],
    });

    expect(lines).toContain('| #8 | 直す | レビュー中 | #10 実行中 衝突 |');
  });

  // **どちらかへ丸めない。** 起きていることの片方が消えると、読む人は止まっている側を探せない。
  it('両方走っていれば、両方出す', async () => {
    const { lines } = await body({
      issues: [issue(8, '直す')],
      sessions: [session('session_a', ['task-8']), session('session_b', ['review-10'])],
      prs: [{ number: 10, title: '題', labels: [], statusCheckRollup: [], body: 'Closes #8\n' }],
    });

    expect(lines).toContain('| #8 | 直す | 作業中・レビュー中 | #10 チェック無 不明 |');
  });

  it('セッションが手を止めていれば、手空きと出す', async () => {
    const { lines } = await body({
      issues: [issue(8, '直す')],
      sessions: [{ ...session('session_a', ['task-8']), status: 'SESSION_STATUS_IDLE' }],
    });

    expect(lines).toContain('| #8 | 直す | 手空き | - |');
  });

  // PRだけが残っている形（担当が畳まれた）。**差し戻す相手が居ない**ので、人が見て気づく必要がある。
  it('担当のセッションがもう居なければ、担当無しと出す', async () => {
    const { lines } = await body({
      issues: [issue(8, '直す')],
      prs: [
        {
          number: 10,
          title: '題',
          labels: [],
          statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }],
          mergeable: 'MERGEABLE',
          body: 'Closes #8\n',
        },
      ],
    });

    expect(lines).toContain('| #8 | 直す | 担当無し | #10 赤 マージ可 |');
  });

  it('投入済みが1件も無ければ、そう書く', async () => {
    const { lines } = await body({ issues: [issue(8, '直す')] });

    expect(lines).toContain('（無し）');
    expect(lines.filter((line) => line.startsWith('| #8'))).toEqual([]);
  });

  // 表の升に `|` が入ると、そこで列が割れる。issue の題は人が自由に書く。
  it('題の `|` を逃がす', async () => {
    const { lines } = await body({
      issues: [issue(8, 'a | b')],
      sessions: [session('session_a', ['task-8'])],
    });

    expect(lines).toContain('| #8 | a \\| b | 作業中 | - |');
  });

  // **断りの出し先がログしか無いと、読んでいる人は当てにならない表を正しいものとして読む。**
  it('セッションの一覧を引けなかったら、本文にも断る', async () => {
    const { lines, warnings } = await body({ issues: [issue(8, '直す')], sessionsFail: true });

    expect(lines).toContain('⚠ （セッションの一覧を引けなかった。投入済みの判定はPRだけで行う）');
    // ログ側にも同じ声が出る（手元で追う側は、ここだけを読む）。
    expect(warnings).toEqual(['（セッションの一覧を引けなかった。投入済みの判定はPRだけで行う）']);
  });

  // **断りだけでは足りない**（2.20.2）。空の一覧で組むと、投入済みの task が `着手可`・`担当無し`
  // に化けて**在るはずのものが消えた盤面**になり、読んだ人は投入してよいと読む。**表が在れば、
  // 断りより表のほうが読まれる。**
  it('セッションの一覧を引けなかったら、それを根拠にした行は出さない', async () => {
    const { lines } = await body({
      issues: [issue(8, '直す'), issue(9, 'なにか', { labels: [] })],
      sessionsFail: true,
    });
    const text = lines.join('\n');

    expect(text).not.toContain('| 着手可 |');
    expect(text).not.toContain('| 投入済み |');
    expect(text).not.toContain('| 畳んでいないセッション |');
    expect(lines).toContain('（セッションの一覧を引けなかったので、出せない）');
    // 一覧を見ずに数えられるものは、そのまま出す。
    expect(lines).toContain('| 未整理 | 1 |');
  });
});
