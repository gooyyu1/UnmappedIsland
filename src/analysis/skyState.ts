import type { ConditionOp } from '../domain/ConditionReader';
import type { SymbolGlobalId } from '../domain/GlobalId';
import type { WorldCodex } from '../domain/WorldCodex';
import type { AncestorCondition } from './tickDeltas';

/**
 * 器の居る場所の空のうち、tick毎の増減が見ているもの（`docs/engine/LiquidContainerSystem.md` 6・7節）。
 *
 * **持つのは2つだけ。** 雨よけ（`sheltered`）のように場所の置き方で決まる条件は、置き方を決めるのが
 * 数える側なので、ここには来ない（{@link ancestorConditionsHold} が素通しする）。
 */
export interface SkyState {
  /** この世界が宣言していない天候（実測の表にだけ在る名前）なら undefined。 */
  readonly weatherSymbolId: SymbolGlobalId | undefined;

  /** 器の居る場所へ届いている明るさ。天候と太陽高度と、その場所の樹冠・反射を畳んだ値。 */
  readonly ambientBrightness: number;
}

/**
 * その増減へ祖先（＝置かれている場所）が課している比較が、この空のもとで成立するか。
 *
 * **判定するのは天候と明るさだけで、それ以外の比較は素通しする。** 数える側が置き方を決める条件
 * （雨よけなど）を偽にすると、その置き方の量が数から丸ごと落ちる。
 *
 * **降雨と蒸発が同じ判定を通る。** 別々に持つと、条件の読み方が片方にだけ足されたときに、量の食い違いが
 * どちらの誤りなのか決まらない。
 */
export function ancestorConditionsHold(
  codex: WorldCodex,
  conditions: readonly AncestorCondition[],
  sky: SkyState,
): boolean {
  const { world } = codex.vocabulary;
  return conditions.every((condition) => {
    if (condition.propertyGlobalId === world.weatherId)
      return sky.weatherSymbolId === undefined
        ? holdsWithoutSymbol(condition.op)
        : comparisonHolds(condition.op, sky.weatherSymbolId, condition.values);
    if (condition.propertyGlobalId === world.ambientBrightnessId)
      return comparisonHolds(condition.op, sky.ambientBrightness, condition.values);
    return true;
  });
}

/**
 * どのシンボルでもない天候のときに、その比較が成立するか。**条件がその天候を名指していることは
 * ありえない**——条件に書いた名前は書いた時点で名前空間へ登録されるので、登録の無い名前は条件の
 * 中にも無い。よって一致（`eq`・`in`）は成立せず、不一致（`neq`・`not_in`）は成立する。
 * シンボルに順序は無いので、大小の比較はどれも成立しない。
 */
function holdsWithoutSymbol(op: ConditionOp): boolean {
  return op === 'neq' || op === 'not_in';
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
