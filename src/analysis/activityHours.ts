import type { EffectReader, PickCandidateReading } from '../domain/EffectReader';
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
 * **浅い洞窟の土台は、生える先の土地から辿る**（`hostAmbientOf`）。岩陰の暗さ（-6）は土地との差
 * なので、生え先が非0の土地へ広がっても数え直しは要らない——ただし生え先どうしで明るさが違うと
 * 1行では出せないので、そのときは例外にする。
 *
 * 天候の出現時間は呼び出し側が渡す（`npm run stats:climate`が実測する20シード×3,600日の平均、
 * `ClimateSystemStats.md`）。天候と時刻は独立とみなす近似は`seasonalRain.ts`と同じ。
 */

/**
 * IlluminationSystem.md 5節: 移動のしきい値（looking_brightness が `pitch_dark` でないこと ＝ ≥ −5）。
 *
 * **境目を持つのはキャラクタの段の宣言だけ**（同 8節）なので、これはその写し。段と一致しているかは
 * `tests/diagnostics/activityHoursAssumptions.test.ts` が見る。
 */
export const TRAVEL_THRESHOLD = -5;

/** 同節: 屋外の採取・手元の作業のしきい値（looking_brightness・hand_brightness の `bright` ＝ ≥ +5）。 */
export const ACTIVE_THRESHOLD = 5;

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

/**
 * 世界の環境光（`ambient_brightness`）を、時刻（0〜23）と天候から解く。`core.yaml` の `hour`・
 * `weather` の段が与える寄与の和で、**土地の寄与は含まない**——樹冠も反射も無い開けた土地
 * （`value: 0`）では、これがそのまま器や人へ届く明るさになる（IlluminationSystem.md 2節）。
 *
 * 蒸発（`seasonalRain.ts`）も同じ明るさを見るので、寄与の読み方はここ1箇所にある。
 */
export function worldAmbientBrightnessOf(codex: WorldCodex): (hour: number, weatherName: string) => number {
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

  return (hour, weatherName) => {
    const hourStage = hourPropDef.stageAt(hour);
    const hourDelta = hourStage === undefined ? 0 : (hourDeltas.get(hourStage.name) ?? 0);
    const weatherDelta = weatherDeltas.get(weatherName) ?? 0;
    const raw = ambientPropDef.initialValueWithoutRoll + hourDelta + weatherDelta;
    return ambientPropDef.range === undefined ? raw : ambientPropDef.range.clamp(raw);
  };
}

/** 土地×季節ごとの活動時間表を、定義と天候の実測値から組み立てる。 */
export function activityHoursOf(
  codex: WorldCodex,
  seasons: readonly SeasonWeatherHours[],
): readonly ActivityHoursRow[] {
  const worldAmbientAt = worldAmbientBrightnessOf(codex);

  const rows: ActivityHoursRow[] = [];
  for (const place of activityPlacesOf(codex)) {
    for (const season of seasons) {
      let travelHoursPerDay = 0;
      let activeHoursPerDay = 0;

      for (let hour = 0; hour < 24; hour++) {
        for (const [weatherName, hoursInSeason] of season.hoursByWeather) {
          const fraction = hoursInSeason / (season.durationDays * 24);
          const brightness = place.brightnessAt(worldAmbientAt(hour, weatherName));
          if (brightness >= TRAVEL_THRESHOLD) travelHoursPerDay += fraction;
          if (brightness >= ACTIVE_THRESHOLD) activeHoursPerDay += fraction;
        }
      }

      rows.push({
        locationName: place.name,
        seasonName: season.seasonName,
        travelHoursPerDay,
        activeHoursPerDay,
      });
    }
  }
  return rows;
}

/** 表の1行を出す場所。世界の環境光から、そこへ届く明るさを出せる。 */
interface ActivityPlace {
  readonly name: string;

  /** 世界の環境光（`worldAmbientBrightnessOf`）から、その場所の明るさ。 */
  brightnessAt(worldAmbient: number): number;
}

/**
 * 表に出す場所。探索できる土地（`explorable`、`ContentSkeleton.md` 8.1.2節の全種類）に、浅い洞窟
 * （`shallow_cave`）を続けて並べる。浅い洞窟は土地ではなく設置物だが、この表が数えたい「その中で
 * 活動できる時間」を持つため加える（`Dwellings.md` 5.1節）。
 */
function activityPlacesOf(codex: WorldCodex): readonly ActivityPlace[] {
  const ambientId = codex.vocabulary.world.ambientBrightnessId;
  const locationTagId = codex.vocabulary.world.locationTagId;
  const progressId = codex.vocabulary.world.explorationProgressId;

  const places: ActivityPlace[] = [];
  for (const def of codex.objects) {
    if (!def.hasTag(locationTagId) || def.tryGetPropertyDef(progressId) === undefined) continue;
    const place = placeOf(def, ambientId, 0);
    if (place !== undefined) places.push(place);
  }

  const shallowCaveId = codex.objectNames.tryGetId('shallow_cave');
  const shallowCave = shallowCaveId === undefined ? undefined : codex.objects.tryGet(shallowCaveId);
  if (shallowCave === undefined) return places;

  const cave = placeOf(shallowCave, ambientId, hostAmbientOf(codex, shallowCave, ambientId));
  return cave === undefined ? places : [...places, cave];
}

/** ambient_brightnessを宣言していれば、その場所。宣言していなければundefined（表に出さない）。 */
function placeOf(def: ObjectDef, ambientId: number, hostAmbient: number): ActivityPlace | undefined {
  const ambientDef = def.tryGetPropertyDef(ambientId);
  if (ambientDef === undefined) return undefined;

  const offset = hostAmbient + ambientDef.initialValueWithoutRoll;
  const range = ambientDef.range;
  return {
    name: def.name,
    brightnessAt: (worldAmbient) =>
      range === undefined ? worldAmbient + offset : range.clamp(worldAmbient + offset),
  };
}

/**
 * その設置物が生える先の土地の `ambient_brightness`。**生える先は探索の抽選（`spawn`）から辿る**ので、
 * 生え先が増えても書き写す箇所は無い。
 *
 * 表の1行は明るさを1つしか出せないので、**生え先の明るさが食い違っていたら例外にする**（岩陰の
 * 暗さは土地との差なので、砂浜の浅い洞窟と森の浅い洞窟は別の明るさになる）。生え先が1つも見つから
 * ないときも同じ——抽選の書き方が変わって辿れなくなったのに、0として黙って通すことになる。
 */
function hostAmbientOf(codex: WorldCodex, def: ObjectDef, ambientId: number): number {
  const hosts = [...codex.objects].filter((candidate) => spawnedObjectIdsOf(candidate).has(def.globalId));
  const values = new Map<number, string[]>();
  for (const host of hosts) {
    const value = host.tryGetPropertyDef(ambientId)?.initialValueWithoutRoll ?? 0;
    values.set(value, [...(values.get(value) ?? []), host.name]);
  }

  if (values.size === 1) return [...values.keys()][0];
  if (values.size === 0) throw new Error(`${def.name} を生む spawn がどこにも見つかりません。`);
  throw new Error(
    `${def.name} の生え先の ambient_brightness が食い違っています` +
      `（${[...values].map(([value, names]) => `${value}: ${names.join('・')}`).join('、')}）。` +
      '1行では明るさを1つしか出せないので、表の作りを見直してください。',
  );
}

/** その型の操作が生みうるオブジェクト（`spawn`、9.4節）。**抽選の枝も分け隔てなく集める。** */
function spawnedObjectIdsOf(def: ObjectDef): ReadonlySet<number> {
  const collector = new SpawnCollector();
  for (const trigger of def.triggers) trigger.interaction.read(collector);
  return collector.objectGlobalIds;
}

class SpawnCollector implements EffectReader {
  readonly objectGlobalIds = new Set<number>();

  spawn(objectGlobalId: number): void {
    this.objectGlobalIds.add(objectGlobalId);
  }

  pick(candidates: readonly PickCandidateReading[]): void {
    // 重みは見ない。**起こりうるかだけを問う**ので、確率0の枝も生む先として数える。
    for (const candidate of candidates) candidate.effect.read(this);
  }

  set(): void {}

  add(): void {}

  destroy(): void {}

  become(): void {}

  transfer(): void {}

  move(): void {}

  signal(): void {}
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
