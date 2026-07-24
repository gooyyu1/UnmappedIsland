import type { WorldObject } from '../runtime/WorldObject';
import type { WorldSession } from '../runtime/WorldSession';
import type { ActiveEffect } from './ActiveEffect';
import type { ConditionNode } from './ConditionNode';
import type { ObjectDef } from './ObjectDef';
import { resolveReferenceRoot } from './ReferenceRoot';

/**
 * ドラッグ型のカード間相互作用（GameElementDefinition.md 12節）。ドロップされた側（受け側）の
 * object_defに定義する。withは、ドラッグされてきたカードとのマッチング条件（タグのグローバルID、12.1節）。
 */
export class CombinationDef {
  readonly name: string;
  private readonly with: number;

  /** undefinedなら常に真（conditions省略）。 */
  private readonly conditions: ConditionNode | undefined;

  /** 条件成立時に適用する効果。undefinedなら何も起きない。 */
  private readonly effect: ActiveEffect | undefined;

  constructor(
    name: string,
    withTagGlobalId: number,
    conditions: ConditionNode | undefined,
    effect: ActiveEffect | undefined,
  ) {
    this.name = name;
    this.with = withTagGlobalId;
    this.conditions = conditions;
    this.effect = effect;
  }

  /** draggedDefがこのcombinationのwithタグを持っていれば真（12.1節）。 */
  matches(draggedDef: ObjectDef): boolean {
    return draggedDef.tags.includes(this.with);
  }

  tryExecute(
    self: WorldObject,
    dragged: WorldObject,
    actor: WorldObject | undefined,
    session: WorldSession,
  ): boolean {
    if (!this.matches(dragged.def)) return false;
    if (
      this.conditions !== undefined &&
      !this.conditions.evaluate((root) => resolveReferenceRoot(root, self, actor, dragged))
    )
      return false;

    if (this.effect !== undefined) self.applyActiveEffect(this.effect, session, actor, dragged);
    return true;
  }
}
