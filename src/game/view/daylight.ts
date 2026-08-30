import type { ObjectDef } from '../../domain/ObjectDef';
import type { PassiveDeclaration, PassivePropertyReading, PassiveReader } from '../../domain/PassiveReader';
import type { WorldCodex } from '../../domain/WorldCodex';

/** 手元の細かい作業ができるキャラクタのプロパティと、その段（IlluminationSystem.md 5節・8節）。 */
const HAND_BRIGHTNESS = 'hand_brightness';
const HANDWORK_STAGE = 'bright';

/** 経過のある瞬間の日付と時刻。控え（`RecordedView.view`）をそのまま渡せる形。 */
export interface DaylightMoment {
  readonly elapsedDays: number;
  readonly hour: number;
}

/** 日が昇った・沈んだ、その1回（ScreenLayout.md 7.5.6節）。 */
export interface Daybreak {
  readonly kind: 'sunrise' | 'sunset';

  /** またいだ時点の生存日数。日の出のときだけ、これを大きく出す。 */
  readonly elapsedDays: number;
}

/**
 * 太陽の光だけで手元の細かい作業ができる時刻（IlluminationSystem.md 5節）と、その境目をまたいだか。
 *
 * **天気を見ない。** 見るのは太陽高度が世界の `ambient_brightness` へ与える寄与だけで、雲がどれだけ
 * 陽を遮るか（`core.yaml`のweather）も、樹冠と地面の反射（`locations.yaml`）も足さない——出すのは
 * 太陽が昇った・沈んだという位置の話なので、**嵐が来ただけで日が沈んではならない。**
 *
 * **数字を1つも持たない。** しきい値を持つのはキャラクタの `hand_brightness` の段だけ（同8節）、
 * 太陽高度の寄与を持つのは `hour` の段の `modify` だけ、1日の長さを持つのは `hour` の値域だけなので、
 * どれも宣言から読む。
 */
export class SunlightHours {
  private readonly litHours: ReadonlySet<number>;

  private constructor(litHours: ReadonlySet<number>) {
    this.litHours = litHours;
  }

  /**
   * そのキャラクタにとっての境目。明るさを宣言していない世界・キャラクタでは、どの時刻も明るく
   * ない扱いになる——境目が無ければ、またぐこともない。
   */
  static of(codex: WorldCodex, character: ObjectDef): SunlightHours {
    return new SunlightHours(litHoursOf(codex, character));
  }

  /** その時刻に、太陽の光だけで手元の細かい作業ができるか。 */
  handworkLitAt(hour: number): boolean {
    return this.litHours.has(hour);
  }

  /** beforeからafterへ移る間にまたいだ境目。またいでいなければundefined。 */
  daybreakBetween(before: DaylightMoment, after: DaylightMoment): Daybreak | undefined {
    const lit = this.handworkLitAt(after.hour);
    if (this.handworkLitAt(before.hour) === lit) return undefined;
    return { kind: lit ? 'sunrise' : 'sunset', elapsedDays: after.elapsedDays };
  }
}

/** 太陽の光だけで手元の細かい作業ができる時刻（0〜23）。 */
function litHoursOf(codex: WorldCodex, character: ObjectDef): ReadonlySet<number> {
  const words = codex.vocabulary.world;
  const handBrightnessId = codex.propertyNames.tryGetId(HAND_BRIGHTNESS);
  const threshold =
    handBrightnessId === undefined
      ? undefined
      : character.tryGetPropertyDef(handBrightnessId)?.stages.find((stage) => stage.name === HANDWORK_STAGE)
          ?.min;

  const worldId = codex.objectNames.tryGetId(words.worldObject);
  const world = worldId === undefined ? undefined : codex.objects.tryGet(worldId);
  const hourDef = world?.tryGetPropertyDef(words.hourId);
  const ambientDef = world?.tryGetPropertyDef(words.ambientBrightnessId);
  if (world === undefined || hourDef === undefined || ambientDef === undefined) return new Set();
  if (threshold === undefined) return new Set();

  // 太陽が1周する時の並びは、時刻そのものの値域が持つ。**上限は含まない**——そこに達した時刻は
  // その場で繰り上がる（`on_max`）ので、居座る値は下限から上限の手前までになる。
  const clock = hourDef.range;
  if (clock === undefined) return new Set();

  const deltas = sunDeltasOf(world, words.ambientBrightnessId, words.hourId);
  const lit = new Set<number>();
  for (let hour = clock.min; hour < clock.max; hour++) {
    const stage = hourDef.stageAt(hour);
    const raw =
      ambientDef.initialValueWithoutRoll + (stage === undefined ? 0 : (deltas.get(stage.name) ?? 0));
    if ((ambientDef.range?.clamp(raw) ?? raw) >= threshold) lit.add(hour);
  }
  return lit;
}

/**
 * `hour` の段が世界の `ambient_brightness` へ与える寄与（段名 → 加算量）。宣言を読み下すだけなので、
 * 太陽高度の値をこちらは持たない。
 *
 * **解析層（`src/analysis`）にある同じ読み取りとは共有しない。** 遊びの本体はあちらの存在を知らない
 * 決まりで（CodeStructure.md 5節、`tests/architecture/layers.test.ts`）、定義から数値を導く近似がこちらの
 * 契約へ混ざらないよう境界が引いてある。
 */
function sunDeltasOf(world: ObjectDef, ambientId: number, hourId: number): ReadonlyMap<string, number> {
  const collector = new HourModifyCollector(ambientId, hourId);
  for (const declaration of world.passives.declarations) (declaration as PassiveDeclaration).read(collector);
  return collector.deltas;
}

class HourModifyCollector implements PassiveReader {
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
