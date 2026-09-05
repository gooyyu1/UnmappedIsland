import { describe, expect, it } from 'vitest';

import { ARCHIVE_REVIEWS, run } from '../support/mergeAndCloseWorld';

/**
 * マージのときと対になる、**PRが開いているとき**の経路（`dispatch-review.sh` が次を立てる直前に呼ぶ）。
 * `merge-and-close.sh` と同じ世界を使う——`gh pr merge` を呼ばないので `state` は `OPEN` のまま。
 *
 * 世界の組み方と、ファイルを分けてある理由は `tests/support/mergeAndCloseWorld.ts`。
 */
describe('archive-reviews.sh', () => {
  // ここで畳むと、書きかけの判定はコメントに出ないまま消える。守っても、次の投入かマージで
  // もう一度渡されるので取りこぼしにはならない——**これが成り立つのはPRが開いている間だけ**。
  it('PRが開いている間は、走っている最中のレビューを守る', () => {
    const result = run(
      {
        sessions: {
          session_01REVIEWAAAAAAAAAAAAAA: 'SESSION_STATUS_RUNNING',
          session_01REVIEWBBBBBBBBBBBBBB: 'SESSION_STATUS_IDLE',
        },
        tags: {
          session_01REVIEWAAAAAAAAAAAAAA: ['review-1000'],
          session_01REVIEWBBBBBBBBBBBBBB: ['review-1000'],
        },
        working: ['session_01REVIEWAAAAAAAAAAAAAA'],
      },
      [ARCHIVE_REVIEWS],
    );

    expect(result.lines).toEqual([
      'KEPT session_01REVIEWAAAAAAAAAAAAAA',
      'ARCHIVED session_01REVIEWBBBBBBBBBBBBBB',
    ]);
    expect(result.archived).toEqual(['session_01REVIEWBBBBBBBBBBBBBB']);
    expect(result.status).toBe(0);
  });

  // 掃く範囲を「呼ばれた瞬間のPR1本」に絞ると、**次の投入もマージも来ないPR**のレビューが永久に
  // 残る。開いていないPRのぶんは、走行中でも畳む——判定を書き終えても読む相手が無い。
  it('開いていないPRのレビューは、走っている最中でも畳む', () => {
    const result = run(
      {
        openPrs: [1000],
        sessions: {
          session_01REVIEWAAAAAAAAAAAAAA: 'SESSION_STATUS_RUNNING',
          session_01REVIEWCLOSED000000: 'SESSION_STATUS_RUNNING',
        },
        tags: {
          session_01REVIEWAAAAAAAAAAAAAA: ['review-1000'],
          session_01REVIEWCLOSED000000: ['review-1001'],
        },
        working: ['session_01REVIEWAAAAAAAAAAAAAA', 'session_01REVIEWCLOSED000000'],
      },
      [ARCHIVE_REVIEWS],
    );

    expect(result.lines).toEqual([
      'KEPT session_01REVIEWAAAAAAAAAAAAAA',
      'ARCHIVED session_01REVIEWCLOSED000000',
    ]);
    expect(result.status).toBe(0);
  });

  // 状態を引けない日に「開いていない」へ倒れると、書きかけの判定を畳んでしまう。畳んで消えた
  // コメントは戻せないが、守って残ったものは手で畳める。畳むのは「閉じていると分かったとき」だけ。
  it('開いているPRの一覧を引けなかったときも、走っている最中のレビューを守る', () => {
    const result = run(
      {
        prListFails: true,
        sessions: { session_01REVIEWAAAAAAAAAAAAAA: 'SESSION_STATUS_RUNNING' },
        tags: { session_01REVIEWAAAAAAAAAAAAAA: ['review-1000'] },
        working: ['session_01REVIEWAAAAAAAAAAAAAA'],
      },
      [ARCHIVE_REVIEWS],
    );

    expect(result.lines).toEqual(['KEPT session_01REVIEWAAAAAAAAAAAAAA']);
    expect(result.archived).toEqual([]);
    expect(result.status).toBe(0);
  });

  // 「引けなかった」と「1本も開いていない」を空かどうかで分けると、最後の1本をマージした直後が
  // 引けなかった日と同じ扱いになり、そのPRのレビューが `KEPT` のまま残る。分けるのは終了コード。
  it('開いているPRが1本も無いときは、引けなかった日とは違って畳む', () => {
    const result = run(
      {
        openPrs: [],
        sessions: { session_01REVIEWAAAAAAAAAAAAAA: 'SESSION_STATUS_RUNNING' },
        tags: { session_01REVIEWAAAAAAAAAAAAAA: ['review-1000'] },
        working: ['session_01REVIEWAAAAAAAAAAAAAA'],
      },
      [ARCHIVE_REVIEWS],
    );

    expect(result.lines).toEqual(['ARCHIVED session_01REVIEWAAAAAAAAAAAAAA']);
    expect(result.status).toBe(0);
  });

  // 引けなければ、走行中かもブリッジかも分からない。空の応答から全部のキーが `""` に落ちるので、
  // 何も書かなければ「走行中でもブリッジでもない」＝畳む側へ倒れる。上と同じ理由で守る側にする。
  it('セッションを引けなかったときは畳まない', () => {
    const result = run(
      {
        tags: { session_01REVIEWAAAAAAAAAAAAAA: ['review-1000'] },
        unknown: ['session_01REVIEWAAAAAAAAAAAAAA'],
      },
      [ARCHIVE_REVIEWS],
    );

    expect(result.lines).toEqual(['KEPT session_01REVIEWAAAAAAAAAAAAAA']);
    expect(result.archived).toEqual([]);
    expect(result.status).toBe(0);
  });

  // `list_sessions` の `limit` は上限100なので、それより古いものは `has_more`／`last_id` を繰らないと
  // 届かない。1ページで済ませると**古いものほど掃かれない**——実測（2026-08-30）で全715件・8ページ、
  // 1ページ目に見えた生きたレビューは4本、繰った先に35本残っていた。
  it('1ページ目に収まらない古いレビューも畳む', () => {
    const result = run(
      {
        sessions: {
          session_01REVIEWNEW000000000: 'SESSION_STATUS_IDLE',
          session_01REVIEWOLD000000000: 'SESSION_STATUS_IDLE',
        },
        tags: { session_01REVIEWNEW000000000: ['review-1000'] },
        olderTags: { session_01REVIEWOLD000000000: ['review-1000'] },
      },
      [ARCHIVE_REVIEWS],
    );

    expect(result.lines).toEqual([
      'ARCHIVED session_01REVIEWNEW000000000',
      'ARCHIVED session_01REVIEWOLD000000000',
    ]);
    expect(result.status).toBe(0);
  });

  // 畳み済みも `list_sessions` に残る（実測で73件中59件）。渡すと `get_session` を打つだけ打って
  // 何も出さないので、ここで外す。
  it('畳み済みのレビューには `get_session` を打たない', () => {
    const result = run(
      {
        sessions: {
          session_01REVIEWDONE00000000: 'SESSION_STATUS_ARCHIVED',
          session_01REVIEWBBBBBBBBBBBBBB: 'SESSION_STATUS_IDLE',
        },
        tags: {
          session_01REVIEWDONE00000000: ['review-1000'],
          session_01REVIEWBBBBBBBBBBBBBB: ['review-1000'],
        },
      },
      [ARCHIVE_REVIEWS],
    );

    expect(result.lines).toEqual(['ARCHIVED session_01REVIEWBBBBBBBBBBBBBB']);
    expect(result.probed).toEqual(['session_01REVIEWBBBBBBBBBBBBBB']);
    expect(result.status).toBe(0);
  });
});
