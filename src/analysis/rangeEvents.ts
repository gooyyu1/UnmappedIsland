import type { PropertyDef, RangeEventLabel } from '../domain/PropertyDef';
import type { StepOutcome } from './CraftingStep';
import { destroysRoot, readEffect } from './effectOutcomes';
import type { StaticValueResolver } from './staticValue';

/**
 * range系イベント（6.3節）が端で何をするかを、実行時のオブジェクトを使わずに読んだもの。
 *
 * returnedToSelfが正なら、そのイベントは自分の値を戻す＝**繰り返す仕掛け**（罠の判定周期、
 * TrapSystem.md 2節）。destroysSelfなら、そこで自分が消える＝**寿命**（罠の朽ち、
 * DurabilitySystem.md 2節）。
 */
export interface RangeEventReadout {
  readonly label: RangeEventLabel;
  readonly returnedToSelf: number;
  readonly destroysSelf: boolean;
  readonly outcomes: readonly StepOutcome[];
}

/** そのプロパティが宣言しているrange系イベントを、端で起こることまで開いて読む。 */
export function rangeEventReadouts(
  propertyDef: PropertyDef,
  resolve: StaticValueResolver,
): readonly RangeEventReadout[] {
  const readouts: RangeEventReadout[] = [];
  for (const [label, effect] of propertyDef.rangeEvents()) {
    const reading = readEffect(effect, resolve);
    let returnedToSelf = 0;
    for (const outcome of reading.outcomes)
      for (const delta of outcome.deltas)
        if (delta.target === 'self' && delta.propertyGlobalId === propertyDef.globalId)
          returnedToSelf += outcome.probability * delta.amount;

    readouts.push({
      label,
      returnedToSelf,
      destroysSelf: destroysRoot(reading, 'self'),
      outcomes: reading.outcomes,
    });
  }
  return readouts;
}

/**
 * その値がvalueになったとき、rangeの外へ出るなら、そこで起こること。範囲に収まるならundefined。
 *
 * **一撃で端まで動かす効果も、range系イベントの引き金になる**（6.3節）。仕留めの一撃は血を0に
 * するだけで、獲物を死体へ置き換えるのは`blood`の`on_shortfall`——これを繋がないと、死体の
 * 作り方がどこにも無いことになる。
 */
export function rangeEventAt(
  propertyDef: PropertyDef,
  value: number,
  resolve: StaticValueResolver,
): RangeEventReadout | undefined {
  const range = propertyDef.range;
  if (range === undefined) return undefined;

  const label: RangeEventLabel | undefined =
    value > range.max ? 'on_overflow' : value < range.min ? 'on_shortfall' : undefined;
  if (label === undefined) return undefined;
  return rangeEventReadouts(propertyDef, resolve).find((readout) => readout.label === label);
}

/**
 * 値がtick毎にperTickずつ動いたとき、rangeの端を割る（超える）までのtick数。端まで届かない
 * 向きへ動く場合と、rangeを持たない場合、初期値が読めない場合はundefined。
 *
 * 端は「割った瞬間」なので、下限側は`min - 1`まで、上限側は`max + 1`までの距離を数える
 * （range系イベントが発火するのはrangeの外へ出た瞬間、6.3節）。
 */
export function ticksToRangeEnd(
  propertyDef: PropertyDef,
  perTick: number,
  value: number | undefined,
): number | undefined {
  const range = propertyDef.range;
  if (range === undefined || perTick === 0 || value === undefined) return undefined;

  const distance = perTick < 0 ? value - (range.min - 1) : range.max + 1 - value;
  return distance <= 0 ? undefined : distance / Math.abs(perTick);
}
