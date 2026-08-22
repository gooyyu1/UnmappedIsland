import slotButtonPaperUrl from '../assets/ui/slot_button_paper.png';

/**
 * スロットボタン（地図・装備・怪我・レシピ）の地に敷く紙のテクスチャキー。
 * BootSceneがボタン1つぶんずつのスプライトシートとして読む。
 *
 * **カードの枠とは別の絵を持つ。** 同じ紙から切り出してはいるが（`recipes/slot_button_paper.json`）、
 * それは生成の話で、実行時に同じテクスチャを共有はしない（DesignNotes.md）。
 */
export const SLOT_BUTTON_PAPER_TEXTURE = 'slotButtonPaper';

/** その1枚の寸法（tools/comfyui/button_paper.py の TILE_WIDTH / TILE_HEIGHT と揃える）。 */
export const SLOT_BUTTON_PAPER_FRAME = { width: 336, height: 168 };

/** テクスチャキー → 画像のURL。 */
export const SLOT_BUTTON_PAPER_ART: ReadonlyMap<string, string> = new Map([
  [SLOT_BUTTON_PAPER_TEXTURE, slotButtonPaperUrl],
]);
