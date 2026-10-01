import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SeasonName } from '../../src/analysis/seasonalRain';
import { SEASON_CLIMATE } from '../../src/analysis/seasonalRain';
import type { SunlitEvaporationRow } from '../../src/analysis/sunlitEvaporation';
import { sunlitEvaporationRows } from '../../src/analysis/sunlitEvaporation';
import { litPlacesOf, worldAmbientBrightnessOf } from '../../src/analysis/activityHours';
import { HOURS_PER_DAY } from '../../src/domain/worldTime';
import { symbolGlobalIdOfPropertyValue } from '../../src/domain/GlobalId';
import type { PropertyComparison } from '../../src/analysis/tickDeltas';
import { tickDeltasOf } from '../../src/analysis/tickDeltas';
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

describe('日射の上乗せが効く時刻（同梱の定義、LiquidContainerSystem.md 6節）', () => {
  const codex = bundledCodex();
  const worldAmbientAt = worldAmbientBrightnessOf(codex);
  const places = new Map(litPlacesOf(codex).map((place) => [place.name, place]));
  const table = brightnessTimeTableOf();
  const weathers = Object.keys(SEASON_CLIMATE[0].hoursByWeather);

  // しきい値と雨の天候は、器の蒸発（`fill` を減らす増減）の条件から読む——文書から読むと、定義が
  // 動いても表と検査が揃って古いまま緑で通る。
  const evaporationConditions: readonly PropertyComparison[] = [...codex.objects].flatMap((def) =>
    tickDeltasOf(def)
      .filter(
        (delta) =>
          delta.target === 'self' &&
          delta.propertyGlobalId === codex.vocabulary.engine.fillId &&
          delta.amount < 0 &&
          delta.gate.stage === undefined,
      )
      .flatMap((delta) => delta.gate.ancestorConditions),
  );
  const thresholds = [
    ...new Set(
      evaporationConditions
        .filter(
          ({ propertyGlobalId, op }) =>
            propertyGlobalId === codex.vocabulary.world.ambientBrightnessId && op === 'gte',
        )
        .map(({ values }) => values[0]),
    ),
  ].sort((left, right) => left - right);
  const lowest = Math.min(...thresholds);
  /** 基礎の蒸発が除外している天候（湿った空気の代理、6節）。 */
  const RAIN = [
    ...new Set(
      evaporationConditions
        .filter(
          ({ propertyGlobalId, op }) =>
            propertyGlobalId === codex.vocabulary.world.weatherId && op === 'not_in',
        )
        .flatMap(({ values }) =>
          values.map((value) => codex.symbolNames.getName(symbolGlobalIdOfPropertyValue(value))),
        ),
    ),
  ];
  const NOON = 12;

  /** 開けた土地で、明るさがしきい値以上になる時刻の帯（表の書き方: `7-16時`、届かなければ `—`）。 */
  function windowOf(weatherName: string, threshold: number): string {
    const hours = [...Array(HOURS_PER_DAY).keys()].filter(
      (hour) => worldAmbientAt(hour, weatherName) >= threshold,
    );
    return hours.length === 0 ? '—' : `${hours[0]}-${hours[hours.length - 1]}時`;
  }

  /** その場所の、どの天候・どの時刻よりも明るい値。 */
  function brightestAt(placeName: string, weatherNames: readonly string[]): number {
    const place = places.get(placeName);
    expect(place, `場所 '${placeName}' の明るさが解けない`).toBeDefined();
    return Math.max(
      ...weatherNames.flatMap((weatherName) =>
        [...Array(HOURS_PER_DAY).keys()].map((hour) =>
          place!.brightnessAt(worldAmbientAt(hour, weatherName)),
        ),
      ),
    );
  }

  it('時刻表の見出しのしきい値が、蒸発の定義のしきい値と一致する', () => {
    expect(thresholds.length, '明るさで決まる蒸発が1つも読めない').toBeGreaterThan(0);
    expect(table.thresholds).toEqual(thresholds);
  });

  it('雨の天候を、基礎の蒸発の条件から読めている', () => {
    expect(RAIN.length).toBeGreaterThan(0);
    for (const weatherName of RAIN) expect(weathers, weatherName).toContain(weatherName);
  });

  it('時刻表の天候ごとの行が、正午の明るさと効く時刻の帯を定義から数え直した値と一致する', () => {
    expect(table.rows.length, '時刻表に天候の行が無い').toBeGreaterThan(0);
    for (const { weatherName, noon, windows } of table.rows) {
      expect(`+${worldAmbientAt(NOON, weatherName)}`, `${weatherName} の正午の明るさ`).toBe(noon);
      table.thresholds.forEach((threshold, column) =>
        expect(windowOf(weatherName, threshold), `${weatherName} の ≧+${threshold}`).toBe(windows[column]),
      );
    }
  });

  it('雨系の行が、どの雨の正午の明るさと効く時刻の帯とも一致する', () => {
    for (const weatherName of RAIN) {
      expect(worldAmbientAt(NOON, weatherName), `${weatherName} の正午`).toBeLessThanOrEqual(
        table.rainNoonAtMost,
      );
      table.thresholds.forEach((threshold, column) =>
        expect(windowOf(weatherName, threshold), `${weatherName} の ≧+${threshold}`).toBe(
          table.rainWindows[column],
        ),
      );
    }
  });

  it('上乗せ側は天候を見なくてよい——雨の空は、どの場所でも最も低いしきい値に届かない', () => {
    for (const placeName of places.keys())
      expect(brightestAt(placeName, RAIN), placeName).toBeLessThan(lowest);
  });

  it('森・密林・浅い洞窟は、どの空・どの時刻でも上乗せを受けない', () => {
    for (const placeName of ['forest', 'jungle', 'shallow_cave'])
      expect(brightestAt(placeName, weathers), placeName).toBeLessThan(lowest);
  });

  it('森の地表は、雲の無い空の正午でも開けた土地の曇りの正午ほどの明るさしかない', () => {
    expect(places.get('forest')!.brightnessAt(worldAmbientAt(NOON, 'scorching'))).toBeLessThanOrEqual(
      worldAmbientAt(NOON, 'cloudy'),
    );
  });
});

/**
 * `docs/engine/LiquidContainerSystem.md` 6節の「上乗せが効く時刻」の表。しきい値は見出しの `≧+N` から、
 * 天候の行は名前の付いた行から、雨系の行は正午の `+N以下` から読む。
 */
function brightnessTimeTableOf(): {
  readonly thresholds: readonly number[];
  readonly rows: readonly { weatherName: string; noon: string; windows: readonly string[] }[];
  readonly rainNoonAtMost: number;
  readonly rainWindows: readonly string[];
} {
  const lines = readFileSync(join('docs', 'engine', 'LiquidContainerSystem.md'), 'utf8').split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith('上乗せが効く時刻'));
  expect(start, '時刻表が見つからない').toBeGreaterThanOrEqual(0);
  const table = lines.slice(start + 1);
  const cellsOf = (line: string): string[] =>
    line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());

  const header = table.find((line) => line.startsWith('|'))!;
  const thresholds = cellsOf(header)
    .slice(2)
    .map((cell) => Number.parseFloat(cell.replace('≧', '')));
  const body = table.slice(table.indexOf(header) + 2);
  const tableRows = body.slice(
    0,
    body.findIndex((line) => !line.startsWith('|')),
  );

  const rows = tableRows
    .filter((line) => line.startsWith('| `'))
    .map((line) => {
      const [label, noon, ...windows] = cellsOf(line);
      return { weatherName: label.replaceAll('`', ''), noon, windows };
    });
  const rain = tableRows.find((line) => line.startsWith('| 雨系 |'));
  expect(rain, '時刻表に雨系の行が無い').toBeDefined();
  const [, rainNoon, ...rainWindows] = cellsOf(rain!);
  return { thresholds, rows, rainNoonAtMost: Number.parseFloat(rainNoon), rainWindows };
}

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
