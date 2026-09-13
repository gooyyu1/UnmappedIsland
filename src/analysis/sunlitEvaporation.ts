import type { ObjectDef } from '../domain/ObjectDef';
import type { WorldCodex } from '../domain/WorldCodex';
import { litPlacesOf, worldAmbientBrightnessOf } from './activityHours';
import type { SeasonClimate, SeasonName, WeatherName } from './seasonalRain';
import { SEASON_CLIMATE } from './seasonalRain';
import { ancestorConditionsHold } from './skyState';
import type { TickDelta } from './tickDeltas';
import { tickDeltasOf } from './tickDeltas';

/**
 * 日射で進む蒸発（`docs/engine/LiquidContainerSystem.md` 6節の「上乗せ」）が、**どんな空のもとで
 * 効いているか**を土地×季節ごとに数える。
 *
 * 蒸発が読むのは `ambient_brightness` 1本で、そこには太陽高度と雲の厚さが畳まれている。畳んだままで
 * よいかは、**同じ上乗せを乾いた空と曇った空が分け合っているか**で決まる——分け合っていれば、明るさに
 * 現れない湿りのぶんだけ、曇った空の下の器が乾きすぎる。分け合っていなければ、畳みが蒸発へ持ち込む
 * 誤りは無い。
 *
 * **数えるのは時間であって、量ではない。** 減る量そのものは `seasonalRain` が出す。
 */

const HOURS_PER_DAY = 24;

/**
 * 明るさに現れない湿りを連れてくる空か。**雲が空を覆っている天候**が真で、雨だけでなく曇りも入る
 * ——同じ明るさでも、この空の下の空気は乾いた空の下より湿っている。晴れ系を偽に置くのは、それらの
 * 差が雲の厚さの差そのもので、`ambient_brightness` がその差を既に持っているため。
 *
 * **天候を1つ残らず並べる。** 天候が増えたときに、湿った側が既定で乾いた側へ落ちることがない。
 */
const OVERCAST_SKY: Readonly<Record<WeatherName, boolean>> = {
  scorching: false,
  sunny: false,
  clear: false,
  cloudy: true,
  light_rain: true,
  heavy_rain: true,
  storm: true,
};

/** 数える天候。上の表の鍵そのものなので、**天候が増えれば数える側も必ず増える**。 */
const WEATHERS = Object.keys(OVERCAST_SKY) as readonly WeatherName[];

/** 土地1つ × 季節1つぶんの、日射で進む蒸発が効いている時間。 */
export interface SunlitEvaporationRow {
  readonly locationName: string;
  readonly seasonName: SeasonName;

  /** 日射の上乗せが1つでも効いている時間（時間/日）。 */
  readonly sunlitHoursPerDay: number;

  /**
   * そのうち、空が曇っていた時間（時間/日、{@link OVERCAST_SKY}）。**ここが 0 でない土地では、
   * 明るさへ畳んだせいで曇った空が晴れた空と同じ速さで水を飛ばしている。**
   */
  readonly overcastHoursPerDay: number;
}

/** 明るさを解けるすべての場所について、季節ごとに日射の上乗せが効いている時間。 */
export function sunlitEvaporationRows(codex: WorldCodex): readonly SunlitEvaporationRow[] {
  const sunlitDeltas = [...codex.objects].flatMap((def) => [...sunlitFillDeltasOf(codex, def)]);
  if (sunlitDeltas.length === 0) return [];

  const worldAmbientAt = worldAmbientBrightnessOf(codex);

  const rows: SunlitEvaporationRow[] = [];
  for (const place of litPlacesOf(codex)) {
    for (const season of SEASON_CLIMATE) {
      let sunlitHoursPerDay = 0;
      let overcastHoursPerDay = 0;
      for (const [hour, weatherName, hoursPerDay] of hoursOf(season)) {
        const sky = {
          weatherSymbolId: codex.symbolNames.tryGetId(weatherName),
          ambientBrightness: place.brightnessAt(worldAmbientAt(hour, weatherName)),
        };
        if (!sunlitDeltas.some((delta) => ancestorConditionsHold(codex, delta.gate.ancestorConditions, sky)))
          continue;
        sunlitHoursPerDay += hoursPerDay;
        if (OVERCAST_SKY[weatherName]) overcastHoursPerDay += hoursPerDay;
      }
      rows.push({
        locationName: place.name,
        seasonName: season.name,
        sunlitHoursPerDay,
        overcastHoursPerDay,
      });
    }
  }
  return rows;
}

/**
 * その季節の1日を、時刻と天候の組へ割った時間（時間/日）。
 *
 * **天候と時刻は独立とみなす近似**（`seasonalRain` と同じ）。実測値が持っているのは季節ごとの出現
 * 時間だけで、どの天候がどの時刻に多いかは持っていない。
 */
function* hoursOf(season: SeasonClimate): Generator<[number, WeatherName, number]> {
  for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
    for (const weatherName of WEATHERS) {
      yield [hour, weatherName, season.hoursByWeather[weatherName] / season.durationDays / HOURS_PER_DAY];
    }
  }
}

/**
 * その型が宣言している、**明るさで決まる** `fill` の減り（`LiquidContainerSystem.md` 6節の上乗せ）。
 * 日射に依らない基礎の蒸発は含まない——あちらは天候を雨かどうかでしか見ておらず、畳みの影響を
 * 受けないため。
 */
function sunlitFillDeltasOf(codex: WorldCodex, def: ObjectDef): readonly TickDelta[] {
  const { ambientBrightnessId } = codex.vocabulary.world;
  return tickDeltasOf(def).filter(
    (delta) =>
      delta.target === 'self' &&
      delta.propertyGlobalId === codex.vocabulary.engine.fillId &&
      delta.amount < 0 &&
      delta.gate.stage === undefined &&
      delta.gate.ancestorConditions.some((condition) => condition.propertyGlobalId === ambientBrightnessId),
  );
}
