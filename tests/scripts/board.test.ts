import { describe, expect, it } from 'vitest';

import { board } from '../../scripts/agent/board.mjs';

/**
 * `scripts/agent/board.mjs` の検査。
 *
 * ここが守るのは**突き合わせ**——`task` の issue に「もう投入したか」「何に塞がれているか」が
 * 正しく付くこと、棚卸しの済んでいない issue だけが `未整理` に出ること。並べ方を間違えると、
 * 司令塔は同じ issue を二重に投入するか、着手できる仕事を待ちだと読んで止める。
 */

interface World {
  readonly prs?: readonly Record<string, unknown>[];
  readonly issues?: readonly Record<string, unknown>[];
  readonly sessions?: readonly Record<string, unknown>[];
  /** 一覧を引けない。 */
  readonly sessionsFail?: boolean;
  readonly checked?: string;
}

function show(world: World = {}): { lines: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const lines = board({
    gh: (args: readonly string[]) =>
      args[0] === 'pr' ? JSON.stringify(world.prs ?? []) : JSON.stringify(world.issues ?? []),
    page: () => (world.sessionsFail === true ? undefined : { ccr: { data: world.sessions ?? [] } }),
    checkedItems: () => world.checked ?? '',
    warn: (line: string) => warnings.push(line),
  });
  return { lines: lines ?? [], warnings };
}

const issue = (number: number, title: string, over: Record<string, unknown> = {}) => ({
  number,
  title,
  labels: [{ name: 'task' }],
  blockedBy: { nodes: [] },
  ...over,
});

const session = (id: string, title: string) => ({
  id,
  session_status: 'SESSION_STATUS_RUNNING',
  updated_at: '2026-09-05T00:00:00Z',
  title,
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

    expect(lines).toContain('PR 10 赤 MERGEABLE main 通してよい,判断待ち 題');
  });

  // チェックが1本も登録されないPRがある（`tests.yml` の `paths` に当たらない差分）。**「緑」とは
  // 言わない**——盤面が緑と読むかは落ち着いてからで、そちらの判定は `board-move.mjs` が持つ。
  it('チェックが1本も無いPRは、そう書く', () => {
    const { lines } = show({
      prs: [{ number: 10, title: '題', labels: [], statusCheckRollup: [], mergeable: 'UNKNOWN' }],
    });

    expect(lines).toContain('PR 10 チェック無 UNKNOWN main - 題');
  });

  it('走行中のセッションが題に持つ issue は、投入済みと出す', () => {
    const { lines } = show({
      issues: [issue(8, '直す')],
      sessions: [session('session_a', '作業 (#8) 直す')],
    });

    expect(lines).toContain('TASK 8 投入済み 直す');
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

  it('依存が閉じていれば、着手可として出す', () => {
    const { lines } = show({
      issues: [issue(8, '後', { blockedBy: { nodes: [{ number: 7, state: 'CLOSED' }] } })],
    });

    expect(lines).toContain('TASK 8 着手可 後');
  });

  // 依存が張ってあるものを外すのは、それが棚卸しの結論そのものだから。
  it('未整理に出るのは、task も meta も無く、依存も張られていない issue', () => {
    const { lines } = show({
      issues: [
        issue(1, 'task が付いている'),
        issue(2, 'meta の盤', { labels: [{ name: 'meta' }] }),
        issue(3, '束ねた側', { labels: [], blockedBy: { nodes: [{ number: 9, state: 'OPEN' }] } }),
        issue(4, '人の言葉のまま', { labels: [] }),
      ],
    });

    expect(lines.filter((line) => line.startsWith('未整理 '))).toEqual(['未整理 4 - 人の言葉のまま']);
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
