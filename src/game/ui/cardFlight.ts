/**
 * カードが場所から場所へ飛ぶ時間（ミリ秒）と加速の形。並びが詰め直される滑りより少しだけ長く取る。
 *
 * **カードが飛ぶ速さは1つだけ**にする。ワールドが変わって動くぶん（CardMotion）も、運ぶ束に
 * ついてくる・元の枠へ返るぶん（CardDragController）も同じ速さ。別々に持つと、片方だけ変えたときに
 * 別の出来事に見える。
 */
export const FLY_MS = 260;
export const FLY_EASE = 'Quad.easeOut';
