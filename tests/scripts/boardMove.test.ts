import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { moves as decide } from '../../scripts/agent/board-move.mjs';

/**
 * `scripts/agent/board-move.mjs` の検査。
 *
 * ここが守るのは**盤面から出る手が1つに決まること**。デーモンは出た手をそのまま打つので
 * （`.claude/board-design.md` 2.3）、判定を間違えると走っているセッションへ二重に投げるか、
 * 直しを待つPRが誰にも渡らないまま止まる。同じ盤面へ同じ手を二度出さないことも見る。
 */

const NOW = '2026-09-05T02:00:00Z';
/** これより前に更新が止まっているPRは、チェックが0本でも緑と読む。 */
const SETTLED = '2026-09-05T01:00:00Z';

interface Board {
  settledBefore?: string;
  /** `main` の先頭のCI。省くと緑（既存の盤面はどれも `main` が緑のときの話）。 */
  mainChecks?: readonly unknown[];
  prs?: readonly unknown[];
  issues?: readonly unknown[];
  sessions?: readonly {
    id: string;
    status: string;
    bucket: string;
    /** どこで走っているか（`cloud` / `bridge`、引けなければ `-`）。省いた盤面は環境を見ない。 */
    env?: string;
    tags: readonly string[];
  }[];
  /** 生きたワーカーの担当 issue のうち、開いている一覧に載っていなかったものの `state`。 */
  issueStates?: Record<number, string>;
  /** PRごとの、そのPRを書いたセッション（コミットの `Claude-Session:` トレーラ）。 */
  prSessions?: Record<number, string>;
  taken?: Record<string, string>;
}

/**
 * 手が空いているセッションは、既定で**十分に空いたまま**として渡す（`board-move.mjs` の
 * `STALL_MINUTES`）。停滞を入口にする手はどれもそこを通るので、**盤面ごとに書くと、書き忘れた
 * 盤面だけが黙って手を出さなくなる。** 空いたばかりの形を見たい検査は、`taken` で上書きする。
 */
const LONG_IDLE = '2026-09-04T02:00:00Z';

function moves(board: Board): string[] {
  const idled: Record<string, string> = {};
  for (const session of board.sessions ?? []) {
    if (session.status !== 'SESSION_STATUS_RUNNING') idled[`idle:${session.id}`] = LONG_IDLE;
  }
  return decide({
    now: NOW,
    settledBefore: SETTLED,
    prs: [],
    issues: [],
    sessions: [],
    ...board,
    taken: { ...idled, ...board.taken },
  });
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
      prSessions: { 10: 'session_a' },
      sessions: [idle('session_a')],
    };
    expect(moves(board)).toEqual(['RESUME session_a mend 10 mend:10:aaa111']);
  });

  // まだ計算中。次の周には決まるので、何も打たずに待つ。
  it('mergeable が引けていない周は、マージしない', () => {
    expect(moves({ prs: [pr(10, { ...label('通してよい'), mergeable: 'UNKNOWN' })] })).toEqual([]);
  });

  // `main` が動くたびに全部のPRがここへ落ちる。`CONFLICTING` だけを弾く形にすると、その隙間の周が
  // コンフリクトしたままレビューへ出す（#1538 で実際に出た。board-design 2.12.2）。
  it('mergeable が引けていない周は、レビューへも出さない', () => {
    expect(moves({ prs: [pr(10, { mergeable: 'UNKNOWN' })] })).toEqual([]);
  });

  // **`mend` ではなく `look`。** 撮って貼る作業は差分を直す作業と違うので、渡す文面を分ける（1.3）。
  it('画面が変わるのに 見た目 が無ければ、レビューへ出さずに書いた本人へ差し戻す', () => {
    const board = {
      prs: [pr(10, { files: [{ path: 'src/game/ui/Card.ts' }] })],
      prSessions: { 10: 'session_a' },
      sessions: [idle('session_a')],
    };
    expect(moves(board)).toEqual(['RESUME session_a look 10 look:10:aaa111']);
  });

  it('画面が変わらないPRには、見た目 を求めない', () => {
    expect(moves({ prs: [pr(10, { files: [{ path: 'src/domain/Slot.ts' }] })] })).toEqual([
      'REVIEW 10 aaa111',
    ]);
  });

  it('見た目 が書いてあればレビューへ出す', () => {
    const board = {
      prs: [
        pr(10, {
          files: [{ path: 'src/assets/cards/axe.webp' }],
          body: 'Closes #9\n\n## 見た目\n\n不要（絵の差し替えだけ）\n',
        }),
      ],
    };
    expect(moves(board)).toEqual(['REVIEW 10 aaa111']);
  });

  // 節だけ置いて中身を書かない形。画像も「不要」＋理由も無いので、後から補えるものが差分に残らない。
  it('見た目 の節が空なら、無いのと同じに扱う', () => {
    const board = {
      prs: [
        pr(10, {
          files: [{ path: 'src/game/ui/Card.ts' }],
          body: 'Closes #9\n\n## 見た目\n\n## 自己点検\n\n0件。\n',
        }),
      ],
      prSessions: { 10: 'session_a' },
      sessions: [idle('session_a')],
    };
    expect(moves(board)).toEqual(['RESUME session_a look 10 look:10:aaa111']);
  });

  // 人の手番の印は、効き目を1つずつ持つ（2.13.2）。**どちらの下でも差し戻しは出る。**
  it('判断待ちのPRは、マージしない', () => {
    expect(moves({ prs: [pr(10, label('通してよい', '判断待ち'))] })).toEqual([]);
  });

  it('判断待ちでも、コンフリクトは差し戻す', () => {
    const board = {
      prs: [pr(10, { ...label('判断待ち'), mergeable: 'CONFLICTING' })],
      prSessions: { 10: 'session_a' },
      sessions: [idle('session_a')],
    };
    expect(moves(board)).toEqual(['RESUME session_a mend 10 mend:10:aaa111']);
  });

  it('収束せずのPRは、レビューへ出さない', () => {
    expect(moves({ prs: [pr(10, label('収束せず'))] })).toEqual([]);
  });

  it('収束せずでも、CIが赤ければ差し戻す', () => {
    const board = {
      prs: [
        pr(10, {
          ...label('収束せず'),
          statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }],
        }),
      ],
      prSessions: { 10: 'session_a' },
      sessions: [idle('session_a')],
    };
    expect(moves(board)).toEqual(['RESUME session_a mend 10 mend:10:aaa111']);
  });

  it('収束せずのPRに人が通してよいを付けたら、マージする', () => {
    expect(moves({ prs: [pr(10, label('収束せず', '通してよい'))] })).toEqual(['MERGE 10']);
  });

  // **`mend` ではなく `reject`。** 指摘に答えるのではなく、通らなかった仮決めを取り下げる作業。
  it('却下のPRは、仮決めを取り下げさせる形で差し戻す', () => {
    const board = {
      prs: [pr(10, label('却下'))],
      prSessions: { 10: 'session_a' },
      sessions: [idle('session_a')],
    };
    expect(moves(board)).toEqual(['RESUME session_a reject 10 reject:10:aaa111']);
  });

  // **却下は判断待ちの出口。** 外す手間を人に負わせないので、両方付いたまま届く（2.13.1）。
  it('判断待ちが付いたままでも、却下は差し戻す', () => {
    const board = {
      prs: [pr(10, label('判断待ち', '却下'))],
      prSessions: { 10: 'session_a' },
      sessions: [idle('session_a')],
    };
    expect(moves(board)).toEqual(['RESUME session_a reject 10 reject:10:aaa111']);
  });

  // 枠は1つしか無いので、種類を指紋に入れないと後から来たほうが黙って落ちる。
  it('同じ差分でも、直しの後の却下は落とさない', () => {
    const board = {
      prs: [pr(10, label('却下'))],
      prSessions: { 10: 'session_a' },
      sessions: [idle('session_a')],
      taken: { 'resume:session_a': 'mend:10:aaa111' },
    };
    expect(moves(board)).toEqual(['RESUME session_a reject 10 reject:10:aaa111']);
  });

  // 差し戻す相手は、そのPRを書いたセッション（2.11）。**`Closes` では引かない**——あれは
  // どの issue が閉じるかの印であって、誰が書いたかを指していない。
  it('直し待ちのPRは、トレーラが指すセッションを起こす', () => {
    const board = {
      prs: [pr(10, label('直し待ち'))],
      prSessions: { 10: 'session_a' },
      // `task-9` を持つほうは `Closes #9` の相手。書いたのが誰かとは別なので、選ばれない。
      sessions: [idle('session_a'), idle('session_holder', 'task-9')],
    };
    expect(moves(board)).toEqual(['RESUME session_a mend 10 mend:10:aaa111']);
  });

  // **畳む合図を、他の手が起きることに繋がない。** マージのついでに掃いていたときは、人が画面から
  // マージしたPRのレビューが誰にも掃かれず残った（#1549）。
  it('走り終わったレビューのセッションを畳む', () => {
    expect(moves({ sessions: [idle('session_r', 'review-1549')] })).toEqual(['ARCHIVE session_r read:1549']);
  });

  // レビューは使い回さないので、走っていないことがそのまま「もう誰も起こさない」。**PRが開いて
  // いるかは見ない**——見ると、閉じないPR（`収束せず`・`直し待ち` のまま）のぶんが永久に残る。
  it('PRが開いていても、走り終わったレビューは畳む', () => {
    const board = { prs: [pr(1549)], sessions: [idle('session_r', 'review-1549')] };

    expect(moves(board)).toContain('ARCHIVE session_r read:1549');
  });

  // **「走り終わった」と「道具の承認を待っている」は同じ形に見える**（1.6）。30秒で畳んだ盤面は、
  // 承認を求めて止まったレビューを判定を書く前に消し、そのPRを永久に止めた（PR #1573・issue #1569）。
  it('手が止まったばかりのレビューは、まだ畳まない', () => {
    const board = {
      sessions: [idle('session_a', 'review-10')],
      taken: { 'idle:session_a': '2026-09-05T01:59:00Z' },
    };
    expect(moves(board)).toEqual([]);
  });

  it('走っているレビューは畳まない', () => {
    expect(moves({ sessions: [working('session_r', 'review-1549')] })).toEqual([]);
  });

  it('一度畳もうとして残されたレビューは、二度打たない', () => {
    const board = {
      sessions: [idle('session_r', 'review-1549')],
      taken: { 'archive:session_r': 'read:1549' },
    };

    expect(moves(board)).toEqual([]);
  });

  it('CIが赤いPRも、書いたセッションを起こす', () => {
    const board = {
      prs: [pr(10, { statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] })],
      prSessions: { 10: 'session_a' },
      sessions: [idle('session_a')],
    };
    expect(moves(board)).toEqual(['RESUME session_a mend 10 mend:10:aaa111']);
  });

  const RED_MAIN = [{ status: 'COMPLETED', conclusion: 'FAILURE' }];
  const redPr = (number: number, over: Record<string, unknown> = {}) =>
    pr(number, { statusCheckRollup: RED_MAIN, ...over });

  // **`main` が赤いと、それを取り込んだPRは作業者が何をしても緑にならない**（2.14）。指紋は push の
  // たびに変わるので、止めないと押し返されるたびに新しい手として通り、差し戻しが終わらない。
  // 2026-09-05 に `main` の試験が Linux でだけ落ち、開いていたPRがこれで回りかけた。
  it('main が赤い間は、直しを頼まない', () => {
    const board = {
      mainChecks: RED_MAIN,
      prs: [redPr(10)],
      prSessions: { 10: 'session_a' },
      sessions: [idle('session_a')],
    };
    expect(moves(board)).toEqual(['NOTE PR #10 はCIが赤いが、`main` が赤いので直しを頼まない']);
  });

  // 止めるのは `mend` だけ。**仮決めの取り下げも画面の証跡も、`main` の色と関わらない作業**なので、
  // ここまで止めると `main` の赤が長引いた分だけ関係の無い手が遅れる。
  it('main が赤くても、却下は差し戻す', () => {
    const board = {
      mainChecks: RED_MAIN,
      prs: [redPr(10, label('却下'))],
      prSessions: { 10: 'session_a' },
      sessions: [idle('session_a')],
    };
    expect(moves(board)).toEqual(['RESUME session_a reject 10 reject:10:aaa111']);
  });

  it('main が赤くても、見た目 の欠けは差し戻す', () => {
    const board = {
      mainChecks: RED_MAIN,
      prs: [redPr(10, { files: [{ path: 'src/game/ui/Card.ts' }] })],
      prSessions: { 10: 'session_a' },
      sessions: [idle('session_a')],
    };
    expect(moves(board)).toEqual(['RESUME session_a look 10 look:10:aaa111']);
  });

  // **止めるのは赤と分かったときだけ。** 走っている最中を赤に含めると、`main` へ push が入るたびに
  // 差し戻しが数分止まる。
  it('main のCIが走っている間は、直しを頼む', () => {
    const board = {
      mainChecks: [{ status: 'IN_PROGRESS', conclusion: '' }],
      prs: [redPr(10)],
      prSessions: { 10: 'session_a' },
      sessions: [idle('session_a')],
    };
    expect(moves(board)).toEqual(['RESUME session_a mend 10 mend:10:aaa111']);
  });

  // 起こしたセッションが何もせずに止まると、盤面は前の周と同じまま残る。
  it('同じ差分で一度起こした相手は、二度起こさない', () => {
    const board = {
      prs: [pr(10, label('直し待ち'))],
      prSessions: { 10: 'session_a' },
      sessions: [idle('session_a')],
      taken: { 'resume:session_a': 'mend:10:aaa111' },
    };
    expect(moves(board)).toEqual([]);
  });

  it('直しが push されたら、また起こす', () => {
    const board = {
      prs: [pr(10, { ...label('直し待ち'), headRefOid: 'bbb222' })],
      prSessions: { 10: 'session_a' },
      sessions: [idle('session_a')],
      taken: { 'resume:session_a': 'mend:10:aaa111' },
    };
    expect(moves(board)).toEqual(['RESUME session_a mend 10 mend:10:bbb222']);
  });

  it('直している最中のセッションは起こさない', () => {
    const board = {
      prs: [pr(10, label('直し待ち'))],
      prSessions: { 10: 'session_a' },
      sessions: [working('session_a')],
    };
    expect(moves(board)).toEqual([]);
  });

  it('トレーラの指すセッションが畳まれていたら、打つ手が無いことを書き残す', () => {
    const board = { prs: [pr(10, label('直し待ち'))], prSessions: { 10: 'session_writer' } };
    expect(moves(board)).toEqual(['NOTE PR #10 は差し戻されたが、直す相手が畳まれている']);
  });

  // **名乗っていないPRは差し戻せない。** 規則の破れなので、直すのは人（2.11.2）。畳まれていた
  // ときと同じ文面にすると、人が手を入れるべき側が読めない。
  it('名乗っていないPRは、そうと分かる形で書き残す', () => {
    expect(moves({ prs: [pr(10, label('直し待ち'))] })).toEqual([
      'NOTE PR #10 は差し戻されたが、書いたセッションが名乗っていない',
    ]);
  });

  // `..._BLOCKED` は手番を終えて人へ問いを返した状態で、手は空いている（board-design 1.6 の実測）。
  // busy と読むと、その著者のPRのレビューが永久に出ない（#1541 が2時間止まった）。
  it('著者が人へ問いを返して止まっていても、レビューへ出す', () => {
    const board = {
      prs: [pr(10)],
      sessions: [
        {
          id: 'session_a',
          status: 'SESSION_STATUS_IDLE',
          bucket: 'SESSION_STATUS_BUCKET_BLOCKED',
          tags: ['task-9'],
        },
      ],
    };
    expect(moves(board)).toEqual(['REVIEW 10 aaa111']);
  });

  it('レビューが走っているPRは、二重に出さない', () => {
    const board = { prs: [pr(10)], sessions: [working('session_r', 'review-10')] };
    expect(moves(board)).toEqual([]);
  });

  // 判定を書き終えたレビューが占有し続けると、次の差分のレビューが永久に止まる（1.2）。
  // 畳む手が先に出るので、次の1本は次の周（打つのは1周に1手）。
  it('前のレビューが書き終えていれば、畳んでから次のレビューを出す', () => {
    const board = { prs: [pr(10)], sessions: [idle('session_r', 'review-10')] };
    expect(moves(board)).toEqual(['ARCHIVE session_r read:10', 'REVIEW 10 aaa111']);
  });

  it('著者が書いている最中のPRは、レビューへ出さない', () => {
    const board = { prs: [pr(10)], sessions: [working('session_a', 'task-9')] };
    expect(moves(board)).toEqual([]);
  });

  // 読み手が手を止めているだけの間（道具の承認待ちなど）は、まだ読んでいる最中。
  it('出した差分を読み手がまだ持っているなら、二度出さない', () => {
    const board = {
      prs: [pr(10)],
      sessions: [idle('session_r', 'review-10')],
      taken: { 'review:10': 'aaa111', 'idle:session_r': '2026-09-05T01:59:00Z' },
    };
    expect(moves(board)).toEqual(['NOTE PR #10 はレビューが読んでいる最中で、結論のラベルはまだ無い']);
  });

  // 指紋だけを見て「出した＝読まれた」と読むと、判定を書かずに終わったレビューがそのPRを永久に
  // 止める（issue #1569）。読み手が居なくなっていることが、その読みが終わった印。
  it('出した差分の読み手が居なくなっていれば、もう一度出す', () => {
    const board = { prs: [pr(10)], taken: { 'review:10': 'aaa111' } };
    expect(moves(board)).toEqual([
      'REVIEW 10 aaa111',
      'NOTE PR #10 のレビューは判定を書かずに終わったので、もう一度出す',
    ]);
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
      // レビューへ出る側の手は別の試験で見ているので、ここでは投入が出ないことだけを見る。
      prs: [pr(10, label('収束せず'))],
    };
    expect(moves(board)).toEqual([]);
  });

  // **並べてよいかは、錠と本数で決める**（3.1・`parallel-work.md` 2節）。**同じファイルを書くことは
  // 止めない**——ぶつかったら `mend` で直させ、実績は `board-round.mjs` が控える。
  it('錠を持たない issue は、隣が走っていても並べて投入する', () => {
    const board = {
      issues: [
        { number: 9, ...label('task'), blockedBy: { nodes: [] } },
        { number: 8, ...label('task'), blockedBy: { nodes: [] } },
      ],
      sessions: [working('session_a', 'task-8')],
    };
    expect(moves(board)).toEqual(['TASK 9']);
  });

  // **錠が指すのは、同時に1本しか動かせない資源**（`parallel-work.md` 2節）。触るファイルが
  // 分かれていても、GPUやデーモンの実体は1本しか使えない。
  //
  // **黙って止めない。** `stall` は指紋で1回しか出ないので、起こしても動かないセッションが1本
  // 残ると TASK が永久に出ない。ログに何も出ないと「やることが無い周」と見分けが付かない。
  it('同じ area: の錠を取り合う issue は投入せず、何を取り合うかを書く', () => {
    const board = {
      issues: [
        { number: 9, ...label('task', 'area:daemon'), blockedBy: { nodes: [] } },
        { number: 8, ...label('task', 'area:daemon'), blockedBy: { nodes: [] } },
      ],
      sessions: [working('session_a', 'task-8')],
    };
    expect(moves(board)).toEqual([
      'NOTE 1件の task が待っている。先頭は #9 と #8 が `area:daemon` を取り合う',
    ]);
  });

  it('錠が違えば、走っている隣へ並べて投入する', () => {
    const board = {
      issues: [
        { number: 9, ...label('task', 'area:art'), blockedBy: { nodes: [] } },
        { number: 8, ...label('task', 'area:daemon'), blockedBy: { nodes: [] } },
      ],
      sessions: [working('session_a', 'task-8')],
    };
    expect(moves(board)).toEqual(['TASK 9']);
  });

  // 掴んでいる issue が開いている一覧に無ければ、錠が読めない。**知らないことを「取り合わない」
  // として読まない。**
  it('走っているセッションの担当が読めなければ、錠を持つ issue は投入しない', () => {
    const board = {
      issues: [{ number: 9, ...label('task', 'area:art'), blockedBy: { nodes: [] } }],
      sessions: [working('session_a', 'task-8')],
      issueStates: { 8: 'OPEN' },
    };
    expect(moves(board)).toEqual(['NOTE 1件の task が待っている。先頭は session_a の担当（#8）が読めない']);
  });

  // **担当が閉じていても、走っている限り資源は掴んだまま。** 本数の勘定からは外すが（走行中は
  // 畳めないので、待つと枠が空かない）、錠の側で外すと**同じ資源を2本が取り合う**。
  it('担当の閉じたセッションが走っている間も、錠を持つ issue は投入しない', () => {
    const board = {
      issues: [{ number: 9, ...label('task', 'area:art'), blockedBy: { nodes: [] } }],
      sessions: [working('session_a', 'task-8')],
      issueStates: { 8: 'CLOSED' },
    };
    expect(moves(board)).toEqual(['NOTE 1件の task が待っている。先頭は session_a の担当（#8）が読めない']);
  });

  // **上限は錠とは別の手綱**（3.1）。錠を持たない issue はいくらでも並ぶので、ここでしか止まらない。
  it('書くセッションが上限まで走っていれば、錠が無くても投入しない', () => {
    const board = {
      issues: [6, 7, 8, 9].map((number) => ({
        number,
        ...label('task'),
        blockedBy: { nodes: [] },
      })),
      sessions: [
        working('session_a', 'task-6'),
        working('session_b', 'task-7'),
        working('session_c', 'task-8'),
      ],
    };
    expect(moves(board)).toEqual(['NOTE 1件の task が、書くセッション3本の空きを待っている']);
  });

  // 走らせる先は issue のラベルにある（2.16）。盤面は投入先を引数の形で寄越し、`board-round.mjs`
  // はそれをそのまま `dispatch-task.sh` へ渡す。
  it('env:bridge の issue は、ブリッジへ投入する', () => {
    const board = { issues: [{ number: 9, ...label('task', 'env:bridge'), blockedBy: { nodes: [] } }] };
    expect(moves(board)).toEqual(['TASK 9 --bridge']);
  });

  // **既定へ落とさない。** 落とすと、そこでしかできないから宛先を書いた仕事が黙って別の場所で
  // 走り、指定が無視されたことが誰にも残らない（2.16.1）。
  it('知らない env: の issue は配らず、覚え書きを出す', () => {
    const board = { issues: [{ number: 9, ...label('task', 'env:mars'), blockedBy: { nodes: [] } }] };
    expect(moves(board)).toEqual(['NOTE issue #9 の `env:mars` は知らない宛先']);
  });

  it('env: が重ねて付いた issue も配らない', () => {
    const board = {
      issues: [{ number: 9, ...label('task', 'env:bridge', 'env:cloud'), blockedBy: { nodes: [] } }],
    };
    expect(moves(board)).toEqual(['NOTE issue #9 に `env:` が重ねて付いている']);
  });

  // クラウドで走り出した後に `env:bridge` が付いたら、そこはもうこの仕事の場所ではない（2.16.2）。
  // 畳めば枠が空き、次の周が正しい先で立て直す。
  it('走らせる先が食い違ったワーカーは畳む', () => {
    const board = {
      issues: [{ number: 9, ...label('task', 'env:bridge'), blockedBy: { nodes: [] } }],
      sessions: [{ ...idle('session_a', 'task-9'), env: 'cloud' }],
    };
    expect(moves(board)).toEqual(['ARCHIVE session_a moved:9']);
  });

  it('走らせる先が合っているワーカーは畳まない', () => {
    const board = {
      issues: [{ number: 9, ...label('task', 'env:bridge'), blockedBy: { nodes: [] } }],
      sessions: [{ ...idle('session_a', 'task-9'), env: 'bridge' }],
    };
    expect(moves(board)).toEqual(['RESUME session_a stall 9 stall:9']);
  });

  // **知らないことを「違う」として読まない。** 引けなかった環境を食い違いと読むと、正しく走って
  // いるセッションが落ちる。
  it('環境を引けなかったワーカーは畳まない', () => {
    const board = {
      issues: [{ number: 9, ...label('task', 'env:bridge'), blockedBy: { nodes: [] } }],
      sessions: [{ ...idle('session_a', 'task-9'), env: '-' }],
    };
    expect(moves(board)).toEqual(['RESUME session_a stall 9 stall:9']);
  });

  // **畳めるのはクラウドのセッションだけ**（`archive-session.sh` はブリッジを `KEPT` にする）。
  // 出しても畳まれず、**指紋だけが残ってそのワーカーが二度と起こされず人へも返らなくなる。**
  // `env:` の付かない issue をブリッジで走らせる形は実在する（棚卸し役・手元からの投入）ので、
  // 既定の `cloud` との食い違いがそのまま当たる。
  it('ブリッジのワーカーは、走らせる先が食い違っていても畳まない', () => {
    const board = {
      issues: [{ number: 9, ...label('task'), blockedBy: { nodes: [] } }],
      sessions: [{ ...idle('session_a', 'task-9'), env: 'bridge' }],
    };
    expect(moves(board)).toEqual(['RESUME session_a stall 9 stall:9']);
  });

  // **PRを出した後は動かさない**（2.16.2）。畳むと、そのPRの直しを頼む相手が居なくなる。
  it('PRを出した後のワーカーは、走らせる先が食い違っていても畳まない', () => {
    const board = {
      issues: [{ number: 9, ...label('task', 'env:bridge'), blockedBy: { nodes: [] } }],
      prs: [pr(10, label('収束せず'))],
      sessions: [{ ...idle('session_a', 'task-9'), env: 'cloud' }],
    };
    expect(moves(board)).toEqual([]);
  });

  // 畳んでも次の周は投入で止まるので、枠を空ける意味が無い（2.16.2）。
  it('配り直す先が無ければ、食い違っていても畳まない', () => {
    const board = {
      issues: [{ number: 9, ...label('task', 'env:mars'), blockedBy: { nodes: [] } }],
      sessions: [{ ...idle('session_a', 'task-9'), env: 'cloud' }],
    };
    expect(moves(board)).toEqual(['RESUME session_a stall 9 stall:9']);
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
  });

  // 起こしても何も出てこなければ、そこで人へ返す（2.15.3）。返した後は、同じセッションへも
  // その issue へも手を出さない——指紋の枠は1つなので、`stall:` を `returned:` が上書きする。
  it('起こしても動かないセッションの仕事を、人へ返す', () => {
    const board = {
      issues: [{ number: 8, ...label('task'), blockedBy: { nodes: [] } }],
      sessions: [idle('session_a', 'task-8')],
      taken: { 'idle:session_a': LONG_IDLE, 'resume:session_a': 'stall:8' },
    };
    expect(moves(board)).toEqual(['RETURN 8 session_a returned:8']);
    expect(
      moves({ ...board, taken: { 'idle:session_a': LONG_IDLE, 'resume:session_a': 'returned:8' } }),
    ).toEqual([]);
  });

  /**
   * **「手が空いている」ことそのものは停滞ではない。** ワーカーは手番の切れ目ごとに空き、下請けの
   * レビューを待つ間も空いて見える（1.6）。1度見ただけで停滞と読んだ盤面は、押し切る寸前の作業を
   * 人へ返して畳んだ（2026-09-06、issue #1506。`staging ready to push` のまま返却された）。
   */
  describe('空いていることではなく、空いたままであることを見る', () => {
    const stalling = (over: Record<string, string>) => ({
      issues: [{ number: 8, ...label('task'), blockedBy: { nodes: [] } }],
      sessions: [idle('session_a', 'task-8')],
      taken: over,
    });

    it('空いたばかりのワーカーは起こさない', () => {
      // NOW の1分前。
      expect(moves(stalling({ 'idle:session_a': '2026-09-05T01:59:00Z' }))).toEqual([]);
    });

    // **覚えが無いのは「ずっと空いている」ではない。** 台帳が消えた直後もここへ来るので、
    // 動かない側へ倒す（打つ手はどちらも取り返しが付かない）。上の既定を通さずに直に渡す。
    it('空いてからの長さが分からなければ、何もしない', () => {
      const board = stalling({});
      expect(decide({ now: NOW, settledBefore: SETTLED, prs: [], ...board })).toEqual([]);
    });

    // **起こした合図が効くには時間が要る。** 次の周（既定30秒）で見限ると、届く前に必ず返す。
    it('起こした直後は、まだ人へ返さない', () => {
      // 起こしたのは空いてから15分の時点。まだ20分しか経っていない。
      const board = stalling({
        'idle:session_a': '2026-09-05T01:40:00Z',
        'resume:session_a': 'stall:8',
      });
      expect(moves(board)).toEqual([]);
    });
  });

  // 返ってきた issue は、人が `判断待ち` を外すまで誰にも配らない（2.15.2）。**`task` は
  // 付いたまま**なので、この判定が抜けると次の周にそのまま投入し直される。
  it('`判断待ち` の付いた task issue は配らない', () => {
    expect(
      moves({ issues: [{ number: 8, ...label('task', '判断待ち'), blockedBy: { nodes: [] } }] }),
    ).toEqual([]);
  });

  // 返した issue を担当していたワーカーは、畳んでよい（2.10）。閉じたときと指紋を分けるのは、
  // ログから畳んだ理由が読めるようにするため。
  it('返された issue を担当していたワーカーを畳む', () => {
    const board = {
      issues: [{ number: 8, ...label('task', '判断待ち'), blockedBy: { nodes: [] } }],
      sessions: [idle('session_a', 'task-8')],
    };
    expect(moves(board)).toEqual(['ARCHIVE session_a returned:8']);
    expect(moves({ ...board, taken: { 'archive:session_a': 'returned:8' } })).toEqual([]);
  });

  it('issue が閉じていれば、手が空いていても起こさない', () => {
    expect(moves({ sessions: [idle('session_a', 'task-8')] })).toEqual([]);
  });

  // 畳む条件は担当の issue が閉じたことで、PRがマージされたかとは別（2.10）。畳まなかったという
  // 答えは issue が閉じているかぎり変わらないので、指紋を打った後は出さない。
  it('担当の issue が閉じたワーカーを畳む', () => {
    const board = {
      sessions: [idle('session_a', 'task-8')],
      issueStates: { 8: 'CLOSED' },
    };
    expect(moves(board)).toEqual(['ARCHIVE session_a closed:8']);
    expect(moves({ ...board, taken: { 'archive:session_a': 'closed:8' } })).toEqual([]);
  });

  it('まだ手が動いているワーカーは、issue が閉じていても畳まない', () => {
    const board = {
      sessions: [working('session_a', 'task-8')],
      issueStates: { 8: 'CLOSED' },
    };
    expect(moves(board)).toEqual([]);
  });

  // 畳むのはマージの次。後ろへ回すと、終わったワーカーが枠を握ったまま TASK が出ない周が続く。
  it('畳む手は、マージの次・投入の前に打つ', () => {
    const board = {
      prs: [pr(10, label('通してよい'))],
      issues: [{ number: 20, ...label('task'), blockedBy: { nodes: [] } }],
      sessions: [idle('session_a', 'task-8')],
      issueStates: { 8: 'CLOSED' },
    };
    expect(moves(board)).toEqual(['MERGE 10', 'ARCHIVE session_a closed:8', 'TASK 20']);
  });

  // **盤面が出す語が、そのまま起こす文面の節名になる**（`resume-session.sh`）。2箇所が暗黙に
  // 一致すべき規約なので、片方だけ足したときにここで落とす——足りないと `resume-session.sh` が
  // 「ひな形に節が無い」で失敗し、**起こす手だけが毎周打てないまま残る。**
  it('起こす手の種類には、渡す文面の節がある', () => {
    const boards: Board[] = [
      { prs: [pr(10, label('直し待ち'))], prSessions: { 10: 'a' }, sessions: [idle('a')] },
      { prs: [pr(10, label('却下'))], prSessions: { 10: 'a' }, sessions: [idle('a')] },
      {
        prs: [pr(10, { files: [{ path: 'src/game/ui/Card.ts' }] })],
        prSessions: { 10: 'a' },
        sessions: [idle('a')],
      },
      {
        issues: [{ number: 9, ...label('task'), blockedBy: { nodes: [] } }],
        sessions: [idle('a', 'task-9')],
      },
    ];
    const kinds = boards
      .flatMap(moves)
      .filter((move) => move.startsWith('RESUME '))
      .map((move) => move.split(' ')[2]);
    expect(kinds).toEqual(['mend', 'reject', 'look', 'stall']);

    const template = readFileSync(resolve(__dirname, '../../.claude/resume-prompt.md'), 'utf-8');
    for (const kind of kinds) expect(template).toContain(`\n## ${kind} `);
  });
});
