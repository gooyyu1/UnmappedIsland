import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { activityHoursOf, characterStageMinimumOf } from '../../src/analysis/activityHours';
import { SEASON_CLIMATE } from '../../src/analysis/seasonalRain';
import { bundledCodex } from '../support/worldCodexFiles';

/**
 * 活動時間表（`src/analysis/activityHours.ts`）が置いている前提の検査。
 *
 * どちらもPR #776 が `## 仮決め` で申告したまま、崩れても気づけない形で残っていたもの（issue #777）。
 * **正しく追随させられない前提は、崩れた時点で赤くする**——静かに間違った表を出し続けるより、
 * 数え方を見直せと言われるほうがよい。
 *
 * **しきい値の出どころはキャラクタの段の宣言**（`IlluminationSystem.md` 8節）で、解析はそこから直接読む。
 * 写しとして残っているのは文書の表だけなので、突き合わせるのもそれだけ。
 */

/**
 * `IlluminationSystem.md` 5節の表の1行。行動のクラスごとに、見る明るさと、その行動ができる最も暗い段。
 *
 * **境目の数字はここに書かない**——持ってよいのは段の宣言だけ（同 8節）。
 */
const ACTION_CLASSES = [
  { documentedClass: '土地の間を移動する', propertyName: 'looking_brightness', stageName: 'dim' },
  { documentedClass: '屋外で採る・探索する', propertyName: 'looking_brightness', stageName: 'bright' },
  { documentedClass: '手元の細かい作業', propertyName: 'hand_brightness', stageName: 'bright' },
] as const;

describe('活動時間表の前提', () => {
  const codex = bundledCodex();

  it('IlluminationSystem.md 5節の表が、キャラクタの段の境目と一致する', () => {
    const documented = documentedThresholds();

    for (const action of ACTION_CLASSES)
      expect(documented.get(action.documentedClass), `${action.documentedClass}のしきい値`).toBe(
        characterStageMinimumOf(codex, action.propertyName, action.stageName),
      );
  });

  it('浅い洞窟の明るさが、生え先の土地から1つに決まる', () => {
    // 岩陰の暗さ（-6）は土地との差なので、生え先の土地の明るさが揃っていないと1行では出せない。
    // 揃っていなければ activityHoursOf が例外を投げる。
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
function documentedThresholds(): ReadonlyMap<string, number> {
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
