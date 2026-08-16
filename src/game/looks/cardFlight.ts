/**
 * カードが場所から場所へ飛ぶ時間（ミリ秒）と加速の形。並びが詰め直される滑りより少しだけ長く取る。
 *
 * **カードが飛ぶ速さは1つだけ**にする。ワールドが変わって動くぶん（CardTable）も、運ぶ束に
 * ついてくる・元の枠へ返るぶん（CardDragController）も同じ速さ。別々に持つと、片方だけ変えたときに
 * 別の出来事に見える。
 */
export const FLY_MS = 260;
export const FLY_EASE = 'Quad.easeOut';

/** FLY_EASEと同じ形の関数（自前で進める便はtweenを使わないため）。 */
export function FLY_EASE_OUT(t: number): number {
  return 1 - (1 - t) * (1 - t);
}
