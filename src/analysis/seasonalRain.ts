import type { ConditionOp } from '../domain/ConditionReader';
import type { ObjectDef } from '../domain/ObjectDef';
import type { WorldCodex } from '../domain/WorldCodex';
import { worldAmbientBrightnessOf } from './activityHours';
import { TICKS_PER_DAY } from './balanceTables';
import type { AncestorCondition, TickDelta } from './tickDeltas';
import { tickDeltasOf } from './tickDeltas';

/**
 * 雨で溜まる水を「容器1種 × 季節1つ」で数える（`docs/engine/LiquidContainerSystem.md` 6・7節）。
 *
 * 工程ではなくtick毎の持続効果で増えるので、収支表の連鎖には乗らない（労働0分になる）。代わりに
 * 待ち生産表が、設備が時間をかけて返す分と並べてこの量を出す。
 *
 * **単一の平均は出さない。** 雨季とそれ以外では降る時間が1桁違い、平均するとどの季節にも存在しない
 * 中間の状態を測ることになる。読みたいのは「雨だけで水を賄えるのはどの季節か」で、それは季節ごとの
 * 差引の符号がそのまま答える。
 *
 * **降雨も蒸発も同じ1つの仕組みで数える。** どちらも `fill` をtick毎に動かす持続効果で、違うのは
 * 符号だけ——器の居る場所の天候と明るさを時刻ごとに置いて、そのとき効く増減を足し合わせる。
 * 明るさは開けた土地（`ambient_brightness` の `value` が0の土地）のもの（同6節）。
 *
 * **気候の実測値を持つのはこのファイルだけ。** `src/analysis` の他はどこも季節も天候も知らない。
 *
 * **世界の定義から借りている語は、下のユニオンに集めてある。** いずれも実測値の表の鍵として
 * だけ使うので `WorldVocabulary` には載せない（理由はあちらのクラスコメント）。
 */

const HOURS_PER_DAY = 24;

/** 季節の識別子（`core.yaml` のシンボル）。 */
export type SeasonName = 'calm' | 'wet' | 'dry';

/**
 * 天候の識別子（`core.yaml` のシンボル）。**降らない天候も並べる**——蒸発が効くのは雨天以外で、
 * 上乗せの量は明るさで決まるので、晴れと曇りを区別しないと蒸発が出ない。
 */
export type WeatherName = 'scorching' | 'sunny' | 'clear' | 'cloudy' | 'light_rain' | 'heavy_rain' | 'storm';

/** 季節1つぶんの気候の実測値。 */
export interface SeasonClimate {
  readonly name: SeasonName;

  /** 季節1インスタンスの持続日数。 */
  readonly durationDays: number;

  /** 季節1インスタンスの間に、その天候だった時間（h）。合計は `durationDays × 24` になる。 */
  readonly hoursByWeather: Readonly<Record<WeatherName, number>>;
}

/**
 * 季節ごとの、天候の出現時間。`npm run stats:climate` の生成物
 * （`stats/climate.yaml` の `season_duration` と `weather_hours` の `segment: overall` の平均）から。
 *
 * 気候の実装を変えると実測値が動くので、生成物と食い違っていないかは
 * `tests/analysis/rainWater.test.ts` が見る。生成物そのものが古くなっていないかは
 * `tests/diagnostics/climateStatsReport.test.ts`。
 */
export const SEASON_CLIMATE: readonly SeasonClimate[] = [
  {
    name: 'calm',
    durationDays: 29.83,
    hoursByWeather: {
      scorching: 1.11,
      sunny: 159.62,
      clear: 322.49,
      cloudy: 172.85,
      light_rain: 59.37,
      heavy_rain: 0.47,
      storm: 0.04,
    },
  },
  {
    name: 'wet',
    durationDays: 29.91,
    hoursByWeather: {
      scorching: 0.0,
      sunny: 23.23,
      clear: 85.51,
      cloudy: 69.79,
      light_rain: 238.17,
      heavy_rain: 222.39,
      storm: 78.75,
    },
  },
  {
    name: 'dry',
    durationDays: 30.1,
    hoursByWeather: {
      scorching: 84.75,
      sunny: 171.69,
      clear: 313.39,
      cloudy: 139.87,
      light_rain: 10.47,
      heavy_rain: 1.33,
      storm: 0.86,
    },
  },
];

/** 待ち生産表の1行（容器1種 × 季節1つ）。量はすべてmL。 */
export interface RainWaterRow {
  readonly containerName: string;
  readonly seasonName: SeasonName;

  /** 容器が抱えられる量。これを超えて降った分はあふれて失われる。 */
  readonly capacity: number;

  readonly rainPerDay: number;
  readonly evaporationPerDay: number;

  /**
   * 降雨 − 蒸発。**あふれた分の損失は含まない**（容量を超えて降っても、この差引はそのまま増える
   * 前提で出している）。満杯の容器を汲み替え続けたときの上限。
   */
  readonly netPerDay: number;
}

/** 雨を受ける容器すべてについて、季節ごとに1日で増減する水の量。 */
export function rainWaterRows(codex: WorldCodex): readonly RainWaterRow[] {
  // 量の動く容器を先に選ぶ。**そういう容器が1つも無ければ世界の明るさも要らない**——液体を持たない
  // 定義（解析の単体試験のミニ定義など）でも、worldの宣言を求めずに空の表を返せる。
  const containers: { def: ObjectDef; capacity: number; deltas: readonly TickDelta[] }[] = [];
  for (const def of codex.objects) {
    const capacity = def.tryGetPropertyDef(codex.vocabulary.engine.fillId)?.range?.max;
    const deltas = fillDeltasOf(codex, def);
    if (capacity !== undefined && deltas.length > 0) containers.push({ def, capacity, deltas });
  }
  if (containers.length === 0) return [];

  const climate = new SeasonalFillClimate(codex);

  const rows: RainWaterRow[] = [];
  for (const { def, capacity, deltas } of containers) {
    const seasonal = SEASON_CLIMATE.map((season) => climate.fillPerDayIn(season, deltas));
    // 雨で増えない容器はこの表の対象ではない（蓋のできる容器・雨として降らない液体）。
    if (seasonal.every(({ gain }) => gain === 0)) continue;

    const containerName = codex.baseOf(def).name;
    for (const [index, season] of SEASON_CLIMATE.entries()) {
      const { gain, loss } = seasonal[index];
      rows.push({
        containerName,
        seasonName: season.name,
        capacity,
        rainPerDay: gain,
        evaporationPerDay: loss,
        netPerDay: gain - loss,
      });
    }
  }
  return rows;
}

/** 1日ぶんの `fill` の増減。あふれと在庫のクランプは見ていないので、どちらも上限。 */
interface FillPerDay {
  /** 降って増える分（mL/日）。 */
  readonly gain: number;

  /** 蒸発して減る分（mL/日、正の量）。 */
  readonly loss: number;
}

/**
 * 器の居る場所の天候と明るさを時刻ごとに置いて、`fill` の増減を季節平均へ均す道具。
 *
 * **天候と時刻は独立とみなす近似。** 実測値が持っているのは季節ごとの出現時間だけで、どの天候が
 * どの時刻に多いかは持っていない。
 */
class SeasonalFillClimate {
  private readonly codex: WorldCodex;

  private readonly worldAmbientAt: (hour: number, weatherName: string) => number;

  constructor(codex: WorldCodex) {
    this.codex = codex;
    this.worldAmbientAt = worldAmbientBrightnessOf(codex);
  }

  fillPerDayIn(season: SeasonClimate, deltas: readonly TickDelta[]): FillPerDay {
    let gain = 0;
    let loss = 0;
    for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
      for (const [weatherName, hoursInSeason] of Object.entries(season.hoursByWeather)) {
        const fraction = hoursInSeason / (season.durationDays * HOURS_PER_DAY) / HOURS_PER_DAY;
        const state = this.stateAt(hour, weatherName);
        for (const delta of deltas) {
          if (!this.holdsUnder(delta, state)) continue;
          if (delta.amount > 0) gain += fraction * delta.amount;
          else loss -= fraction * delta.amount;
        }
      }
    }
    return { gain: gain * TICKS_PER_DAY, loss: loss * TICKS_PER_DAY };
  }

  private stateAt(hour: number, weatherName: string): AncestorState {
    return {
      // 定義に無い天候の名前は、どのシンボルとも等しくない番号にする——`eq` は成立せず `not_in` は
      // 成立するという、その天候が定義に無いことの正しい読み方になる。
      weatherSymbolId: this.codex.symbolNames.tryGetId(weatherName) ?? UNKNOWN_SYMBOL_ID,
      ambientBrightness: this.worldAmbientAt(hour, weatherName),
    };
  }

  /**
   * その増減が、この天候と明るさのもとで効くか。
   *
   * **祖先へ課された比較のうち、天候と明るさだけを判定する。** 雨よけ（`sheltered`）のように
   * 場所の置き方で決まる条件は真偽を決めずに素通しするので、この表は**雨の当たる開けた場所に
   * 置いた容器**の量になる（`docs/diagnostics/BalanceStats.md`「この表が数えていないもの」）。
   *
   * 段（`stage`）で縛られた増減は数えない——その段だった時間は天候の出現時間からは決まらない。
   */
  private holdsUnder(delta: TickDelta, state: AncestorState): boolean {
    if (delta.gate.stage !== undefined) return false;
    return delta.gate.ancestorConditions.every((condition) => this.conditionHolds(condition, state));
  }

  private conditionHolds(condition: AncestorCondition, state: AncestorState): boolean {
    const { world } = this.codex.vocabulary;
    if (condition.propertyGlobalId === world.weatherId)
      return comparisonHolds(condition.op, state.weatherSymbolId, condition.values);
    if (condition.propertyGlobalId === world.ambientBrightnessId)
      return comparisonHolds(condition.op, state.ambientBrightness, condition.values);
    return true;
  }
}

/** その器が居る場所の状態のうち、`fill` の増減が見ているもの。 */
interface AncestorState {
  readonly weatherSymbolId: number;
  readonly ambientBrightness: number;
}

/** どのシンボルとも一致しない番号（シンボルの識別子は0以上）。 */
const UNKNOWN_SYMBOL_ID = -1;

/** その型が宣言している、自分の `fill` をtick毎に動かす分。 */
function fillDeltasOf(codex: WorldCodex, def: ObjectDef): readonly TickDelta[] {
  return tickDeltasOf(def).filter(
    (delta) => delta.target === 'self' && delta.propertyGlobalId === codex.vocabulary.engine.fillId,
  );
}

function comparisonHolds(op: ConditionOp, value: number, values: readonly number[]): boolean {
  switch (op) {
    case 'lt':
      return value < values[0];
    case 'lte':
      return value <= values[0];
    case 'gt':
      return value > values[0];
    case 'gte':
      return value >= values[0];
    case 'eq':
      return value === values[0];
    case 'neq':
      return value !== values[0];
    case 'in':
      return values.includes(value);
    case 'not_in':
      return !values.includes(value);
  }
}
