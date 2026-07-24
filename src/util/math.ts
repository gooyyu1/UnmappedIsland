/**
 * 偶数への丸め（round half to even）。ちょうど0.5の値を常に同方向へ丸める方式と違って偏りがなく、
 * 地形生成はこの規則での決定的な再現を前提とする。
 */
export function roundHalfToEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}
