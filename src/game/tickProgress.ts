/**
 * 時間経過の見せ方の規則（ScreenLayout.md 時間経過のドーナツグラフ節）。
 *
 * ゲーム内の変化が起きるのはtick境界だけなので、実時間を一定の速さで滑らかに映すのではなく、
 * 各tickの前半で次の目盛りまで進み、後半は止まる。ドーナツグラフの塗り（tickSteppedRatio）と
 * 時計の刻み（tickSteppedCount）が食い違わないよう、どちらもここから導く。
 */

/** 1tickぶんの実時間のうち、割合を進める側に使う比。残りは止めて、tick境界で一拍置く。 */
const ADVANCE_RATIO = 0.5;

/** 実時間の経過（elapsedは0〜1）を、tickごとに一拍置く割合（0〜1）へ直す。 */
export function tickSteppedRatio(elapsed: number, ticks: number): number {
  if (ticks <= 0) return 1;

  const scaled = scaledElapsed(elapsed, ticks);
  const index = currentTick(scaled, ticks);
  return (index + Math.min((scaled - index) / ADVANCE_RATIO, 1)) / ticks;
}

/**
 * 実時間の経過（elapsedは0〜1）のうち、何目盛りぶんが埋まり切ったか。各tickは前半で目盛りへ
 * 届くので、後半に入っていればその1つを数える。
 */
export function tickSteppedCount(elapsed: number, ticks: number): number {
  if (ticks <= 0) return 0;

  const scaled = scaledElapsed(elapsed, ticks);
  const index = currentTick(scaled, ticks);
  return scaled - index >= ADVANCE_RATIO ? index + 1 : index;
}

/** 経過を「何tick目のどこか」を表す0〜ticksの値へ直す。 */
function scaledElapsed(elapsed: number, ticks: number): number {
  return Math.min(Math.max(elapsed, 0), 1) * ticks;
}

/** 今いるtickの番号（最後のtickを走り切った位置は、最後のtickの中として扱う）。 */
function currentTick(scaled: number, ticks: number): number {
  return Math.min(Math.floor(scaled), ticks - 1);
}
