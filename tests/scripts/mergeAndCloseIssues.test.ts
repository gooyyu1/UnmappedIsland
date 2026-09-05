import { describe, expect, it } from 'vitest';

import { DEFAULT_BODY, run } from '../support/mergeAndCloseWorld';

/**
 * マージの後で、`Closes #N` の issue が実際に閉じたかを確かめるところ。
 *
 * **セッションはここでは畳まない**（`board-design.md` 2.10）。畳む条件はマージとは別の問いで、
 * 盤面が毎周見て打つ。
 *
 * 世界の組み方と、ファイルを分けてある理由は `tests/support/mergeAndCloseWorld.ts`。
 */

describe('merge-and-close.sh の issue の確認', () => {
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
});
