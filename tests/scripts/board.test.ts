import { describe, expect, it } from 'vitest';

import { ISSUE_CAP } from '../../scripts/agent/board-read.mjs';
import { board, issueBody } from '../../scripts/agent/board.mjs';

/**
 * `scripts/agent/board.mjs` の検査。
 *
 * ここが守るのは**突き合わせ**——`kind:task` の issue に「もう投入したか」「何に塞がれているか」が
 * 正しく付くこと、棚卸しの済んでいない issue だけが `未整理` に出ること。並べ方を間違えると、
 * 盤面を読んだ側は同じ issue を二重に投入するか、着手できる仕事を待ちだと読んで止める。
 *
 * 出口は端末（`board`）と常設 issue の本文（`issueBody`。`.claude/board-design.md` 2.20）の2つで、
 * **突き合わせは1箇所**。どちらの検査も同じ世界を渡して、同じ事実が両方に出ることを見る。
 */

interface LiveSession {
  readonly id: string;
  readonly status: string;
  readonly bucket: string;
  readonly env: string;
  readonly tags: readonly string[];
}

interface World {
  readonly prs?: readonly Record<string, unknown>[];
  readonly issues?: readonly Record<string, unknown>[];
  readonly sessions?: readonly LiveSession[];
  /** 一覧を引けない（[`live-sessions.mjs`](../../scripts/agent/live-sessions.mjs) は投げる）。 */
  readonly sessionsFail?: boolean;
  readonly checked?: string;
  /** 盤面を引けなくなった時刻（デーモンの台帳。`board-state.mjs` の `UNREADABLE`）。 */
  readonly unreadableSince?: string;
  /** 最後の見回り（デーモンの記録。`board-state.mjs` の `readLastPatrol`）。 */
  readonly patrol?: { at: string; verdict: string; summary: string };
  /** 見回りの記録が無い（走っていないか、読めない）。 */
  readonly patrolMissing?: boolean;
}

const deps = (world: World, warn: (line: string) => void) => ({
  gh: (args: readonly string[]) =>
    args[0] === 'pr' ? JSON.stringify(world.prs ?? []) : JSON.stringify(world.issues ?? []),
  sessions: () => {
    if (world.sessionsFail === true) throw new Error('セッションの一覧を引けなかった');
    return world.sessions ?? [];
  },
  warn,
});

function show(world: World = {}): { lines: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const lines = board({
    ...deps(world, (line: string) => warnings.push(line)),
    checkedItems: () => world.checked ?? '',
  });
  return { lines: lines ?? [], warnings };
}

/** 常設 issue の本文。行で見たいので分けて返す。 */
function body(world: World = {}): { lines: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const text = issueBody({
    ...deps(world, (line: string) => warnings.push(line)),
    now: new Date('2026-09-07T03:04:05.678Z'),
    unreadableSince: world.unreadableSince,
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
  labels: [{ name: 'kind:task' }],
  blockedBy: { nodes: [] },
  ...over,
});

/**
 * 畳まれていないセッション1件（`live-sessions.mjs` が返す形）。**何をしているかはタグで引く**
 * （`.claude/board-design.md` 1.2）——題は一覧に含まれない。
 */
const session = (id: string, tags: readonly string[] = []): LiveSession => ({
  id,
  status: 'SESSION_STATUS_RUNNING',
  bucket: 'SESSION_STATUS_BUCKET_WORKING',
  env: 'cloud',
  tags,
});

describe('board.mjs', () => {
  it('引けなければ、何も並べない', () => {
    expect(board({ gh: () => undefined, sessions: () => [], warn: () => {} })).toBeUndefined();
  });

  // 切られるのは古い側なので、**黙って切ると「そんな issue は無い」と同じ形**になる。担当の居る
  // task が消えた実績がある（2026-09-11、#1722）。
  it('開いている issue が上限に達したら、そう言う', () => {
    const many = Array.from({ length: ISSUE_CAP }, (_, index) => ({
      number: index + 1,
      title: `見出し${index + 1}`,
      labels: [{ name: 'kind:task' }],
    }));
    expect(show({ issues: many }).warnings.join('\n')).toContain(`上限（${ISSUE_CAP}件）`);
    expect(show({ issues: many.slice(1) }).warnings).toEqual([]);
  });

  it('節は、中身が無くても出る', () => {
    expect(show().lines).toEqual([
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

  it('チェックの付いた項目を、確定待ちとして並べる', () => {
    const { lines } = show({ checked: '656 世界の広さは 3km 四方\n' });

    expect(lines).toContain('確定待ち 656 世界の広さは 3km 四方');
  });

  it('PRは、CIの色とマージ可否とラベルを添えて並べる', () => {
    const { lines } = show({
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
  it('チェックが1本も無いPRは、そう書く', () => {
    const { lines } = show({
      prs: [{ number: 10, title: '題', labels: [], statusCheckRollup: [], mergeable: 'UNKNOWN' }],
    });

    expect(lines).toContain('PR 10 チェック無 不明 main - 題');
  });

  it('`task-<番号>` のタグを持つセッションが在れば、投入済みと出す', () => {
    const { lines } = show({
      issues: [issue(8, '直す')],
      sessions: [session('session_a', ['task-8'])],
    });

    expect(lines).toContain('TASK 8 投入済み 直す');
  });

  // 引くのは**その issue のタグ**だけ（1.2）。他の仕事で走っている1本を投入済みと読むと、着手できる
  // 仕事が誰にも配られないまま止まる。
  it('別の仕事のセッションが走っていても、投入済みにしない', () => {
    const { lines } = show({
      issues: [issue(8, '直す')],
      sessions: [session('session_a', ['task-9']), session('session_b', ['review-10'])],
    });

    expect(lines).toContain('TASK 8 着手可 直す');
  });

  it('開いているPRが閉じる issue も、投入済みと出す', () => {
    const { lines } = show({
      issues: [issue(8, '直す')],
      prs: [{ number: 10, title: '題', labels: [], statusCheckRollup: [], body: 'Closes #8\n' }],
    });

    expect(lines).toContain('TASK 8 投入済み 直す');
  });

  // **`blockedBy` は issue 1件につき1回の `gh api` が要るぶん省かれやすい。** 塞いでいた issue が
  // 閉じても誰も気づかないと、着手できる仕事が止まったままになる。
  it('開いている依存があれば、待ちとして出す', () => {
    const { lines } = show({
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

  // 返された issue は `kind:task` が付いたまま残る（`.claude/board-design.md` 2.15.2）ので、状態で
  // 見分けが付かないと、人は列に並んでいるものと区別できない。
  it('人へ返された issue は、返却として出す', () => {
    const { lines } = show({
      issues: [issue(8, '決められない', { labels: [{ name: 'kind:task' }, { name: '判断待ち' }] })],
    });

    expect(lines).toContain('TASK 8 返却 決められない');
  });

  // 走らせる先の指定は状態と別の軸（2.16）なので、状態を潰さずに後ろへ並べる。
  it('走らせる先の指定があれば、状態の後ろに出す', () => {
    const { lines } = show({
      issues: [issue(8, '盤面を直す', { labels: [{ name: 'kind:task' }, { name: 'env:bridge' }] })],
    });

    expect(lines).toContain('TASK 8 着手可 env:bridge 盤面を直す');
  });

  it('依存が閉じていれば、着手可として出す', () => {
    const { lines } = show({
      issues: [issue(8, '後', { blockedBy: { nodes: [{ number: 7, state: 'CLOSED' }] } })],
    });

    expect(lines).toContain('TASK 8 着手可 後');
  });

  // 未整理は `kind:` を1つも持たないことで表す（否定の列挙では表さない）。依存が張ってあっても、
  // 棚卸しが分類を付けて出るので外す必要は無い。
  it('未整理に出るのは、kind: を1つも持たない issue', () => {
    const { lines } = show({
      issues: [
        issue(1, 'kind:task が付いている'),
        issue(2, 'meta の盤', { labels: [{ name: 'kind:meta' }] }),
        issue(3, '束ねた側', {
          labels: [{ name: 'kind:task' }],
          blockedBy: { nodes: [{ number: 9, state: 'OPEN' }] },
        }),
        issue(4, '人の言葉のまま', { labels: [] }),
        issue(5, '分類の無い bug', { labels: [{ name: 'bug' }] }),
      ],
    });

    expect(lines.filter((line) => line.startsWith('未整理 '))).toEqual([
      '未整理 4 - 人の言葉のまま',
      '未整理 5 bug 分類の無い bug',
    ]);
  });

  // 何をしているかはタグで読む。**畳まれたものを外すのも、繰るのも `live-sessions.mjs`**（検査は
  // `liveSessions.test.ts`）なので、ここが見るのは並べ方だけ。
  it('走行は、走っている場所とタグを添えて並べる', () => {
    const { lines } = show({
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

  it('一覧を引けなければ、投入済みの判定はPRだけで行うと断る', () => {
    const { lines, warnings } = show({ issues: [issue(8, '直す')], sessionsFail: true });

    expect(warnings).toEqual(['（セッションの一覧を引けなかった。投入済みの判定はPRだけで行う）']);
    expect(lines).toContain('TASK 8 着手可 直す');
  });
});

/**
 * 常設 issue の本文（`.claude/board-design.md` 2.20）。**読むのはスマホの人間**で、リポジトリも
 * ログも開かないので、ここが守るのは**本文だけで読み切れること**——いつ時点か・何件あるか・
 * 投入した1件ごとに今何が起きているか。
 */
describe('issueBody', () => {
  it('引けなければ、本文を作らない', () => {
    expect(issueBody({ gh: () => undefined, sessions: () => [], warn: () => {} })).toBeUndefined();
  });

  // **写しを持ってよいのは、いつ時点かを一緒に書くから**（2.20.1）。時刻が伸びないことが、
  // そのまま「デーモンが動いていない」を告げる。
  it('最終更新の時刻を書く', () => {
    expect(body().lines).toContain('最終更新 2026-09-07T03:04:05Z');
  });

  // **盤面を引けない周に、デーモンにできるのはこれだけ**（2.21）。直せるのは Claude Code 本体を
  // 触れる人だけで、`~/daemon.log` を読めるのは手元で叩ける人だけ——**届く先はここしか無い。**
  it('盤面を引けていなければ、続いた長さを添えて断る', () => {
    const { lines } = body({ unreadableSince: '2026-09-07T01:19:05Z' });

    expect(lines).toContain(
      '⚠ **盤面を引けていません**（2026-09-07T01:19:05Z から 1時間45分）。GitHub か CCR から引けない周が続いています——**直せるのは人だけ**で、この間セッションは1本も立ちません',
    );
  });

  it('引けている盤面には、断りを出さない', () => {
    expect(body().lines.join('\n')).not.toContain('盤面を引けていません');
  });

  // 出どころは台帳のテキストなので、壊れていることがありうる。**壊れた値で嘘の長さを出さない。**
  it('読めない時刻なら、断りを出さない', () => {
    expect(body({ unreadableSince: 'ゆうべ' }).lines.join('\n')).not.toContain('盤面を引けていません');
  });

  // ## 見回りが届いているか（2.21.4）
  //
  // **「異常なし」と「係が立たなかった」を分けるのは、この行だけ。** 記録はこのPCにしか無く、
  // 読む人はスマホから読む——ここに出ないなら、届いていないのと同じ。
  it('最後の見回りを、判定ごと出す', () => {
    const { lines } = body({
      patrol: { at: '2026-09-07T02:30:00Z', verdict: '異常なし', summary: '8件の task は錠待ち' },
    });

    expect(lines).toContain('盤面の見回り 2026-09-07T02:30:00Z … 異常なし 8件の task は錠待ち');
  });

  // **立たなくなったことは、他のどこにも出ない**（間隔の3倍で断る。`board.mjs` の
  // `STALE_PATROL_HOURS`）。
  it('見回りが途切れていれば、断りにする', () => {
    const { lines } = body({
      patrol: { at: '2026-09-06T20:00:00Z', verdict: '異常なし', summary: '' },
    });

    expect(lines).toContain(
      '⚠ **盤面を見回る係が 7時間4分 立っていません。** 最後の記録は「盤面の見回り 2026-09-06T20:00:00Z … 異常なし」（2.21）',
    );
  });

  // **記録が無い周も、読めない周も同じ断り。** 人から見れば、走らなかったのと読めないのは同じ
  // だけ危ない（`board-state.mjs` の `readLastPatrol` が、どちらも `undefined` にして渡す）。
  it('見回りの記録が無ければ、断りにする', () => {
    expect(body({ patrolMissing: true }).lines).toContain(
      '⚠ **盤面を見回る係の記録がありません。** 立っていないか、記録が壊れています（2.21）',
    );
  });

  // ## 人の手番（2.13・2.20）
  //
  // **ラベルを付けるのは機械かレビュアーで、PRを出すのも issue を返すのも人と同じアカウント**
  // なので、GitHub の通知は鳴らない。端末の盤面にはラベルの列が出るが、**叩けない人が読めるのは
  // 本文だけ**——ここに出ないなら、人は自分の手番であることを知らないまま、錠を握られた task が
  // 全部止まる。
  it('`判断待ち` のPRを、何が止まるかと一緒に出す', () => {
    const { lines } = body({
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

  // **issue の `判断待ち` は、ワーカーが人へ返した印**（2.15）。件数の表には「返却」として数だけ
  // 出るが、**どれを返したかは番号が要る。**
  it('`判断待ち` の issue を、配られないものとして出す', () => {
    const { lines } = body({
      issues: [issue(8, '決められない', { labels: [{ name: 'kind:task' }, { name: '判断待ち' }] })],
    });

    expect(lines).toContain('| #8 | 配られない | 決められない |');
  });

  // **毎周「（無し）」が出る節は、在る周も同じ見た目のまま読み飛ばされる。**
  it('人の手番が無ければ、節ごと出さない', () => {
    expect(body({ issues: [issue(1, '着手可')] }).lines).not.toContain('## 人の手番');
  });

  it('配ってよいかで数えた件数を出す', () => {
    const { lines } = body({
      issues: [
        issue(1, '着手可'),
        issue(2, '投入済み'),
        issue(3, '塞がっている', { blockedBy: { nodes: [{ number: 9, state: 'OPEN' }] } }),
        issue(4, '返された', { labels: [{ name: 'kind:task' }, { name: '判断待ち' }] }),
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
  it('投入済みの1件ごとに、番号・題・状態・PRを並べる', () => {
    const { lines } = body({
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

  it('レビューのセッションが走っていれば、そう出す', () => {
    const { lines } = body({
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
  it('両方走っていれば、両方出す', () => {
    const { lines } = body({
      issues: [issue(8, '直す')],
      sessions: [session('session_a', ['task-8']), session('session_b', ['review-10'])],
      prs: [{ number: 10, title: '題', labels: [], statusCheckRollup: [], body: 'Closes #8\n' }],
    });

    expect(lines).toContain('| #8 | 直す | 作業中・レビュー中 | #10 チェック無 不明 |');
  });

  it('セッションが手を止めていれば、手空きと出す', () => {
    const { lines } = body({
      issues: [issue(8, '直す')],
      sessions: [{ ...session('session_a', ['task-8']), status: 'SESSION_STATUS_IDLE' }],
    });

    expect(lines).toContain('| #8 | 直す | 手空き | - |');
  });

  // PRだけが残っている形（担当が畳まれた）。**差し戻す相手が居ない**ので、人が見て気づく必要がある。
  it('担当のセッションがもう居なければ、担当無しと出す', () => {
    const { lines } = body({
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

  it('投入済みが1件も無ければ、そう書く', () => {
    const { lines } = body({ issues: [issue(8, '直す')] });

    expect(lines).toContain('（無し）');
    expect(lines.filter((line) => line.startsWith('| #8'))).toEqual([]);
  });

  // 表の升に `|` が入ると、そこで列が割れる。issue の題は人が自由に書く。
  it('題の `|` を逃がす', () => {
    const { lines } = body({
      issues: [issue(8, 'a | b')],
      sessions: [session('session_a', ['task-8'])],
    });

    expect(lines).toContain('| #8 | a \\| b | 作業中 | - |');
  });

  // **断りの出し先がログしか無いと、読んでいる人は当てにならない表を正しいものとして読む。**
  it('セッションの一覧を引けなかったら、本文にも断る', () => {
    const { lines, warnings } = body({ issues: [issue(8, '直す')], sessionsFail: true });

    expect(lines).toContain('⚠ （セッションの一覧を引けなかった。投入済みの判定はPRだけで行う）');
    // ログ側にも同じ声が出る（手元で追う側は、ここだけを読む）。
    expect(warnings).toEqual(['（セッションの一覧を引けなかった。投入済みの判定はPRだけで行う）']);
  });

  // **断りだけでは足りない**（2.20.2）。空の一覧で組むと、投入済みの task が `着手可`・`担当無し`
  // に化けて**在るはずのものが消えた盤面**になり、読んだ人は投入してよいと読む。**表が在れば、
  // 断りより表のほうが読まれる。**
  it('セッションの一覧を引けなかったら、それを根拠にした行は出さない', () => {
    const { lines } = body({
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
