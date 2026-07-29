import type { WorldObject } from '../runtime/WorldObject';
import type { WorldSession } from '../runtime/WorldSession';
import type { ActiveEffect } from './ActiveEffect';
import type { ConditionNode } from './ConditionNode';
import type { ObjectDef } from './ObjectDef';
import type { WeightSpec } from './PickEffect';
import { resolveReferenceRoot } from './ReferenceRoot';
import { spendDuration } from './actionTime';

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

  /**
   * 実行にかかるゲーム内時間（分）。ActionDef.durationと同じ扱いで、参照は{object, prop}
   * （combinationsではdraggedも指せる）。undefinedなら時間を消費しない。
   */
  private readonly duration: WeightSpec | undefined;

  constructor(
    name: string,
    withTagGlobalId: number,
    conditions: ConditionNode | undefined,
    effect: ActiveEffect | undefined,
    duration?: WeightSpec,
  ) {
    this.name = name;
    this.with = withTagGlobalId;
    this.conditions = conditions;
    this.effect = effect;
    this.duration = duration;
  }

  /** draggedDefがこのcombinationのwithタグを持っていれば真（12.1節）。 */
  matches(draggedDef: ObjectDef): boolean {
    return draggedDef.tags.includes(this.with);
  }

  /** この組み合わせにかかるゲーム内時間（分）。扱いはActionDef.minutesForと同じ。 */
  minutesFor(self: WorldObject, dragged: WorldObject, actor: WorldObject | undefined): number {
    return this.duration === undefined ? 0 : Math.trunc(this.duration.resolve(self, actor, dragged));
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

    // 時間進行の順序と、参照durationを進行前に解決する理由はActionDef.tryExecuteと同じ。
    if (!spendDuration(this.minutesFor(self, dragged, actor), session, [self, dragged, actor])) return false;

    if (this.effect !== undefined) self.applyActiveEffect(this.effect, session, actor, dragged);
    return true;
  }
}
