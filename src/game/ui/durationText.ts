/**
 * 操作にかかるゲーム内時間の表示（分を時間・分へ直す）。時間を消費しない操作（0分）はundefinedで、
 * 呼び出し側は「かかる時間の行を出さない」を選べる——「0分かかる」と出しても意味が無いため。
 */
export function durationText(minutes: number): string | undefined {
  if (minutes <= 0) return undefined;

  const hours = Math.trunc(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `かかる時間 ${rest}分`;
  return rest === 0 ? `かかる時間 ${hours}時間` : `かかる時間 ${hours}時間${rest}分`;
}
