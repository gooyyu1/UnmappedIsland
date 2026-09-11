/**
 * 時刻から、日本時間の日（`YYYY-MM-DD`）を出す。
 *
 * **日境を決める場所は、この道具立て全体で1つに寄せる。** `--date=format-local` にも
 * `TZ=Asia/Tokyo` にも頼らない——あれは実行環境が時間帯の名前を解釈できるかに乗っており、
 * 解釈できない環境では黙って別の日境で切る。**ずれても出力は正常な形で出る**ので、貼った先で
 * 気づけない（2026-09-07、`historyStats.mjs` の出力が行数だけ日本時間・PRだけ別の日境になっていた）。
 *
 * @param {Date} date 時刻
 * @returns {string} 日本時間の日（`YYYY-MM-DD`）
 */
export function japanDayOf(date) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** `git` へ渡す日本時間のオフセット。日境を {@link japanDayOf} と揃えるため、書式もここが持つ。 */
export const JAPAN_OFFSET = '+0900';
