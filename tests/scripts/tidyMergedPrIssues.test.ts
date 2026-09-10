import { describe, expect, it } from 'vitest';

import { DEFAULT_BODY, run } from '../support/tidyMergedPrWorld';

/**
 * 後片付けのうち、`Closes #N` の issue が実際に閉じたかを確かめるところ。
 *
 * **閉じるのは GitHub** だが、閉じ損ねを見ているのはここだけ。**セッションはここでは畳まない**
 * （`board-design.md` 2.10）——畳む条件はマージとは別の問いで、盤面が毎周見て打つ。
 *
 * 世界の組み方と、ファイルを分けてある理由は `tests/support/tidyMergedPrWorld.ts`。
 */

describe('tidy-merged-pr.sh の issue の確認', () => {
  it('Closes の issue が閉じたことを出す', () => {
    const result = run({ body: 'Closes #1033', issues: { 1033: 'CLOSED' } });

    expect(result.lines).toEqual(['CLOSED 1033', 'SYNCED deadbee']);
    expect(result.status).toBe(0);
  });

  it('閉じ損ねた issue は残りとして出し、終了コードで報せる', () => {
    const result = run({ body: `Closes #1033\n\n${DEFAULT_BODY}`, issues: { 1033: 'OPEN' } });

    expect(result.lines).toEqual(['OPEN 1033', 'SYNCED deadbee']);
    expect(result.status).toBe(2);
  });
});
