import type { WorldObject } from './WorldObject';
import type { WeightReading } from './EffectReader';
import { resolveReferenceRoot } from './ReferenceRoot';
import type { PropertyPath } from './ReferenceRoot';

/**
 * 宣言に書かれた1つの数値（GameElementDefinition.md 10.2節）。リテラル定数か、既存propsへのパス参照の
 * いずれかで、後者は使うときの文脈（self/actor/dragged）で解く。
 *
 * pickのweightだけでなく、行動・組み合わせ・レシピの所要時間、スロットの`put_in`の所要時間も
 * これで表す——**「その場で決まる数値」という点で同じもの**で、何を表す数値かは持ち主の側が決める。
 */
export class WeightSpec {
  private readonly isPathRef: boolean;
  private readonly literal: number;
  private readonly path: PropertyPath | undefined;

  private constructor(isPathRef: boolean, literal: number, path: PropertyPath | undefined) {
    this.isPathRef = isPathRef;
    this.literal = literal;
    this.path = path;
  }

  static ofLiteral(literal: number): WeightSpec {
    return new WeightSpec(false, literal, undefined);
  }

  static ofPath(path: PropertyPath): WeightSpec {
    return new WeightSpec(true, 0, path);
  }

  resolve(self: WorldObject, actor: WorldObject | undefined, dragged: WorldObject | undefined): number {
    if (!this.isPathRef) return this.literal;

    const path = this.path!;
    const target =
      path.root === 'ancestor'
        ? self.findAncestorWithProperty(path.propertyGlobalId)
        : resolveReferenceRoot(path.root, self, actor, dragged);
    return target !== undefined
      ? (target.tryGetProperty(path.propertyGlobalId)?.getEffectiveValue() ?? 0)
      : 0;
  }

  /** この値の宣言そのもの（WeightReading参照）。数値へ解くのは、文脈を知っている読み手の側。 */
  get reading(): WeightReading {
    if (!this.isPathRef) return { kind: 'literal', value: this.literal };
    const path = this.path!;
    return { kind: 'property', subject: path.root, propertyGlobalId: path.propertyGlobalId };
  }
}
