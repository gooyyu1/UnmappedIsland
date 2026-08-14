/**
 * ゲーム内時間の長さの書き方（分を時間・分へ直す）。**画面に出る長さはすべてこの1つの形**——
 * 操作にかかる時間も、焼き上がるまでの残り時間も、同じ字面で読める。
 */
export function minutesText(minutes: number): string {
  const hours = Math.trunc(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}分`;
  return rest === 0 ? `${hours}時間` : `${hours}時間${rest}分`;
}

/**
 * 操作にかかるゲーム内時間の表示。時間を消費しない操作（0分）はundefinedで、呼び出し側は
 * 「かかる時間の行を出さない」を選べる——「0分かかる」と出しても意味が無いため。
 */
export function durationText(minutes: number): string | undefined {
  if (minutes <= 0) return undefined;
  return `かかる時間 ${minutesText(minutes)}`;
}
