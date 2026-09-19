import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { NIGHT_CRAFT_MINUTES_PER_DAY } from '../../src/analysis/dailyPhases';

/**
 * 夜の枠が拠点の加工を収めきることの検査（`ContentSkeleton.md` 8.3節）。
 *
 * 8.3節は「**夜が足りなくなることはなく、足りないのは昼です**」と言い切っているが、**1日の割り付けは
 * 嵐を引いていない**（同 8.2節の割り切り）。嵐の夜は屋根の下でなければ焚き火のそばの加工も止まる
 * （同 8.1.4節）ので、**引いたうえでも収まること**をここが見張る。置かないと、割り切りの断りだけが
 * 残って、言い切りが崩れる境目は誰も知らないままになる。
 *
 * 引く割合は、1周回の時計のうち嵐だった割合そのもの（`stats/climate.yaml` の実測）。**嵐が夜だけを
 * 選んで来るわけではない**ので、夜も同じ割合で食われると置く。
 *
 * **レポートを読むだけで、解析は通さない**——見たいのは出来上がった1周回の勘定で、そこへ至る数え方は
 * `tests/analysis/` と各レポートの鮮度検査が持つ。
 */

/** レポート1本の節。 */
function statsReport(fileName: string): Record<string, readonly Record<string, unknown>[]> {
  return parse(readFileSync(join('stats', fileName), 'utf8')) as Record<
    string,
    readonly Record<string, unknown>[]
  >;
}

/** その節の、セレクタを満たす唯一のレコードの数値。1件に定まらなければ落とす。 */
function cell(
  report: Record<string, readonly Record<string, unknown>[]>,
  section: string,
  selector: Record<string, unknown>,
  column: string,
): number {
  const matched = (report[section] ?? []).filter((record) =>
    Object.entries(selector).every(([key, value]) => record[key] === value),
  );
  expect(matched, `${section} の ${JSON.stringify(selector)} が1件に定まらない`).toHaveLength(1);
  return Number(matched[0][column]);
}

describe('夜の枠（ContentSkeleton.md 8.3節）', () => {
  it('嵐の夜を引いても、拠点の加工を収めきる', () => {
    const terrain = statsReport('terrain.yaml');
    const climate = statsReport('climate.yaml');

    const cycleDays = cell(terrain, 'cycle', { base: 'shortest_mean', metric: 'total_days' }, 'mean');
    const baseMinutes = cell(terrain, 'work_piles_total', {}, 'base_minutes');
    expect(cycleDays, '1周回の日数が読めない').toBeGreaterThan(0);
    expect(baseMinutes, '拠点の加工の総量が読めない').toBeGreaterThan(0);

    // 季節は同じ長さで巡るので、1周回のうち嵐だった割合は季節をまたいだ時間の比で出る。
    const seasons = climate.season_duration.map((record) => record.season);
    expect(seasons.length, '季節が1つも読めない').toBeGreaterThan(0);
    const sumOver = (read: (season: unknown) => number): number =>
      seasons.reduce<number>((sum, season) => sum + read(season), 0);
    const clockHours = sumOver((season) => cell(climate, 'season_duration', { season }, 'mean') * 24);
    const stormHours = sumOver((season) =>
      cell(climate, 'weather_hours', { season, weather: 'storm', segment: 'overall' }, 'mean'),
    );
    const stormShare = stormHours / clockHours;

    // 嵐を1時間も測っていない実測は、引く分が0になってこの見張りを素通りさせる。
    expect(stormShare, '1周回に嵐が1時間も無い').toBeGreaterThan(0);

    expect(
      NIGHT_CRAFT_MINUTES_PER_DAY * cycleDays * (1 - stormShare),
      `嵐の夜（${(stormShare * 100).toFixed(1)}%）を引いた夜の枠が、拠点の加工に足りない`,
    ).toBeGreaterThan(baseMinutes);
  });
});
