import type { ConditionOp } from '../domain/ConditionReader';
import type { SymbolGlobalId } from '../domain/GlobalId';
import type { WorldCodex } from '../domain/WorldCodex';
import type { PropertyComparison } from './tickDeltas';

/**
 * 物の居る場所の空のうち、tick毎の増減が見ているもの（`docs/engine/LiquidContainerSystem.md` 6・7節、
 * `docs/engine/FireSystem.md` 8.2節）。
 */
export interface SkyState {
  /** この世界が宣言していない天候（実測の表にだけ在る名前）なら undefined。 */
  readonly weatherSymbolId: SymbolGlobalId | undefined;

  /** 物の居る場所へ届いている明るさ。天候と太陽高度と、その場所の樹冠・反射を畳んだ値。 */
  readonly ambientBrightness: number;

  /**
   * その場所が名乗る屋根（`sheltered`、ContainerSystem.md 6節）。**数える側が必ず決める**——
   * 決めずに素通しすると、屋根の下の場所を数えながら野ざらしの増減まで効いていることになる
   * （浅い洞窟で雨に消えない松明が、消えるものとして数えられた）。開けた場所は0。
   */
  readonly sheltered: number;
}

/**
 * その増減へ祖先（＝置かれている場所）が課している比較が、この空のもとで成立するか。
 *
 * **判定するのは天候と明るさと屋根で、それ以外の比較は素通しする。**
 *
 * **降雨と蒸発と明かりが同じ判定を通る。** 別々に持つと、条件の読み方が1つにだけ足されたときに、量の
 * 食い違いがどれの誤りなのか決まらない。
 */
export function ancestorConditionsHold(
  codex: WorldCodex,
  conditions: readonly PropertyComparison[],
  sky: SkyState,
): boolean {
  const { world } = codex.vocabulary;
  const shelteredId = codex.propertyNames.tryGetId('sheltered');
  return conditions.every((condition) => {
    if (condition.propertyGlobalId === world.weatherId)
      return sky.weatherSymbolId === undefined
        ? holdsWithoutSymbol(condition.op)
        : comparisonHolds(condition.op, sky.weatherSymbolId, condition.values);
    if (condition.propertyGlobalId === world.ambientBrightnessId)
      return comparisonHolds(condition.op, sky.ambientBrightness, condition.values);
    if (condition.propertyGlobalId === shelteredId)
      return comparisonHolds(condition.op, sky.sheltered, condition.values);
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
