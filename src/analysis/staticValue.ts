import type { WeightReading } from '../domain/defs/EffectReader';
import type { ObjectDef } from '../domain/defs/ObjectDef';
import type { ReferenceRoot } from '../domain/defs/ReferenceRoot';

/**
 * 定義だけから値を解く手立てと、その周りの近似。
 *
 * 実行時のオブジェクトが1つも無い文脈で「この宣言はいくつになるか」を答えるには、**居ない相手の
 * ぶんを何かで埋める**しかない——祖先（置かれている土地）も、重ねる相手（武器）も、生成時の抽選も、
 * 定義の側は答えを持っていない。その埋め方はレポートの都合なので、ここから先はドメインには置かない。
 */

/**
 * ReferenceRootが指すプロパティの値を、**定義だけから**解く手立て。
 *
 * 解けないものはundefinedを返す——祖先が入れる値（inherit）も、重ねる相手の値も、「どの文脈に
 * 置いた場合の数字か」を決めた側にしか答えられない。0を返すと「そう宣言されている」と区別が付かない。
 */
export type StaticValueResolver = (root: ReferenceRoot, propertyGlobalId: number) => number | undefined;

/**
 * defを起点として、定義だけから値を解く手立て。selfは自分のプロパティ宣言が答え、それ以外の起点は
 * outerへ委ねる。
 */
export function staticResolverOf(
  def: ObjectDef,
  outer: StaticValueResolver | undefined,
): StaticValueResolver {
  return (root, propertyGlobalId) => {
    if (root !== 'self') return outer?.(root, propertyGlobalId);
    return declaredValueOf(def, propertyGlobalId, outer);
  };
}

/** defが宣言しているプロパティの、定義だけから読める値。宣言していなければundefined。 */
export function staticValueOf(
  def: ObjectDef,
  propertyGlobalId: number,
  outer?: StaticValueResolver,
): number | undefined {
  return declaredValueOf(def, propertyGlobalId, outer);
}

/**
 * 宣言された初期値。**抽選つきの初期値（`value: {min, max}`）はRNGを使わない生成と同じ扱い**で、
 * 下限がそのまま答えになる（PropertyDef.initialValue）。
 *
 * inheritなら祖先の値も足す（6.5節）。祖先を辿れない文脈ではundefined。
 */
function declaredValueOf(
  def: ObjectDef,
  propertyGlobalId: number,
  outer: StaticValueResolver | undefined,
): number | undefined {
  const propertyDef = def.getPropertyDef(propertyGlobalId);
  if (propertyDef === undefined) return undefined;
  if (!propertyDef.inherit) return propertyDef.initialValue;

  const inherited = outer?.('ancestor', propertyGlobalId);
  return inherited === undefined ? undefined : propertyDef.initialValue + inherited;
}

/** 重み・所要時間の宣言（WeightReading）を数値へ解く。参照が解けなければundefined。 */
export function resolveWeight(reading: WeightReading, resolve: StaticValueResolver): number | undefined {
  return reading.kind === 'literal' ? reading.value : resolve(reading.subject, reading.propertyGlobalId);
}
