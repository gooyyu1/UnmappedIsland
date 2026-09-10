import type { PropertyDef, RangeEventLabel } from '../domain/PropertyDef';
import { endMovedToward } from '../domain/PropertyDef';
import type { StepOutcome } from './CraftingStep';
import { destroysRoot, readEffect } from './effectOutcomes';
import type { EndBoundValueResolver } from './staticValue';

/**
 * range系イベント（6.3節）が端で何をするかを、実行時のオブジェクトを使わずに読んだもの。
 *
 * expectedReturnToSelfが正なら、そのイベントは自分の値を戻す＝**繰り返す仕掛け**（罠の判定周期、
 * TrapSystem.md 2節）。destroysSelfなら、そこで自分が消える＝**寿命**（罠の朽ち、
 * DurabilitySystem.md 2節）。
 *
 * **戻り量は、発火した端からrangeの内側へ動いた距離**（PropertyRange.inwardFrom）で、どちらの端でも
 * 正で測る。**両端を同じ向きで測るのは、周期（rangeCycles）が端によって
 * 別の意味にならないため**で、片端だけを特別扱いすると「戻る」が上端では負を意味することになる。
 * 端に置いたままにする宣言——既定のクランプと、それを自分で書き写した`on_max`——は0になる。
 */
export interface RangeEventReadout {
  readonly label: RangeEventLabel;
  readonly expectedReturnToSelf: number;
  readonly destroysSelf: boolean;
  readonly outcomes: readonly StepOutcome[];
}

/** そのプロパティが宣言しているrange系イベントを、端で起こることまで開いて読む。 */
export function rangeEventReadouts(
  propertyDef: PropertyDef,
  resolve: EndBoundValueResolver,
): readonly RangeEventReadout[] {
  const range = propertyDef.range;
  // 端が無ければ端のイベントも無い——rangeを持たないプロパティのon_max/on_minはPropertyDefが弾き、
  // 既定のクランプもrangeから作られる。
  if (range === undefined) return [];

  const readouts: RangeEventReadout[] = [];
  for (const [label, effect] of propertyDef.rangeEvents()) {
    const reading = readEffect(effect, resolve);
    const end = range.endValue(label);
    let expectedReturnToSelf = 0;
    for (const outcome of reading.outcomes)
      expectedReturnToSelf +=
        outcome.probability * range.inwardFrom(label, selfValueAfter(propertyDef, outcome, end));

    readouts.push({
      label,
      expectedReturnToSelf,
      destroysSelf: destroysRoot(reading, 'self'),
      outcomes: reading.outcomes,
    });
  }
  return readouts;
}

/**
 * その分岐が終わったとき、端まで来ていた自分の値がいくつになっているか。**増減は端からの差、代入は
 * そのものが行き先**——端は分岐が始まる時点の値そのものなので、`add`で足して戻すのも`set`で書き戻す
 * のも1つの値に均せる。
 *
 * **分岐に残る増減は、最後の代入より後のものだけ**（StepOutcome）なので、代入を土台にしてそれを
 * 重ねればよい。代入が複数あれば後のものを採る（SetEffect.applyと同じ後勝ち）。**静的に解けない代入は
 * 行き先を持たない**（PropertyAssignment）ので、端に留まったものとして数える。
 */
function selfValueAfter(propertyDef: PropertyDef, outcome: StepOutcome, end: number): number {
  let value = end;
  for (const assignment of outcome.assignments)
    if (assignment.target === 'self' && assignment.propertyGlobalId === propertyDef.globalId)
      value = assignment.value ?? end;
  for (const delta of outcome.deltas)
    if (delta.target === 'self' && delta.propertyGlobalId === propertyDef.globalId) value += delta.amount;
  return value;
}

/**
 * その値がvalueになったとき、rangeの外へ出るなら、そこで起こること。範囲に収まるならundefined。
 *
 * **一撃で端まで動かす効果も、range系イベントの引き金になる**（6.3節）。仕留めの一撃は血を0に
 * するだけで、獲物を死体へ置き換えるのは`blood`の`on_min`——これを繋がないと、死体の
 * 作り方がどこにも無いことになる。
 */
export function rangeEventAt(
  propertyDef: PropertyDef,
  value: number,
  resolve: EndBoundValueResolver,
): RangeEventReadout | undefined {
  // どちらの端に達したかはプロパティ自身が答える（PropertyDef.rangeEventLabelsAt）。ここが読むのは、
  // その端で何が起こるかだけ。
  const label = propertyDef.rangeEventLabelsAt(value).at(0);
  if (label === undefined) return undefined;
  return rangeEventReadouts(propertyDef, resolve).find((readout) => readout.label === label);
}

/**
 * 値がtick毎にperTickずつ動いたとき、rangeの端へ届くまでのtick数。端まで届かない向きへ動く場合と、
 * rangeを持たない場合、初期値が読めない場合はundefined（range系イベントが発火するのは端へ届いた
 * 瞬間、6.3節）。
 */
export function ticksToRangeEnd(
  propertyDef: PropertyDef,
  value: number | undefined,
  perTick: number,
): number | undefined {
  const range = propertyDef.range;
  if (range === undefined || value === undefined) return undefined;

  // 向かう先を増減の向きから引くのはプロパティ自身（PropertyDef.endMovedToward）。向かう先が無い
  // ＝値が動かないなら、端へ届くこともない。
  const label = endMovedToward(perTick);
  if (label === undefined) return undefined;

  const distance = range.inwardFrom(label, value);
  return distance <= 0 ? undefined : distance / Math.abs(perTick);
}
