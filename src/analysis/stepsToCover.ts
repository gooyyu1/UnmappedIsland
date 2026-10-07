/**
 * その距離を1歩あたりその量で進むのに要る歩数（端数を残したまま）。**整数のすぐ脇に落ちた商は整数へ
 * 戻す**——宣言の値は十進で書かれるが、0.1のような量は2進で割り切れず、端ちょうどへ着く組
 * （1から+0.1ずつで1.3）の商が2.9999999999999996や3.0000000000000004になる。そのまま切り上げ・
 * 切り捨てると、着いた歩が1つずれる。
 */
export function stepsToCover(distance: number, perStep: number): number {
  const steps = distance / perStep;
  const nearest = Math.round(steps);
  return Math.abs(steps - nearest) <= STEP_QUOTIENT_TOLERANCE * Math.max(1, Math.abs(nearest))
    ? nearest
    : steps;
}

/** stepsToCoverが整数とみなす、商と整数の隔たり（整数の大きさに対する比）。 */
const STEP_QUOTIENT_TOLERANCE = 1e-9;
