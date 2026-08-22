const MINUTES_PER_DAY = 24 * 60;

/**
 * 総経過分を日・時・分へ分ける。**時計に出すのも、記録へ添える文字にするのも同じ分け方**——
 * 別々に書くと、片方だけ直したときに時計とエラー報告の時刻がずれる。
 *
 * 日は0から数える（開始日が0日目）。
 */
export function clockParts(totalMinutes: number): { days: number; hour: number; minute: number } {
  const whole = Math.trunc(totalMinutes);
  return {
    days: Math.trunc(whole / MINUTES_PER_DAY),
    hour: Math.trunc((whole % MINUTES_PER_DAY) / 60),
    minute: whole % 60,
  };
}

/**
 * ゲーム内時間の長さの書き方（分を時間・分へ直す）。**止まっている文言の長さはすべてこの1つの形**——
 * 操作にかかる時間も、焼き上がるまでの残り時間も、同じ字面で読める。
 *
 * 動きながら出る長さ（時間経過の演出）だけはelapsedTextが別の形を持つ。理由はそちらに書く。
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

/**
 * 時間経過の演出に出す「開始から何分経ったか」（CardInteraction.md 7節）。
 *
 * minutesTextと形を分けているのは、これが**動きながら大きく出る数字**だから——「1時間30分」と
 * 「45分」では字数が違い、値が変わるたびに文字の幅が踊る。時分を桁で揃えた形なら踊らない。
 * 頭の`+`は、同じ画面に出ている時計の絶対時刻（11:00）と見分けるため。
 */
export function elapsedText(minutes: number): string {
  const whole = Math.max(0, Math.trunc(minutes));
  return `+${Math.trunc(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
