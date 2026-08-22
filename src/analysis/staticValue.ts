import type { WeightReading } from '../domain/EffectReader';
import type { ObjectDef } from '../domain/ObjectDef';
import type { ReferenceRoot } from '../domain/ReferenceRoot';

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
    return staticValueOf(def, propertyGlobalId, outer);
  };
}

/**
 * defが宣言しているプロパティの、定義だけから読める値。宣言していなければundefined。
 *
 * **抽選つきの初期値（`value: {min, max}`）はRNGを使わない生成と同じ扱い**で、下限がそのまま
 * 答えになる（PropertyDef.initialValue）。inheritなら祖先の値も足す（6.5節）。祖先を辿れない
 * 文脈ではundefined。
 */
export function staticValueOf(
  def: ObjectDef,
  propertyGlobalId: number,
  outer?: StaticValueResolver,
): number | undefined {
  const propertyDef = def.getPropertyDef(propertyGlobalId);
  if (propertyDef === undefined) return undefined;
  if (!propertyDef.inherit) return propertyDef.initialValue;

  const inherited = outer?.('ancestor', propertyGlobalId);
  return inherited === undefined ? undefined : propertyDef.initialValue + inherited;
}

/**
 * 解けなかったことを覚える解決器。**印の有効範囲は呼ぶ側が決める**——1つの工程・1つの周期ごとに
 * 作り直さないと、先に読んだものには付かず後に読んだものだけに付く印になる。
 *
 * 印が意味するのは「その工程の所要時間・確率は、定義だけからは確定しない参照を含む」
 * （CraftingStep.hasUnresolvedReferences）。
 */
export function trackingResolverOf(def: ObjectDef, outer: StaticValueResolver | undefined): TrackingResolver {
  const inner = staticResolverOf(def, outer);
  let unresolved = false;
  return {
    resolve: (root, propertyGlobalId) => {
      const value = inner(root, propertyGlobalId);
      if (value === undefined) unresolved = true;
      return value;
    },
    get unresolved() {
      return unresolved;
    },
  };
}

/** 解決器と、そこまでに解けない参照へ当たったかどうか（trackingResolverOf）。 */
export interface TrackingResolver {
  readonly resolve: StaticValueResolver;
  readonly unresolved: boolean;
}

/** 重み・所要時間の宣言（WeightReading）を数値へ解く。参照が解けなければundefined。 */
export function resolveWeight(reading: WeightReading, resolve: StaticValueResolver): number | undefined {
  return reading.kind === 'literal' ? reading.value : resolve(reading.subject, reading.propertyGlobalId);
}
