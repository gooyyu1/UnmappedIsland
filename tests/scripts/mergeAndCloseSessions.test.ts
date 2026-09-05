import { describe, expect, it } from 'vitest';

import { DEFAULT_BODY, run } from '../support/mergeAndCloseWorld';

/**
 * マージの後で、閉じた issue を報せ、そのPRのレビューのセッションを畳むところ。
 *
 * **PRを書いたワーカーはここでは畳まない**（`board-design.md` 2.10）。レビューは issue を持たない
 * ので盤面の鍵では引けず、`review-<PR番号>` のタグで引く——マージ済みのPRへは次の投入もマージも
 * 来ないので、ここが渡す最後の機会。
 *
 * 世界の組み方と、ファイルを分けてある理由は `tests/support/mergeAndCloseWorld.ts`。
 */

describe('merge-and-close.sh のセッションの畳み', () => {
  it('マージして、Closes の issue が閉じたことを出す', () => {
    const result = run({ body: 'Closes #1033', issues: { 1033: 'CLOSED' } });

    expect(result.merged).toBe(true);
    expect(result.lines).toEqual(['MERGED 1000', 'CLOSED 1033', 'SYNCED deadbee']);
    expect(result.status).toBe(0);
  });

  it('閉じ損ねた issue は残りとして出し、終了コードで報せる', () => {
    const result = run({ body: `Closes #1033\n\n${DEFAULT_BODY}`, issues: { 1033: 'OPEN' } });

    expect(result.lines).toEqual(['MERGED 1000', 'OPEN 1033', 'SYNCED deadbee']);
    expect(result.status).toBe(2);
  });

  // 畳む条件は担当の issue が閉じたことで、それを見るのは盤面（`board-design.md` 2.10）。ここに
  // 繋いでいた頃は、人が画面からマージすると畳む手が一度も走らなかった（PR #1524）。
  it('PRを書いたワーカーは、マージしても畳まない', () => {
    const result = run({
      body: 'Closes #1033\n\n_[Claude Code](https://claude.ai/code/session_01TASKAAAAAAAAAAAAAAAA)_',
      issues: { 1033: 'CLOSED' },
      sessions: { session_01TASKAAAAAAAAAAAAAAAA: 'SESSION_STATUS_IDLE' },
      tags: { session_01TASKAAAAAAAAAAAAAAAA: ['task-1033'] },
    });

    expect(result.lines).toEqual(['MERGED 1000', 'CLOSED 1033', 'SYNCED deadbee']);
    expect(result.archived).toEqual([]);
    expect(result.status).toBe(0);
  });

  // レビューのセッションは issue を持たないので、上の鍵では引けず `review-` のタグで引く。
  // PRが閉じれば読む相手が無くなるので、ここがこのPRの分を畳む最後の場所。
  it('マージしたら、そのPRのレビューのセッションも畳む', () => {
    const result = run({
      tags: {
        session_01REVIEWAAAAAAAAAAAAAA: ['review-1000'],
        session_01REVIEWBBBBBBBBBBBBBB: ['review-1000'],
        // 書く側。こちらを畳むのは盤面で、ここは触らない（上の「PRを書いたワーカーは…」）。
        session_01TASKAAAAAAAAAAAAAAAA: ['task-1000'],
      },
    });

    expect(result.lines).toEqual([
      'MERGED 1000',
      'ARCHIVED session_01REVIEWAAAAAAAAAAAAAA',
      'ARCHIVED session_01REVIEWBBBBBBBBBBBBBB',
      'SYNCED deadbee',
    ]);
    expect(result.archived).toEqual(['session_01REVIEWAAAAAAAAAAAAAA', 'session_01REVIEWBBBBBBBBBBBBBB']);
    expect(result.status).toBe(0);
  });

  // 掃く範囲がこのPRの分だけだと、`判断待ち`／`直し待ち` で止まったPR——次の投入もマージも来ない
  // PR——のレビューが永久に残る（2026-08-30 に16本溜まった）。**畳める理由はPRごとに違わない**ので、
  // マージのついでに全部を渡す。開いているPRのぶんは走行中なら守る。
  it('マージのついでに、別のPRのレビューも畳む', () => {
    const result = run({
      // 1001 は開いたまま止まっているPR。1002 は投入もマージも通らずに閉じたPR。
      openPrs: [1000, 1001],
      sessions: {
        session_01REVIEWAAAAAAAAAAAAAA: 'SESSION_STATUS_IDLE',
        session_01REVIEWWORKING00000: 'SESSION_STATUS_RUNNING',
        session_01REVIEWIDLE00000000: 'SESSION_STATUS_IDLE',
      },
      tags: {
        session_01REVIEWAAAAAAAAAAAAAA: ['review-1000'],
        session_01REVIEWWORKING00000: ['review-1001'],
        session_01REVIEWIDLE00000000: ['review-1002'],
      },
      working: ['session_01REVIEWWORKING00000'],
    });

    expect(result.lines).toEqual([
      'MERGED 1000',
      'KEPT session_01REVIEWWORKING00000',
      'ARCHIVED session_01REVIEWAAAAAAAAAAAAAA',
      'ARCHIVED session_01REVIEWIDLE00000000',
      'SYNCED deadbee',
    ]);
    expect(result.status).toBe(0);
  });

  // `claude remote-control` が落ちている間にブリッジのセッションを畳むと、worktree がロックされた
  // まま残る。タグはクラウドと同じなので、環境IDでしか区別が付かない。
  it('ブリッジで立てたレビューのセッションは畳まない', () => {
    const result = run({
      tags: {
        session_01BRIDGEREVIEW000000: ['review-1000'],
        session_01CLOUDREVIEW0000000: ['review-1000'],
      },
      onBridge: ['session_01BRIDGEREVIEW000000'],
    });

    expect(result.lines).toEqual([
      'MERGED 1000',
      'KEPT session_01BRIDGEREVIEW000000',
      'ARCHIVED session_01CLOUDREVIEW0000000',
      'SYNCED deadbee',
    ]);
    expect(result.archived).toEqual(['session_01CLOUDREVIEW0000000']);
    expect(result.status).toBe(0);
  });

  // マージは済んでいるので、ここで落ちると `main` の追随ごと落ちる。
  it('畳めなかったときも止まらず、後片付けを済ませてから残りとして報せる', () => {
    const result = run({
      tags: { session_01REVIEWAAAAAAAAAAAAAA: ['review-1000'] },
      archiveFails: true,
    });

    expect(result.lines).toEqual([
      'MERGED 1000',
      'UNARCHIVED session_01REVIEWAAAAAAAAAAAAAA',
      'SYNCED deadbee',
    ]);
    expect(result.status).toBe(2);
  });

  // 走行中を守ると `KEPT` として残るだけで、誰かがもう一度渡さない限り二度と畳まれない。**マージ済みの
  // PRへは、レビューの投入も次のマージも二度と来ない**——ここが渡す最後の機会なので、走行中でも畳む。
  // 判定を書き終えても読む相手（開いているPR）が無い、というのが守らない理由。
  it('マージのときは、走っている最中のレビューも畳む', () => {
    const result = run({
      sessions: { session_01REVIEWAAAAAAAAAAAAAA: 'SESSION_STATUS_RUNNING' },
      tags: { session_01REVIEWAAAAAAAAAAAAAA: ['review-1000'] },
      working: ['session_01REVIEWAAAAAAAAAAAAAA'],
    });

    expect(result.lines).toEqual([
      'MERGED 1000',
      'ARCHIVED session_01REVIEWAAAAAAAAAAAAAA',
      'SYNCED deadbee',
    ]);
    expect(result.archived).toEqual(['session_01REVIEWAAAAAAAAAAAAAA']);
  });
});
