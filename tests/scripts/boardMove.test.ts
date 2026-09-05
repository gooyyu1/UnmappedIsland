import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `scripts/agent/board-move.mjs` の検査。
 *
 * ここが守るのは**盤面から出る手が1つに決まること**。デーモンは出た手をそのまま打つので
 * （`.claude/board-design.md` 2.3）、判定を間違えると走っているセッションへ二重に投げるか、
 * 直しを待つPRが誰にも渡らないまま止まる。同じ盤面へ同じ手を二度出さないことも見る。
 */

const SCRIPT = resolve(__dirname, '../../scripts/agent/board-move.mjs');

const NOW = '2026-09-05T02:00:00Z';
/** これより前に更新が止まっているPRは、チェックが0本でも緑と読む。 */
const SETTLED = '2026-09-05T01:00:00Z';

interface Board {
  settledBefore?: string;
  prs?: readonly unknown[];
  issues?: readonly unknown[];
  sessions?: readonly { id: string; status: string; bucket: string; tags: readonly string[] }[];
  taken?: Record<string, string>;
}

function moves(board: Board): string[] {
  const out = execFileSync('node', [SCRIPT], {
    input: JSON.stringify({ settledBefore: SETTLED, prs: [], issues: [], sessions: [], ...board }),
    encoding: 'utf-8',
  });
  return out.split('\n').filter((line) => line.length > 0);
}

/** 緑のPR。チェックが1本通っている形で作る（無検査のPRとは別の道を通るため）。 */
function pr(number: number, over: Record<string, unknown> = {}) {
  return {
    number,
    isDraft: false,
    labels: [],
    mergeable: 'MERGEABLE',
    statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
    updatedAt: NOW,
    headRefOid: 'aaa111',
    body: `Closes #${number - 1}\n`,
    ...over,
  };
}

const label = (...names: string[]) => ({ labels: names.map((name) => ({ name })) });
const working = (id: string, ...tags: string[]) => ({
  id,
  status: 'SESSION_STATUS_RUNNING',
  bucket: 'SESSION_STATUS_BUCKET_WORKING',
  tags,
});
// **手が空いても `status_bucket` は `..._WORKING` のまま固まることがある**（board-design 1.6）ので、
// 手が空いている側はそちらを `..._WORKING` にして作る。ここを `..._COMPLETED` にすると、判定が
// bucket を見ていても試験が通ってしまう。
const idle = (id: string, ...tags: string[]) => ({
  id,
  status: 'SESSION_STATUS_IDLE',
  bucket: 'SESSION_STATUS_BUCKET_WORKING',
  tags,
});

describe('board-move.mjs', () => {
  it('結論のラベルが無い緑のPRは、レビューへ出す', () => {
    expect(moves({ prs: [pr(10)] })).toEqual(['REVIEW 10 aaa111']);
  });

  it('通してよいが付いた緑のPRは、マージする', () => {
    expect(moves({ prs: [pr(10, label('通してよい'))] })).toEqual(['MERGE 10']);
  });

  it('マージはレビューより先に打つ', () => {
    expect(moves({ prs: [pr(10), pr(20, label('通してよい'))] })).toEqual(['MERGE 20', 'REVIEW 10 aaa111']);
  });

  it('コンフリクトしていれば、通してよいが付いていてもマージしない', () => {
    const board = {
      prs: [pr(10, { ...label('通してよい'), mergeable: 'CONFLICTING' })],
      sessions: [idle('session_a', 'task-9')],
    };
    expect(moves(board)).toEqual(['RESUME session_a mend 10 mend:10:aaa111']);
  });

  // まだ計算中。次の周には決まるので、何も打たずに待つ。
  it('mergeable が引けていない周は、マージしない', () => {
    expect(moves({ prs: [pr(10, { ...label('通してよい'), mergeable: 'UNKNOWN' })] })).toEqual([]);
  });

  it('判断待ちのPRには手を出さない', () => {
    expect(moves({ prs: [pr(10, label('判断待ち'))] })).toEqual([]);
  });

  it('直し待ちのPRは、著者のセッションを起こす', () => {
    const board = { prs: [pr(10, label('直し待ち'))], sessions: [idle('session_a', 'task-9')] };
    expect(moves(board)).toEqual(['RESUME session_a mend 10 mend:10:aaa111']);
  });

  it('CIが赤いPRも、著者のセッションを起こす', () => {
    const board = {
      prs: [pr(10, { statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] })],
      sessions: [idle('session_a', 'task-9')],
    };
    expect(moves(board)).toEqual(['RESUME session_a mend 10 mend:10:aaa111']);
  });

  // 起こしたセッションが何もせずに止まると、盤面は前の周と同じまま残る。
  it('同じ差分で一度起こした相手は、二度起こさない', () => {
    const board = {
      prs: [pr(10, label('直し待ち'))],
      sessions: [idle('session_a', 'task-9')],
      taken: { 'resume:session_a': 'mend:10:aaa111' },
    };
    expect(moves(board)).toEqual([]);
  });

  it('直しが push されたら、また起こす', () => {
    const board = {
      prs: [pr(10, { ...label('直し待ち'), headRefOid: 'bbb222' })],
      sessions: [idle('session_a', 'task-9')],
      taken: { 'resume:session_a': 'mend:10:aaa111' },
    };
    expect(moves(board)).toEqual(['RESUME session_a mend 10 mend:10:bbb222']);
  });

  it('直している最中のセッションは起こさない', () => {
    const board = { prs: [pr(10, label('直し待ち'))], sessions: [working('session_a', 'task-9')] };
    expect(moves(board)).toEqual([]);
  });

  it('直す相手が畳まれていたら、打つ手が無いことを書き残す', () => {
    expect(moves({ prs: [pr(10, label('直し待ち'))] })).toEqual([
      'NOTE PR #10 は差し戻されたが、直す相手のセッションが居ない',
    ]);
  });

  it('レビューが走っているPRは、二重に出さない', () => {
    const board = { prs: [pr(10)], sessions: [working('session_r', 'review-10')] };
    expect(moves(board)).toEqual([]);
  });

  // 判定を書き終えたレビューが占有し続けると、次の差分のレビューが永久に止まる（1.2）。
  it('前のレビューが書き終えていれば、次のレビューを出す', () => {
    const board = { prs: [pr(10)], sessions: [idle('session_r', 'review-10')] };
    expect(moves(board)).toEqual(['REVIEW 10 aaa111']);
  });

  it('著者が書いている最中のPRは、レビューへ出さない', () => {
    const board = { prs: [pr(10)], sessions: [working('session_a', 'task-9')] };
    expect(moves(board)).toEqual([]);
  });

  it('同じ差分をレビューへ出したのに結論が付いていなければ、書き残すだけにする', () => {
    const board = { prs: [pr(10)], taken: { 'review:10': 'aaa111' } };
    expect(moves(board)).toEqual(['NOTE PR #10 はレビューへ出したが、結論のラベルが付いていない']);
  });

  it('チェックが1つも登録されていないPRは、落ち着くまで緑と読まない', () => {
    expect(moves({ prs: [pr(10, { statusCheckRollup: [], updatedAt: NOW })] })).toEqual([]);
    const still = '2026-09-05T00:30:00Z';
    expect(moves({ prs: [pr(10, { statusCheckRollup: [], updatedAt: still })] })).toEqual([
      'REVIEW 10 aaa111',
    ]);
  });

  it('走っているチェックが残っていれば、まだ読まない', () => {
    const board = { prs: [pr(10, { statusCheckRollup: [{ status: 'IN_PROGRESS' }] })] };
    expect(moves(board)).toEqual([]);
  });

  // 積まれたPRのCIは古い base の上で緑になり、レビューの差分にも下のPRの変更が混ざる。下が入れば
  // `merge-and-close.sh` が `main` へ張り替える（#1493 → #1508）。
  it('他のPRの上に積まれたPRは、緑でも触らない', () => {
    const board = { prs: [pr(10, { ...label('通してよい'), baseRefName: 'claude/issue-9' })] };
    expect(moves(board)).toEqual([
      'NOTE PR #10 は claude/issue-9 の上に積まれている（下が入るまで触らない）',
    ]);
  });

  it('下書きのPRには手を出さない', () => {
    expect(moves({ prs: [pr(10, { isDraft: true })] })).toEqual([]);
  });

  it('準備のできた issue を投入する', () => {
    const board = { issues: [{ number: 9, ...label('task'), blockedBy: { nodes: [] } }] };
    expect(moves(board)).toEqual(['TASK 9']);
  });

  // 打つのは1周に1手なので、新しい順のまま回すと後から出たPRが毎周先に拾われる。
  it('捌く順は、古いPRから', () => {
    expect(moves({ prs: [pr(30), pr(9), pr(20)] })).toEqual([
      'REVIEW 9 aaa111',
      'REVIEW 20 aaa111',
      'REVIEW 30 aaa111',
    ]);
  });

  // 一覧は新しい順に返る。そのまま使うと、古い issue が永久に後回しになる。
  it('投入する順は、古い issue から', () => {
    const ready = (number: number) => ({ number, ...label('task'), blockedBy: { nodes: [] } });
    expect(moves({ issues: [ready(30), ready(9), ready(20)] })).toEqual(['TASK 9', 'TASK 20', 'TASK 30']);
  });

  it('開いている issue に塞がれている間は投入しない', () => {
    const board = {
      issues: [{ number: 9, ...label('task'), blockedBy: { nodes: [{ state: 'OPEN' }] } }],
    };
    expect(moves(board)).toEqual([]);
  });

  it('PRの出ている issue は投入しない', () => {
    const board = {
      issues: [{ number: 9, ...label('task'), blockedBy: { nodes: [] } }],
      prs: [pr(10, label('判断待ち'))],
    };
    expect(moves(board)).toEqual([]);
  });

  // 並列度1（3.1）。作業領域の多次元ラベルが入るまでは、書くセッションは同時に1本まで。
  //
  // **黙って止めない。** `stall` は指紋で1回しか出ないので、起こしても動かないセッションが1本
  // 残ると TASK が永久に出ない。ログに何も出ないと「やることが無い周」と見分けが付かない。
  it('書くセッションが走っている間は投入せず、待っていることを書く', () => {
    const board = {
      issues: [{ number: 9, ...label('task'), blockedBy: { nodes: [] } }],
      sessions: [idle('session_a', 'task-8')],
    };
    expect(moves(board)).toEqual(['NOTE 1件の task が、書くセッション（session_a）の空きを待っている']);
  });

  // 走っているセッションが持っている issue は「投入済み」なので、待ちにも数えない（1.2）。
  it('走っているセッションが持つ issue しか無ければ、黙る', () => {
    const board = {
      issues: [{ number: 8, ...label('task'), blockedBy: { nodes: [] } }],
      sessions: [working('session_a', 'task-8')],
    };
    expect(moves(board)).toEqual([]);
  });

  it('PRを出さないまま手が空いたセッションを、1回だけ起こす', () => {
    const board = {
      issues: [{ number: 8, ...label('task'), blockedBy: { nodes: [] } }],
      sessions: [idle('session_a', 'task-8')],
    };
    expect(moves(board)).toEqual(['RESUME session_a stall 8 stall:8']);
    expect(moves({ ...board, taken: { 'resume:session_a': 'stall:8' } })).toEqual([]);
  });

  it('issue が閉じていれば、手が空いていても起こさない', () => {
    expect(moves({ sessions: [idle('session_a', 'task-8')] })).toEqual([]);
  });
});
