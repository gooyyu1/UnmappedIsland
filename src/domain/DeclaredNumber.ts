import type { DeclaredNumberReading } from './EffectReader';
import type { PropertyPath, ReferenceContext } from './ReferenceRoot';

/**
 * 宣言に書かれた1つの数値（GameElementDefinition.md 10.2節）。リテラル定数か、既存propsへのパス参照の
 * いずれかで、後者は使うときの文脈（self/actor/dragged）で解く。
 *
 * pickのweightだけでなく、行動・組み合わせ・レシピの所要時間、スロットの`put_in`の所要時間も
 * これで表す——**「その場で決まる数値」という点で同じもの**で、何を表す数値かは持ち主の側が決める。
 */
export class DeclaredNumber {
  private readonly isPathRef: boolean;
  private readonly literal: number;
  private readonly path: PropertyPath | undefined;

  private constructor(isPathRef: boolean, literal: number, path: PropertyPath | undefined) {
    this.isPathRef = isPathRef;
    this.literal = literal;
    this.path = path;
  }

  static ofLiteral(literal: number): DeclaredNumber {
    return new DeclaredNumber(false, literal, undefined);
  }

  static ofPath(path: PropertyPath): DeclaredNumber {
    return new DeclaredNumber(true, 0, path);
  }

  /** 参照が解決できなければ0（宣言はされているので、値が無いこととは区別しない）。 */
  resolveOrZero(context: ReferenceContext): number {
    return this.isPathRef ? (this.path!.effectiveNumber(context) ?? 0) : this.literal;
  }

  /** この値の宣言そのもの（DeclaredNumberReading参照）。数値へ解くのは、文脈を知っている読み手の側。 */
  get reading(): DeclaredNumberReading {
    if (!this.isPathRef) return { kind: 'literal', value: this.literal };
    const path = this.path!;
    return { kind: 'property', subject: path.root, propertyGlobalId: path.propertyGlobalId };
  }
}
