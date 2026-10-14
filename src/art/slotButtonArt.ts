import slotButtonPaperUrl from '../assets/ui/slot_button_paper.png';

/**
 * スロットボタン（地図・装備・怪我・レシピ）の地に敷く紙のテクスチャキー。
 * BootSceneがボタン1つぶんずつのスプライトシートとして読む。
 *
 * **カードの枠とは別の絵を持つ。** 同じ紙から切り出してはいるが（`recipes/slot_button_paper.json`）、
 * それは生成の話で、実行時に同じテクスチャを共有はしない（DesignNotes.md）。
 */
export const SLOT_BUTTON_PAPER_TEXTURE = 'slotButtonPaper';

/**
 * その1枚の寸法。**ボタン（theme.ts の `SIZE.slotButton`）の2倍**で、縦横比が違うと敷くときに紙の粒が
 * 伸びる。切り出す寸法はレシピ（`recipes/slot_button_paper.json`）が持ち、揃っているかは
 * `tests/art/slotButtonPaper.test.ts` が検める。
 */
export const SLOT_BUTTON_PAPER_FRAME = { width: 336, height: 144 };

/** テクスチャキー → 画像のURL。 */
export const SLOT_BUTTON_PAPER_ART: ReadonlyMap<string, string> = new Map([
  [SLOT_BUTTON_PAPER_TEXTURE, slotButtonPaperUrl],
]);
