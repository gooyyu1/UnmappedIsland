import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SeasonName } from '../../src/analysis/seasonalRain';
import { SEASON_CLIMATE } from '../../src/analysis/seasonalRain';
import type { SunlitEvaporationRow } from '../../src/analysis/sunlitEvaporation';
import { sunlitEvaporationRows } from '../../src/analysis/sunlitEvaporation';
import { bundledCodex } from '../support/worldCodexFiles';

/**
 * 同梱の定義に対する、「天候と太陽高度を明るさ1本へ畳んだままでよい」の根拠の検査
 * （[`LiquidContainerSystem.md`](../../docs/engine/LiquidContainerSystem.md) 6.1節）。
 *
 * 畳みが蒸発を誤らせるのは、**同じ上乗せを乾いた空と曇った空が分け合っているとき**だけ。ここが赤く
 * なったら、6.1節が「畳んだままでよい」と言っている根拠が消えている——天候の透過率か、しきい値か、
 * 土地の明るさのどれかが動いて、曇った空が上乗せへ届くようになった。
 */
describe('日射で進む蒸発が効いている空（同梱の定義）', () => {
  const rows = sunlitEvaporationRows(bundledCodex());

  it('日射の上乗せを受ける土地が在る', () => {
    // 空振り防止。宣言の綴りが変わって上乗せを1つも拾えなくなると、下の検査は「どこにも曇りが
    // 届いていない」で緑のまま通る。
    expect(
      rows.filter((row) => row.sunlitHoursPerDay > 0),
      '日射の上乗せが1つも数えられていない',
    ).not.toHaveLength(0);
  });

  it('曇った空が日射の上乗せを受けるのは、照り返しの明るい砂浜だけ', () => {
    const reached = [
      ...new Set(rows.filter((row) => row.overcastHoursPerDay > 0).map((row) => row.locationName)),
    ];

    expect(reached, 'LiquidContainerSystem.md 6.1節の「畳んだままでよい」の根拠が動いた').toEqual([
      'sandy_beach',
    ]);
  });

  it('砂浜より明るい場所が、島の外にも無い', () => {
    // 上の「砂浜だけ」が数えたのは島の土地と浅い洞窟で、海区・筏はそこに入らない。**砂浜がこの世界で
    // いちばん明るい場所であること**を別に留めておけば、数えていない場所でも曇りが上乗せへ届かないと
    // 言える——届くには砂浜と同じかそれ以上の明るさが要るため。
    const ambientId = bundledCodex().vocabulary.world.ambientBrightnessId;
    const byName = new Map<string, number>();
    for (const def of bundledCodex().objects) {
      const value = def.tryGetPropertyDef(ambientId)?.initialValueWithoutRoll;
      if (value !== undefined) byName.set(def.name, value);
    }

    expect(byName.size, '明るさを宣言している場所が1つも見つからない').toBeGreaterThan(0);
    const brightest = Math.max(...byName.values());
    expect(
      [...byName].filter(([, value]) => value === brightest).map(([name]) => name),
      'LiquidContainerSystem.md 6.1節の「砂浜だけ」が、数えていない場所で破れた',
    ).toEqual(['sandy_beach']);
  });

  it('砂浜でも、曇った空が受けるのは日射で乾く時間のごく一部', () => {
    for (const row of rows.filter((row) => row.locationName === 'sandy_beach')) {
      const share = row.overcastHoursPerDay / row.sunlitHoursPerDay;
      expect(share, `${row.seasonName} の、上乗せが効く時間に占める曇り`).toBeLessThan(0.2);
    }
  });

  it('砂浜の時間が、LiquidContainerSystem.mdの表と一致する', () => {
    const written = sandyBeachHoursOf();
    for (const season of SEASON_CLIMATE) {
      const row = rowOf(rows, 'sandy_beach', season.name);
      const [sunlit, overcast] = written.get(season.name)!;
      expect(row.sunlitHoursPerDay, `${season.name} の上乗せが効く時間`).toBeCloseTo(sunlit, 1);
      expect(row.overcastHoursPerDay, `${season.name} のうち曇っていた時間`).toBeCloseTo(overcast, 1);
    }
  });
});

function rowOf(
  rows: readonly SunlitEvaporationRow[],
  locationName: string,
  seasonName: SeasonName,
): SunlitEvaporationRow {
  const row = rows.find(
    (candidate) => candidate.locationName === locationName && candidate.seasonName === seasonName,
  );
  expect(row, `${locationName} / ${seasonName} の行`).toBeDefined();
  return row!;
}

/**
 * `docs/engine/LiquidContainerSystem.md` 6.1節の砂浜の表から、季節ごとに
 * 「上乗せが効く時間」と「うち曇っていた時間」を読む。
 */
function sandyBeachHoursOf(): ReadonlyMap<SeasonName, readonly [number, number]> {
  const lines = readFileSync(join('docs', 'engine', 'LiquidContainerSystem.md'), 'utf8').split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith('## 6.1'));
  expect(start, '6.1節が見つからない').toBeGreaterThanOrEqual(0);
  const section = lines.slice(
    start,
    lines.findIndex((line, index) => index > start && line.startsWith('## ')),
  );

  const hours = new Map<SeasonName, readonly [number, number]>();
  for (const season of SEASON_CLIMATE) {
    const row = section.find((line) => line.startsWith(`| \`${season.name}\` |`));
    expect(row, `砂浜の表に行 '${season.name}' が見つからない`).toBeDefined();
    const cells = row!
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    hours.set(season.name, [Number.parseFloat(cells[1]), Number.parseFloat(cells[2])]);
  }
  return hours;
}
