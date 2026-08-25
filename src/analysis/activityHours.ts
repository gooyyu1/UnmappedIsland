import type { ObjectDef } from '../domain/ObjectDef';
import type { PassiveDeclaration, PassivePropertyReading, PassiveReader } from '../domain/PassiveReader';
import type { WorldCodex } from '../domain/WorldCodex';

/**
 * 土地×季節ごとの「移動できる／活動できる時間（時間/日）」を、`core.yaml`の`hour`・`weather`の段
 * （太陽高度と天気の透過率がambient_brightnessへ与える寄与）と、`locations.yaml`の土地ごとの
 * ambient_brightness（樹冠＋反射）から数える（IlluminationSystem.md 2節・5節）。
 *
 * **表の数値を書き写さず、段そのものを読む。** hourとweatherがambient_brightnessをmodifyする量は
 * `core.yaml`のstages passivesから読み取り、太陽高度・天気の透過率の値をこのファイルは持たない。
 * 据え付けの光源（松明・炉）は数えない——入れると「焚き火があれば24時間活動できる」になり、
 * この表の意味が消える（IlluminationSystem.md 3節）。
 *
 * **「屋外で採れる」と「手元の細かい作業」は1列に畳んである。** どちらもしきい値は+5だが、見る値が
 * 違う（採る側はlooking_brightness、作る側はhand_brightness）。据え付けの光源を数えない前提では、
 * 両方とも土地のambient_brightnessをそのまま土台にするだけで他の寄与を持たないため（同2節）、
 * 常に同じ値になる——分けて計算しても差が出ない。
 *
 * 天候の出現時間は呼び出し側が渡す（`npm run stats:climate`が実測する20シード×3,600日の平均、
 * `ClimateSystemStats.md`）。天候と時刻は独立とみなす近似は`seasonalRain.ts`と同じ。
 */

/** IlluminationSystem.md 5節: 移動のしきい値（looking_brightness ≥ −5）。 */
const TRAVEL_THRESHOLD = -5;

/** 同節: 屋外の採取・手元の作業のしきい値（looking_brightness・hand_brightness ともに ≥ +5）。 */
const ACTIVE_THRESHOLD = 5;

/** 季節1つぶんの、天候の出現時間の実測値（`ClimateSystemStats.md`）。 */
export interface SeasonWeatherHours {
  readonly seasonName: string;

  /** 季節1インスタンスの持続日数の平均。 */
  readonly durationDays: number;

  /** 天候の識別子（`core.yaml`のシンボル名）→ 季節1インスタンスの間にその天候だった時間（h）の平均。 */
  readonly hoursByWeather: ReadonlyMap<string, number>;
}

/** 活動時間表の1行（土地1つ × 季節1つ）。 */
export interface ActivityHoursRow {
  readonly locationName: string;
  readonly seasonName: string;

  /** 土地の間を移動できる時間（時間/日）。 */
  readonly travelHoursPerDay: number;

  /** 屋外で採れる・手元の細かい作業ができる時間（時間/日、1列に畳んだもの）。 */
  readonly activeHoursPerDay: number;
}

/** 土地×季節ごとの活動時間表を、定義と天候の実測値から組み立てる。 */
export function activityHoursOf(
  codex: WorldCodex,
  seasons: readonly SeasonWeatherHours[],
): readonly ActivityHoursRow[] {
  const world = codex.objects.get(codex.objectNames.getId('world'));
  const ambientId = codex.vocabulary.world.ambientBrightnessId;
  const hourId = codex.vocabulary.world.hourId;
  const weatherId = codex.vocabulary.world.weatherId;

  const hourPropDef = world.tryGetPropertyDef(hourId);
  const ambientPropDef = world.tryGetPropertyDef(ambientId);
  if (hourPropDef === undefined || ambientPropDef === undefined)
    throw new Error('world が hour・ambient_brightness を宣言していません。');

  // hour/weatherの段がworldのambient_brightnessへ与える寄与（段名 → 加算量）。stages passivesの
  // modifyから直接読むので、太陽高度や透過率の値を書き写す箇所が無い。
  const hourDeltas = stageModifyDeltasOf(world, ambientId, hourId);
  const weatherDeltas = stageModifyDeltasOf(world, ambientId, weatherId);

  const worldAmbientAt = (hour: number, weatherName: string): number => {
    const hourStage = hourPropDef.stageAt(hour);
    const hourDelta = hourStage === undefined ? 0 : (hourDeltas.get(hourStage.name) ?? 0);
    const weatherDelta = weatherDeltas.get(weatherName) ?? 0;
    const raw = ambientPropDef.initialValueWithoutRoll + hourDelta + weatherDelta;
    return ambientPropDef.range === undefined ? raw : ambientPropDef.range.clamp(raw);
  };

  const rows: ActivityHoursRow[] = [];
  for (const location of activityLocationsOf(codex)) {
    const locationAmbientDef = location.tryGetPropertyDef(ambientId);
    if (locationAmbientDef === undefined) continue;
    const ownValue = locationAmbientDef.initialValueWithoutRoll;
    const range = locationAmbientDef.range;

    for (const season of seasons) {
      let travelHoursPerDay = 0;
      let activeHoursPerDay = 0;

      for (let hour = 0; hour < 24; hour++) {
        for (const [weatherName, hoursInSeason] of season.hoursByWeather) {
          const fraction = hoursInSeason / (season.durationDays * 24);
          const raw = worldAmbientAt(hour, weatherName) + ownValue;
          const brightness = range === undefined ? raw : range.clamp(raw);
          if (brightness >= TRAVEL_THRESHOLD) travelHoursPerDay += fraction;
          if (brightness >= ACTIVE_THRESHOLD) activeHoursPerDay += fraction;
        }
      }

      rows.push({
        locationName: location.name,
        seasonName: season.seasonName,
        travelHoursPerDay,
        activeHoursPerDay,
      });
    }
  }
  return rows;
}

/**
 * 表に出す土地。探索できる土地（`explorable`、`ContentSkeleton.md` 8.1.2節の全種類）に、浅い洞窟
 * （`shallow_cave`）を続けて並べる。浅い洞窟は土地ではなく設置物だが、この表が数えたい「その中で
 * 活動できる時間」を持つため加える（`Dwellings.md` 5.1節）。
 */
function activityLocationsOf(codex: WorldCodex): readonly ObjectDef[] {
  const locationTagId = codex.vocabulary.world.locationTagId;
  const progressId = codex.vocabulary.world.explorationProgressId;
  const explorable = [...codex.objects].filter(
    (def) => def.hasTag(locationTagId) && def.tryGetPropertyDef(progressId) !== undefined,
  );

  const shallowCaveId = codex.objectNames.tryGetId('shallow_cave');
  const shallowCave = shallowCaveId === undefined ? undefined : codex.objects.tryGet(shallowCaveId);
  return shallowCave === undefined ? explorable : [...explorable, shallowCave];
}

/**
 * defが宣言している段（6.4節）のうち、propertyGlobalIdを対象にmodifyし、gateByPropertyGlobalIdの
 * 段でゲートされているものを、段名 → 加算量の合計として集める。実行時のオブジェクトを使わず、
 * ロード済みの持続効果宣言（passives）を読み下すだけ。
 */
function stageModifyDeltasOf(
  def: ObjectDef,
  propertyGlobalId: number,
  gateByPropertyGlobalId: number,
): ReadonlyMap<string, number> {
  const collector = new StageModifyCollector(propertyGlobalId, gateByPropertyGlobalId);
  for (const declaration of def.passives.declarations) (declaration as PassiveDeclaration).read(collector);
  return collector.deltas;
}

class StageModifyCollector implements PassiveReader {
  readonly deltas = new Map<string, number>();

  constructor(
    private readonly propertyGlobalId: number,
    private readonly gateByPropertyGlobalId: number,
  ) {}

  modify(reading: PassivePropertyReading): void {
    if (reading.target !== 'self' || reading.propertyGlobalId !== this.propertyGlobalId) return;
    if (reading.amount.kind !== 'fixed') return;

    const stage = reading.gate.stage;
    if (stage === undefined || stage.propertyGlobalId !== this.gateByPropertyGlobalId) return;

    this.deltas.set(stage.name, (this.deltas.get(stage.name) ?? 0) + reading.amount.value);
  }

  accumulate(): void {}

  transfer(): void {}
}
