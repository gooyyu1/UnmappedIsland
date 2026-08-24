import type { ObjectDef } from '../domain/ObjectDef';
import type { WorldCodex } from '../domain/WorldCodex';
import { MINUTES_PER_TICK, TICKS_PER_DAY } from './balanceTables';
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
 * **気候の実測値を持つのはこのファイルだけ。** `src/analysis` の他はどこも季節も天候も知らない。
 *
 * **世界の定義から借りている語は、下の3つのユニオンに集めてある。** いずれも実測値の表の鍵として
 * だけ使うので `WorldVocabulary` には載せない（理由はあちらのクラスコメント）。
 */

const MINUTES_PER_HOUR = 60;

/** 季節の識別子（`core.yaml` のシンボル）。 */
export type SeasonName = 'calm' | 'wet' | 'dry';

/** 雨の降り方の識別子（`core.yaml` のシンボル）。降らない天候は数えないので並ばない。 */
export type RainWeatherName = 'light_rain' | 'heavy_rain' | 'storm';

/** 口径を言うタグ（`liquid_containers.yaml`）。蒸発の速さはこれで決まる。 */
type ApertureTagName = 'wide_open_container' | 'narrow_open_container';

/** 季節 → 蒸発量（mL/tick）。季節を1つ足したら、口径ごとに測り直すまで型検査が通らない。 */
type SeasonalEvaporation = Readonly<Record<SeasonName, number>>;

/** 季節1つぶんの気候の実測値。 */
export interface SeasonRain {
  readonly name: SeasonName;

  /** 季節1インスタンスの持続日数。 */
  readonly durationDays: number;

  /** 季節1インスタンスの間に、その降り方だった時間（h）。 */
  readonly hoursByWeather: Readonly<Record<RainWeatherName, number>>;
}

/**
 * 季節ごとの、雨が降っている時間。`npm run stats:climate` の生成物
 * （`docs/diagnostics/ClimateSystemStats.md` の「季節の持続日数」と「天気ごとの発生時間」の平均）から。
 *
 * 気候の実装を変えると実測値が動くので、生成物と食い違っていないかは
 * `tests/analysis/rainWater.test.ts` が見る。
 */
export const SEASON_RAIN: readonly SeasonRain[] = [
  {
    name: 'calm',
    durationDays: 29.81,
    hoursByWeather: { light_rain: 59.68, heavy_rain: 0.44, storm: 0.01 },
  },
  {
    name: 'wet',
    durationDays: 29.81,
    hoursByWeather: { light_rain: 236.48, heavy_rain: 224.1, storm: 77.1 },
  },
  {
    name: 'dry',
    durationDays: 29.83,
    hoursByWeather: { light_rain: 10.58, heavy_rain: 1.44, storm: 0.74 },
  },
];

/**
 * 口径のタグ → 季節 → 蒸発量（mL/tick）。**容量ではなく口径で決まる**——蒸発は口径ごとの定数
 * （`liquid_containers.yaml` の `evaporating_liquid`）で、容器の大きさには依らない。
 *
 * `LiquidContainerSystem.md` 6節の「満杯から空になるまでの日数」を、その表が見ている容量
 * （ヤシの器250mL・甕4000mL）と1日96 tickで割ったもの。日射による上乗せと「雨天は蒸発しない」を
 * 含んだ、季節を通しての平均になっている。
 *
 * | 口径 | calm | wet | dry |
 * |---|--:|--:|--:|
 * | ヤシの器（250mL） | 2.6日 | 10.1日 | 2.2日 |
 * | 甕（4000mL） | 17.1日 | 67.3日 | 14.1日 |
 */
const EVAPORATION_PER_TICK: Readonly<Record<ApertureTagName, SeasonalEvaporation>> = {
  wide_open_container: { calm: 1.0016, wet: 0.2579, dry: 1.1837 },
  narrow_open_container: { calm: 2.4366, wet: 0.6192, dry: 2.9551 },
};

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
  const rows: RainWaterRow[] = [];
  for (const def of codex.objects) {
    const container = rainCatchingContainerOf(codex, def);
    if (container === undefined) continue;
    for (const season of SEASON_RAIN) rows.push(rowOf(container, season));
  }
  return rows;
}

/** 雨を受ける容器1つ。降り方ごとに受ける量と、口径で決まる蒸発の速さを解いたもの。 */
interface RainCatchingContainer {
  readonly name: string;
  readonly capacity: number;

  /**
   * 雨の降り方の識別子 → その天候の間に増える量（mL/tick）。鍵は定義から読んだ名前そのものなので、
   * 雨とは限らない天候も並びうる。
   */
  readonly rainPerTick: ReadonlyMap<string, number>;

  /** 口径のタグが選んだ蒸発量（EVAPORATION_PER_TICK）。 */
  readonly evaporationPerTick: SeasonalEvaporation;
}

/**
 * その型が雨を受ける容器なら、量を数えるのに要るものを解く。受けないか、実測値を持たない口径なら
 * undefined。
 *
 * 雨で増える宣言（`rain_filled_liquid`）を持つのは**中身が水の変種**なので、名前は素の型から採る
 * ——読み手が探すのは「甕」であって「水入りの甕」ではない。
 */
function rainCatchingContainerOf(codex: WorldCodex, def: ObjectDef): RainCatchingContainer | undefined {
  const rainPerTick = rainPerTickOf(codex, def);
  if (rainPerTick.size === 0) return undefined;

  const capacity = def.tryGetPropertyDef(codex.vocabulary.engine.fillId)?.range?.max;
  const evaporationPerTick = evaporationPerTickOf(codex, def);
  if (capacity === undefined || evaporationPerTick === undefined) return undefined;

  return { name: codex.baseOf(def).name, capacity, rainPerTick, evaporationPerTick };
}

/**
 * その型が、天候ごとにtick毎いくつ水を受けるか。受けないなら空。
 *
 * 数えるのは**天候だけで決まる増分**に限る。他の条件（日射・段）も伴う増分は、その天候だった時間
 * だけでは何tick効いたかが決まらない。
 */
function rainPerTickOf(codex: WorldCodex, def: ObjectDef): ReadonlyMap<string, number> {
  const perWeather = new Map<string, number>();
  for (const delta of tickDeltasOf(def)) {
    if (delta.target !== 'self' || delta.propertyGlobalId !== codex.vocabulary.engine.fillId) continue;
    if (delta.amount <= 0 || delta.gate.stage !== undefined) continue;

    if (delta.gate.ancestorConditions.length !== 1) continue;
    const [condition] = delta.gate.ancestorConditions;
    if (condition.propertyGlobalId !== codex.vocabulary.world.weatherId) continue;
    // 効く天候を名指ししている比較だけ。`not_in` のように残り全部を指す比較は、どの天候で効くかを
    // ここでは決められない（天候の一覧を知らない）。
    if (condition.op !== 'eq' && condition.op !== 'in') continue;

    for (const value of condition.values) {
      const weather = codex.symbolNames.getName(value);
      perWeather.set(weather, (perWeather.get(weather) ?? 0) + delta.amount);
    }
  }
  return perWeather;
}

/** その型の口径が決める蒸発量。実測値を持たない口径ならundefined。 */
function evaporationPerTickOf(codex: WorldCodex, def: ObjectDef): SeasonalEvaporation | undefined {
  for (const [tagName, bySeason] of Object.entries(EVAPORATION_PER_TICK)) {
    const tagGlobalId = codex.tagNames.tryGetId(tagName);
    if (tagGlobalId !== undefined && def.hasTag(tagGlobalId)) return bySeason;
  }
  return undefined;
}

function rowOf(container: RainCatchingContainer, season: SeasonRain): RainWaterRow {
  let rainPerDay = 0;
  for (const [weather, hours] of Object.entries(season.hoursByWeather)) {
    const perTick = container.rainPerTick.get(weather) ?? 0;
    const ticksPerDay = (hours * MINUTES_PER_HOUR) / MINUTES_PER_TICK / season.durationDays;
    rainPerDay += perTick * ticksPerDay;
  }

  const evaporationPerDay = container.evaporationPerTick[season.name] * TICKS_PER_DAY;
  return {
    containerName: container.name,
    seasonName: season.name,
    capacity: container.capacity,
    rainPerDay,
    evaporationPerDay,
    netPerDay: rainPerDay - evaporationPerDay,
  };
}
