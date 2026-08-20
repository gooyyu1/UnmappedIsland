/**
 * 枠の中の位置の指し方（SlotSystem.md 3節）。プレイヤーが指で示した落とし先が、そのままこの形になる。
 *
 * - `gap`: 枠と枠の隙間。indexは0が先頭の枠の前、枠数が末尾の枠の後ろ。
 * - `cell`: 枠そのもの。indexはその枠の位置。
 *
 * **指し方はこれ1つだけで、どちらを使えるかを指す側は知らなくてよい。** 枠を指せるのは枠数を決めた
 * スロットだけだが、前詰めスロットの空き枠は末尾の受け皿しか無いので、そこでの`cell`はその位置の隙間と
 * 同じことを意味する。**この読み替えはSlot自身が行う**（Slot.insertAt / moveStackTo）。
 */
export type SlotPosition =
  { readonly kind: 'gap'; readonly index: number } | { readonly kind: 'cell'; readonly index: number };
