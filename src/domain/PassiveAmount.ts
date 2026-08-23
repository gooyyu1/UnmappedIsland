import type { WorldObject } from './WorldObject';

/** 寄与する量の宣言（PassiveAmount.reading）。 */
export type AmountReading =
  | { readonly kind: 'fixed'; readonly value: number }
  | { readonly kind: 'product'; readonly factorPropertyGlobalIds: readonly number[] };

/**
 * 持続効果が寄与する量（GameElementDefinition.md 8.3節）。
 *
 * 定数と、**宣言元自身のプロパティの実効値の積**の2つ。YAMLが書けるのは定数だけで、積を使うのは
 * エンジンが生やす中身の重さの伝播（[`ContainerSystem.md`](../../docs/engine/ContainerSystem.md)
 * 1〜2節）だけ。伝播を寄与の登録と同じ経路に乗せるために、量のほうを差し替えられるようにしてある。
 */
export abstract class PassiveAmount {
  /** declarerの今の状態で寄与する量。ゲートの判定は呼び出し側（PropertyPassiveEffect）が行う。 */
  abstract amountFor(declarer: WorldObject): number;

  /** この量の宣言そのもの（読み上げ・解析用）。 */
  abstract get reading(): AmountReading;
}

/** YAMLに書かれた定数の量。 */
export class FixedAmount extends PassiveAmount {
  private readonly value: number;

  constructor(value: number) {
    super();
    this.value = value;
  }

  amountFor(): number {
    return this.value;
  }

  get reading(): AmountReading {
    return { kind: 'fixed', value: this.value };
  }
}

/**
 * 宣言元自身のプロパティの実効値の積。
 *
 * **名指しするのは宣言元が実際に持つプロパティだけ**——持たないものは因子に並べない。そのため
 * 「宣言されていない因子は1」という規約が要らず、因子を1つ足す／足さないの判断は、この宣言を
 * 組み立てる側（containerPropagation）だけが持つ。
 */
export class ProductAmount extends PassiveAmount {
  private readonly factorPropertyGlobalIds: readonly number[];

  constructor(factorPropertyGlobalIds: readonly number[]) {
    super();
    this.factorPropertyGlobalIds = factorPropertyGlobalIds;
  }

  amountFor(declarer: WorldObject): number {
    let product = 1;
    // 因子は宣言元自身のObjectDefから採ったものなので、必ず持っている。
    for (const globalId of this.factorPropertyGlobalIds)
      product *= declarer.tryGetProperty(globalId)?.getEffectiveValue() ?? 0;
    return product;
  }

  get reading(): AmountReading {
    return { kind: 'product', factorPropertyGlobalIds: this.factorPropertyGlobalIds };
  }
}
