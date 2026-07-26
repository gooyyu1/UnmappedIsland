/** 1tickぶんの実時間のうち、割合を進める側に使う比。残りは止めて、tick境界で一拍置く。 */
const ADVANCE_RATIO = 0.5;

/**
 * 時間経過の実時間での進み具合（elapsedは0〜1）を、tickごとに一拍置く割合へ直す。
 *
 * 各tickの前半で次の目盛りまで進み、後半は止まる。ゲーム内の変化が起きるのはtick境界だけなので、
 * 一定の速さで滑らかに増やすより、区切りが分かるこの動きの方が実際の進み方に合う。
 */
export function tickSteppedRatio(elapsed: number, ticks: number): number {
  if (ticks <= 0) return 1;

  const scaled = Math.min(Math.max(elapsed, 0), 1) * ticks;
  const index = Math.min(Math.floor(scaled), ticks - 1);
  return (index + Math.min((scaled - index) / ADVANCE_RATIO, 1)) / ticks;
}
