/**
 * カードが場所から場所へ飛ぶ時間（ミリ秒）と加速の形。並びが詰め直される滑りより少しだけ長く取る。
 *
 * **カードが飛ぶ速さは1つだけ**にする。ワールドが変わって動くぶん（CardTable）も、運ぶ束に
 * ついてくる・元の枠へ返るぶん（CardDragController）も同じ速さ。別々に持つと、片方だけ変えたときに
 * 別の出来事に見える。
 */
const FLY_MS = 260;

/** 加速の形（自前で進める便はtweenを使わないので、イージング名ではなく関数で持つ）。 */
function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/**
 * 便の進み具合（0が出発点、1が行き先）。飛び立ちまでの待ちを含めた経過から引く。
 *
 * **飛びの速さを決めるのはここだけ。** 呼ぶ側は経過を渡して位置を引くだけで、何ミリ秒で着くのかも
 * 加速の形も知らない。1に達した時点が着地で、フレームの間隔がいくら粗くても、飛び立ちから着地までの
 * 経過は変わらない。
 *
 * @param elapsed 便が立ってからの経過（ミリ秒）。
 * @param delay 飛び立つまで出発点で待つ時間（ミリ秒）。複数生まれたぶんは出どころに積まれ、順に飛び立つ。
 */
export function flightProgress(elapsed: number, delay: number): number {
  return easeOut(Math.min(1, Math.max(0, elapsed - delay) / FLY_MS));
}
