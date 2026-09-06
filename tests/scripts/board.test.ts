import { describe, expect, it } from 'vitest';

import { board, issueBody } from '../../scripts/agent/board.mjs';

/**
 * `scripts/agent/board.mjs` の検査。
 *
 * ここが守るのは**突き合わせ**——`kind:task` の issue に「もう投入したか」「何に塞がれているか」が
 * 正しく付くこと、棚卸しの済んでいない issue だけが `未整理` に出ること。並べ方を間違えると、
 * 司令塔は同じ issue を二重に投入するか、着手できる仕事を待ちだと読んで止める。
 *
 * 出口は端末（`board`）と常設 issue の本文（`issueBody`。`.claude/board-design.md` 2.20）の2つで、
 * **突き合わせは1箇所**。どちらの検査も同じ世界を渡して、同じ事実が両方に出ることを見る。
 */

interface World {
  readonly prs?: readonly Record<string, unknown>[];
  readonly issues?: readonly Record<string, unknown>[];
  readonly sessions?: readonly Record<string, unknown>[];
  /** 一覧を引けない。 */
  readonly sessionsFail?: boolean;
  readonly checked?: string;
}

const deps = (world: World, warn: (line: string) => void) => ({
  gh: (args: readonly string[]) =>
    args[0] === 'pr' ? JSON.stringify(world.prs ?? []) : JSON.stringify(world.issues ?? []),
  page: () => (world.sessionsFail === true ? undefined : { ccr: { data: world.sessions ?? [] } }),
  checkedItems: () => world.checked ?? '',
  warn,
});

function show(world: World = {}): { lines: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const lines = board(deps(world, (line: string) => warnings.push(line)));
  return { lines: lines ?? [], warnings };
}

/** 常設 issue の本文。行で見たいので分けて返す。 */
function body(world: World = {}): { lines: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const text = issueBody({
    ...deps(world, (line: string) => warnings.push(line)),
    now: new Date('2026-09-07T03:04:05.678Z'),
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
 * 畳まれていないセッション1件。**投入済みかを引くのはタグ**（`.claude/board-design.md` 2.9）なので、
 * 題は人が読むためだけのもの。
 */
const session = (id: string, title: string, tags: readonly string[] = []) => ({
  id,
  session_status: 'SESSION_STATUS_RUNNING',
  updated_at: '2026-09-05T00:00:00Z',
  title,
  tags,
});

describe('board.mjs', () => {
  it('引けなければ、何も並べない', () => {
    expect(board({ gh: () => undefined, page: () => undefined, warn: () => {} })).toBeUndefined();
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
      sessions: [session('session_a', '作業 #8 直す', ['task-8'])],
    });

    expect(lines).toContain('TASK 8 投入済み 直す');
  });

  // **題では見ない**（2.9）。題の形は人が読むためのもので、変わっても投入済みの判定は外れない。
  it('題に番号が在るだけのセッションでは、投入済みにしない', () => {
    const { lines } = show({
      issues: [issue(8, '直す')],
      sessions: [session('session_a', '相談 #8 について', [])],
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

  it('畳まれたセッションは、走行に出さない', () => {
    const { lines } = show({
      sessions: [
        session('session_a', '生きている'),
        { id: 'session_b', session_status: 'SESSION_STATUS_ARCHIVED', updated_at: '-', title: '畳んだ' },
      ],
    });

    expect(lines.filter((line) => line.startsWith('走行 '))).toEqual([
      '走行 session_a RUNNING 2026-09-05T00:00:00Z 生きている',
    ]);
  });

  // **上限に当たったら黙らない。** 一覧は新しい順なので、切れるのは古い側——畳み忘れて残っている
  // セッションはまさにそこに居る。
  it('一覧が上限に当たったら、断りを出す', () => {
    const sessions = Array.from({ length: 100 }, (_, at) => session(`session_${at}`, '題'));

    expect(show({ sessions }).warnings).toEqual([
      '（一覧が上限 100 に当たった。これより古いセッションは見えていない）',
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
    expect(issueBody({ gh: () => undefined, page: () => undefined, warn: () => {} })).toBeUndefined();
  });

  // **写しを持ってよいのは、いつ時点かを一緒に書くから**（2.20.1）。時刻が伸びないことが、
  // そのまま「デーモンが動いていない」を告げる。
  it('最終更新の時刻を書く', () => {
    expect(body().lines).toContain('最終更新 2026-09-07T03:04:05Z');
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
      sessions: [session('session_a', '作業 #2', ['task-2'])],
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
      sessions: [session('session_a', '作業 #8 直す', ['task-8'])],
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
        { ...session('session_a', '作業 #8 直す', ['task-8']), session_status: 'SESSION_STATUS_IDLE' },
        session('session_b', 'レビュー #10:1 題', ['review-10']),
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
      sessions: [
        session('session_a', '作業 #8 直す', ['task-8']),
        session('session_b', 'レビュー #10:1 題', ['review-10']),
      ],
      prs: [{ number: 10, title: '題', labels: [], statusCheckRollup: [], body: 'Closes #8\n' }],
    });

    expect(lines).toContain('| #8 | 直す | 作業中・レビュー中 | #10 チェック無 不明 |');
  });

  it('セッションが手を止めていれば、手空きと出す', () => {
    const { lines } = body({
      issues: [issue(8, '直す')],
      sessions: [
        { ...session('session_a', '作業 #8 直す', ['task-8']), session_status: 'SESSION_STATUS_IDLE' },
      ],
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
      sessions: [session('session_a', '作業 #8', ['task-8'])],
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
});
