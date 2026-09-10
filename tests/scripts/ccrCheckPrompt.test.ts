import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkPrompt } from '../../.claude/ccr-check-prompt.mjs';

/**
 * `.claude/ccr-check-prompt.mjs` が、届いた指示を判定する条件の検査。
 *
 * ここが守るのは**「まだ載っていない」を「欠けている」と読まないこと**。`create_session` の直後は
 * 種の指示が記録に出るまで数十秒かかり、載りかけの本文は**長さの違う別物として読める**
 * （あちらの冒頭）。即断すると、欠けていない指示を欠けたと報せてセッションを畳み直すことになる。
 *
 * 通信は差し替える——見たいのは判定の条件で、HTTPの往復ではない。
 */

/** `list_events` が返す1ページ。**本物と同じ `<other-session>` の包み**に入れて返す。 */
function page(events: readonly unknown[], more?: { first_id: string }): string {
  return [
    '<other-session>',
    JSON.stringify({ ccr: { data: events, has_more: more !== undefined, ...more } }),
    '</other-session>',
  ].join('\n');
}

/** 種の指示のイベント。**`inbound_origin` が `mcp_create_session` のものだけ**が対象。 */
const seed = (content: string) => ({
  user: { internal_anthropic_catchall: { inbound_origin: 'mcp_create_session', message: { content } } },
});

/** セッションの手番など、種の指示ではない user イベント。 */
const other = {
  user: {
    internal_anthropic_catchall: { inbound_origin: 'mcp_send_message', message: { content: '直して' } },
  },
};

const SENT = '送った指示\n`ident` を読む';

describe('.claude/ccr-check-prompt.mjs', () => {
  let work: string;
  let sentPath: string;

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'unmapped-island-check-prompt-'));
    sentPath = join(work, 'prompt.md');
    writeFileSync(sentPath, `${SENT}\n`, 'utf-8');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(work, { recursive: true, force: true });
  });

  it('届いた本文が同じなら、一致', async () => {
    const call = vi.fn().mockResolvedValue(page([other, seed(SENT)]));

    expect(await checkPrompt('cse_1', sentPath, { call, wait: 0 })).toBe(true);
    expect(console.log).toHaveBeenCalledWith('一致');
  });

  // `list_events` が返すのは新しい側から。種の指示は最も古い1件なので、最初のページには居ない。
  it('最初のページに居なければ、`before_id` で遡る', async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(page([other], { first_id: 'ev_2' }))
      .mockResolvedValueOnce(page([seed(SENT)]));

    expect(await checkPrompt('cse_1', sentPath, { call, wait: 0 })).toBe(true);
    expect(call).toHaveBeenNthCalledWith(2, 'list_events', {
      session_id: 'cse_1',
      limit: 100,
      before_id: 'ev_2',
    });
  });

  // **載るまで待ってから判定する。** 遡り切って見つからない周を不一致として報せると、欠けていない
  // 指示を欠けたと読む。
  it('まだ載っていない周は判定を出さず、載ってから一致と言う', async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page([seed(SENT)]));

    expect(await checkPrompt('cse_1', sentPath, { call, wait: 60, pause: async () => {} })).toBe(true);
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('不一致'));
  });

  // **載りかけの本文は、長さの違う別物として読める。** 1周目の食い違いで打ち切ると、数分後には
  // 一致するはずの指示を不一致にする。
  it('長さが違っても即断せず、待ち直して一致と言う', async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(page([seed(SENT.slice(0, 4))]))
      .mockResolvedValueOnce(page([seed(SENT)]));

    expect(await checkPrompt('cse_1', sentPath, { call, wait: 60, pause: async () => {} })).toBe(true);
  });

  it('待ち切っても食い違ったままなら、不一致', async () => {
    const call = vi.fn().mockResolvedValue(page([seed('別の指示')]));

    expect(await checkPrompt('cse_1', sentPath, { call, wait: 0 })).toBe(false);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('不一致'));
  });

  // 一度も載らないまま待ち切ったことは、**不一致とは別の言い方で残す**——直す先が違う（送った本文
  // ではなく、`create_session` で立てたセッションかを疑う）。
  it('待ち切っても載らなければ、不一致とは言わない', async () => {
    const call = vi.fn().mockResolvedValue(page([]));

    expect(await checkPrompt('cse_1', sentPath, { call, wait: 0 })).toBe(false);
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('不一致'));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('記録に出ない'));
  });

  // 応答が読めないのは判定ではない。**呼び手が「不一致」として数えないように**投げる。
  it('応答からJSONを取り出せなければ、投げる', async () => {
    const call = vi.fn().mockResolvedValue('Unauthorized');

    await expect(checkPrompt('cse_1', sentPath, { call, wait: 0 })).rejects.toThrow('JSON');
  });
});
