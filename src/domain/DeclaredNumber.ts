import type { DeclaredNumberReading, PropertyRefReading } from './EffectReader';
import type { PropertyPath, ReferenceContext } from './ReferenceRoot';

/**
 * 宣言に書かれた1つの数値（GameElementDefinition.md 10.2節）。リテラル定数か、既存propsへのパス参照、
 * またはパス参照2つの積のいずれかで、参照は使うときの文脈（self/agent/instrument）で解く。
 *
 * pickのweightだけでなく、行動・組み合わせ・レシピの所要時間、スロットの`put_in`の所要時間も
 * これで表す——**「その場で決まる数値」という点で同じもの**で、何を表す数値かは持ち主の側が決める。
 */
export class DeclaredNumber {
  /** リテラルならその値。参照（積を含む）ならundefined。 */
  private readonly literal: number | undefined;

  /** 掛け合わせる参照。リテラルなら空、単一の参照なら1つ、積なら2つ（10.2節）。 */
  private readonly factors: readonly PropertyPath[];

  private constructor(literal: number | undefined, factors: readonly PropertyPath[]) {
    this.literal = literal;
    this.factors = factors;
  }

  static ofLiteral(literal: number): DeclaredNumber {
    return new DeclaredNumber(literal, []);
  }

  static ofPath(path: PropertyPath): DeclaredNumber {
    return new DeclaredNumber(undefined, [path]);
  }

  /** 参照2つの積（10.2節）。積は可換なので、どちらを先に書いたかは値に効かない。 */
  static ofProduct(first: PropertyPath, second: PropertyPath): DeclaredNumber {
    return new DeclaredNumber(undefined, [first, second]);
  }

  /**
   * 参照が解決できなければ0（宣言はされているので、値が無いこととは区別しない）。
   * **積は、片方でも解決できなければ0**——解けた側だけの値を返すと、掛ける相手が居ないことが
   * 「等倍だった」と見分けられなくなる。
   */
  resolveOrZero(context: ReferenceContext): number {
    if (this.literal !== undefined) return this.literal;

    let product = 1;
    for (const factor of this.factors) {
      const value = factor.effectiveNumber(context);
      if (value === undefined) return 0;
      product *= value;
    }
    return product;
  }

  /** この値の宣言そのもの（DeclaredNumberReading参照）。数値へ解くのは、文脈を知っている読み手の側。 */
  get reading(): DeclaredNumberReading {
    if (this.literal !== undefined) return { kind: 'literal', value: this.literal };

    const [first, second] = this.factors;
    return this.factors.length === 1
      ? { kind: 'property', ...refReadingOf(first) }
      : { kind: 'product', factors: [refReadingOf(first), refReadingOf(second)] };
  }
}

function refReadingOf(path: PropertyPath): PropertyRefReading {
  return { subject: path.root, propertyGlobalId: path.propertyGlobalId };
}
