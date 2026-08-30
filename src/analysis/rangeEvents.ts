import type { PropertyDef, RangeEventLabel } from '../domain/PropertyDef';
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
 * **戻り量は、発火した端からrangeの内側へ動いた距離**——`on_min`なら上へ、`on_max`なら下へ動いた
 * ぶんを、どちらの端でも正で測る。**両端を同じ向きで測るのは、周期（rangeCycles）が端によって
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
  const readouts: RangeEventReadout[] = [];
  for (const [label, effect] of propertyDef.rangeEvents()) {
    const reading = readEffect(effect, resolve);
    // 端の値が無ければ戻り量は測れない（rangeを持たないプロパティ）。
    const end = range === undefined ? undefined : label === 'on_min' ? range.min : range.max;
    let expectedReturnToSelf = 0;
    if (end !== undefined)
      for (const outcome of reading.outcomes) {
        const after = selfValueAfter(propertyDef, outcome, end);
        expectedReturnToSelf += outcome.probability * (label === 'on_min' ? after - end : end - after);
      }

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
 * そのものが行き先**（craftingSteps.selfPropertyValuesAfterOfと同じ均し方）。
 *
 * 代入と増減の宣言順は分岐に残らない（StepOutcome）ので、代入を土台にして増減を重ねる
 * ——端から戻す宣言は`set`で行き先を書いてから細かい増減を足す形になる。**静的に解けない代入は
 * 分岐に載らない**（PropertyAssignment）ので、その戻り量は端に留まったものとして数えられる。
 */
function selfValueAfter(propertyDef: PropertyDef, outcome: StepOutcome, end: number): number {
  let value = end;
  for (const assignment of outcome.assignments)
    if (assignment.target === 'self' && assignment.propertyGlobalId === propertyDef.globalId)
      value = assignment.value;
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
  if (range === undefined || perTick === 0 || value === undefined) return undefined;

  const distance = perTick < 0 ? value - range.min : range.max - value;
  return distance <= 0 ? undefined : distance / Math.abs(perTick);
}
