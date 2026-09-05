import { describe, expect, it } from 'vitest';

import { DEFAULT_BODY, run } from '../support/mergeAndCloseWorld';

/**
 * マージの後で、そのPRに関わったセッション（PRを出した側とレビュー）を畳むところ。
 *
 * **ここが渡す最後の機会**——マージされたPRには、レビューの投入も次のマージも二度と来ない。
 *
 * 世界の組み方と、ファイルを分けてある理由は `tests/support/mergeAndCloseWorld.ts`。
 */

describe('merge-and-close.sh のセッションの畳み', () => {
  it('マージして、Closes の issue が閉じたことと、PRを出したセッションを畳んだことを出す', () => {
    const result = run({
      body: 'Closes #1033\n\n_[Claude Code](https://claude.ai/code/session_01AAAAAAAAAAAAAAAAAAAAAA)_',
      issues: { 1033: 'CLOSED' },
      sessions: { session_01AAAAAAAAAAAAAAAAAAAAAA: 'SESSION_STATUS_RUNNING' },
    });

    expect(result.merged).toBe(true);
    expect(result.lines).toEqual([
      'MERGED 1000',
      'CLOSED 1033',
      'ARCHIVED session_01AAAAAAAAAAAAAAAAAAAAAA',
      'SYNCED deadbee',
    ]);
    expect(result.archived).toEqual(['session_01AAAAAAAAAAAAAAAAAAAAAA']);
    expect(result.status).toBe(0);
  });

  it('閉じ損ねた issue は残りとして出し、終了コードで報せる', () => {
    const result = run({ body: `Closes #1033\n\n${DEFAULT_BODY}`, issues: { 1033: 'OPEN' } });

    expect(result.lines).toEqual(['MERGED 1000', 'OPEN 1033', 'SYNCED deadbee']);
    expect(result.status).toBe(2);
  });

  // 脚注は本文の一部なので書き手が消せるが、`task-<番号>` のタグは `dispatch-task.sh` が付ける。
  it('脚注が落ちていても、Closes の issue とタグで畳む相手を引く', () => {
    const result = run({
      body: 'Closes #1033',
      issues: { 1033: 'CLOSED' },
      tags: {
        session_01TAGGED0000000000000: ['task-1033'],
        session_01OTHER00000000000000: ['task-1034'],
      },
      sessions: { session_01TAGGED0000000000000: 'SESSION_STATUS_RUNNING' },
    });

    expect(result.lines).toEqual([
      'MERGED 1000',
      'CLOSED 1033',
      'ARCHIVED session_01TAGGED0000000000000',
      'SYNCED deadbee',
    ]);
    expect(result.archived).toEqual(['session_01TAGGED0000000000000']);
    expect(result.status).toBe(0);
  });

  // 相談役は issue を持たず、PRを何本も出す。PR1本のマージで畳むと、ユーザーが話している窓口が
  // 閉じる（2026-08-30 に PR #1240 のマージで実際に畳んでしまった）。
  it('issue を持たないセッションは、PRがマージされても畳まない', () => {
    const result = run({
      body: '_[Claude Code](https://claude.ai/code/session_01ADVISER000000000000)_',
      sessions: { session_01ADVISER000000000000: 'SESSION_STATUS_RUNNING' },
      tags: { session_01ADVISER000000000000: ['adviser-parallel-agents'] },
    });

    expect(result.lines).toEqual(['MERGED 1000', 'KEPT session_01ADVISER000000000000', 'SYNCED deadbee']);
    expect(result.archived).toEqual([]);
    expect(result.status).toBe(0);
  });

  // レビューのセッションはPRを出さないので `session-of-pr.sh` では引けず、`review-` のタグで引く。
  // PRが閉じれば読む相手が無くなるので、ここがこのPRの分を畳む最後の場所。
  it('マージしたら、そのPRのレビューのセッションも畳む', () => {
    const result = run({
      tags: {
        session_01REVIEWAAAAAAAAAAAAAA: ['review-1000'],
        session_01REVIEWBBBBBBBBBBBBBB: ['review-1000'],
        // 直す側。こちらは `task-` のタグで引く別の経路が畳む（この試験では脚注が指していない）。
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
  it('ブリッジで立てたセッションは、レビューも直す側も畳まない', () => {
    const result = run({
      body: 'Closes #1033\n\n_[Claude Code](https://claude.ai/code/session_01BRIDGETASK00000000)_',
      issues: { 1033: 'CLOSED' },
      sessions: { session_01BRIDGETASK00000000: 'SESSION_STATUS_IDLE' },
      tags: {
        session_01BRIDGETASK00000000: ['task-1033'],
        session_01BRIDGEREVIEW000000: ['review-1000'],
        session_01CLOUDREVIEW0000000: ['review-1000'],
      },
      onBridge: ['session_01BRIDGETASK00000000', 'session_01BRIDGEREVIEW000000'],
    });

    expect(result.lines).toEqual([
      'MERGED 1000',
      'CLOSED 1033',
      'KEPT session_01BRIDGETASK00000000',
      'KEPT session_01BRIDGEREVIEW000000',
      'ARCHIVED session_01CLOUDREVIEW0000000',
      'SYNCED deadbee',
    ]);
    expect(result.archived).toEqual(['session_01CLOUDREVIEW0000000']);
    expect(result.status).toBe(0);
  });

  // 本文を書き直した拍子に脚注が落ちる（PR #1083 で実際に落ちた）。黙って畳まずに済ませると、
  // 走ったままのセッションが誰にも数えられずに残る。
  it('脚注もタグも無ければ、畳む相手が分からなかったことを残りとして報せる', () => {
    const result = run({ body: 'Closes #1033', issues: { 1033: 'CLOSED' } });

    expect(result.lines).toEqual(['MERGED 1000', 'CLOSED 1033', 'NOSESSION 1000', 'SYNCED deadbee']);
    expect(result.archived).toEqual([]);
    expect(result.status).toBe(2);
  });

  // 本文が脚注の**書き方を説明している**ことがある（このPR自身がそうだった）。
  it('脚注の書き方を引用しているだけの文字列は、畳む相手にしない', () => {
    const result = run({
      body: `末尾に \`https://claude.ai/code/session_...\` が入る。\n\n${DEFAULT_BODY}`,
    });

    expect(result.archived).toEqual([]);
    expect(result.lines).toEqual(['MERGED 1000', 'SYNCED deadbee']);
    expect(result.status).toBe(0);
  });

  // マージは済んでいるので、ここで落ちると `main` の追随ごと落ちる。
  it('畳めなかったときも止まらず、後片付けを済ませてから残りとして報せる', () => {
    const result = run({
      sessions: { session_01ZZZZZZZZZZZZZZZZZZZZZZ: 'SESSION_STATUS_RUNNING' },
      archiveFails: true,
    });

    expect(result.lines).toEqual([
      'MERGED 1000',
      'UNARCHIVED session_01ZZZZZZZZZZZZZZZZZZZZZZ',
      'SYNCED deadbee',
    ]);
    expect(result.status).toBe(2);
  });

  it('畳み済みのセッションは畳み直さない', () => {
    const result = run({
      body: 'https://claude.ai/code/session_01AAAAAAAAAAAAAAAAAAAAAA',
      sessions: { session_01AAAAAAAAAAAAAAAAAAAAAA: 'SESSION_STATUS_ARCHIVED' },
    });

    expect(result.archived).toEqual([]);
    expect(result.lines).toEqual(['MERGED 1000', 'SYNCED deadbee']);
  });

  // 畳み済みには何も言わない、は `archive-session.sh` が持つ出力の規約。issue を持たない相手を
  // 選り分ける側（このスクリプト）だけがそれを知らないと、同じ相手に片方だけが口を利く。
  it('畳み済みなら、issue を持たないセッションにも何も出さない', () => {
    const result = run({
      body: 'https://claude.ai/code/session_01ADVISER000000000000',
      sessions: { session_01ADVISER000000000000: 'SESSION_STATUS_ARCHIVED' },
      tags: { session_01ADVISER000000000000: ['adviser-parallel-agents'] },
    });

    expect(result.archived).toEqual([]);
    expect(result.lines).toEqual(['MERGED 1000', 'SYNCED deadbee']);
  });

  // 走行中を守ると `KEPT` として残るだけで、誰かがもう一度渡さない限り二度と畳まれない。**マージ済みの
  // PRへは、レビューの投入も次のマージも二度と来ない**——ここが渡す最後の機会なので、走行中でも畳む。
  // 判定を書き終えても読む相手（開いているPR）が無い、というのが守らない理由。
  it('マージのときは、走っている最中のセッションも畳む', () => {
    const result = run({
      body: 'Closes #1033\n\n_[Claude Code](https://claude.ai/code/session_01TASKAAAAAAAAAAAAAAAA)_',
      issues: { 1033: 'CLOSED' },
      sessions: {
        session_01TASKAAAAAAAAAAAAAAAA: 'SESSION_STATUS_RUNNING',
        session_01REVIEWAAAAAAAAAAAAAA: 'SESSION_STATUS_RUNNING',
      },
      tags: {
        session_01TASKAAAAAAAAAAAAAAAA: ['task-1033'],
        session_01REVIEWAAAAAAAAAAAAAA: ['review-1000'],
      },
      working: ['session_01TASKAAAAAAAAAAAAAAAA', 'session_01REVIEWAAAAAAAAAAAAAA'],
    });

    expect(result.lines).toEqual([
      'MERGED 1000',
      'CLOSED 1033',
      'ARCHIVED session_01TASKAAAAAAAAAAAAAAAA',
      'ARCHIVED session_01REVIEWAAAAAAAAAAAAAA',
      'SYNCED deadbee',
    ]);
    expect(result.archived).toEqual(['session_01TASKAAAAAAAAAAAAAAAA', 'session_01REVIEWAAAAAAAAAAAAAA']);
  });
});
