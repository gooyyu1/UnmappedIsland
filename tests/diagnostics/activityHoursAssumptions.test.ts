import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACTIVE_THRESHOLD, activityHoursOf, TRAVEL_THRESHOLD } from '../../src/analysis/activityHours';
import { SEASON_CLIMATE } from '../../src/analysis/seasonalRain';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 活動時間表（`src/analysis/activityHours.ts`）が置いている前提の検査。
 *
 * どちらもPR #776 が `## 仮決め` で申告したまま、崩れても気づけない形で残っていたもの（issue #777）。
 * **正しく追随させられない前提は、崩れた時点で赤くする**——静かに間違った表を出し続けるより、
 * 数え方を見直せと言われるほうがよい。
 */
describe('活動時間表の前提', () => {
  it('しきい値が、IlluminationSystem.md 5節の表と一致する', () => {
    // 条件を宣言している側（`path.travel`・`crafting_conditions`）は今の静的解析APIの対象外なので、
    // 定義からは読めない。書き写した先を、書いてある側と突き合わせる。
    const thresholds = illuminationThresholds();

    expect(thresholds.get('土地の間を移動する'), '移動のしきい値').toBe(TRAVEL_THRESHOLD);
    expect(thresholds.get('屋外で採る・探索する'), '屋外の採取のしきい値').toBe(ACTIVE_THRESHOLD);
    expect(thresholds.get('手元の細かい作業'), '手元の作業のしきい値').toBe(ACTIVE_THRESHOLD);
  });

  it('浅い洞窟の明るさが、生え先の土地から1つに決まる', () => {
    // 岩陰の暗さ（-6）は土地との差なので、生え先の土地の明るさが揃っていないと1行では出せない。
    // 揃っていなければ activityHoursOf が例外を投げる。
    const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
    const rows = activityHoursOf(
      codex,
      SEASON_CLIMATE.map((season) => ({
        seasonName: season.name,
        durationDays: season.durationDays,
        hoursByWeather: new Map(Object.entries(season.hoursByWeather)),
      })),
    );

    expect(rows.filter((row) => row.locationName === 'shallow_cave').length, '浅い洞窟の行が消えている').toBe(
      SEASON_CLIMATE.length,
    );
  });
});

/**
 * `docs/engine/IlluminationSystem.md` 5節の表から、行動のクラス → しきい値。
 * 符号は文書の見た目（`−5`・`+5`）のままなので、数として読むときに直す。
 */
function illuminationThresholds(): ReadonlyMap<string, number> {
  const lines = readFileSync(join('docs', 'engine', 'IlluminationSystem.md'), 'utf8').split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith('| 行動のクラス |'));
  expect(start, 'しきい値の表が見つからない').toBeGreaterThanOrEqual(0);

  const thresholds = new Map<string, number>();
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    thresholds.set(cells[0], Number.parseFloat(cells[2].replace('−', '-').replace('+', '')));
  }

  expect(thresholds.size, 'しきい値の表が空').toBeGreaterThan(0);
  return thresholds;
}
