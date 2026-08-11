import type { WorldObject } from '../runtime/WorldObject';
import type { WorldSession } from '../runtime/WorldSession';
import type { ActiveEffect } from './ActiveEffect';
import type { DefNames, DescriptionWriter } from './Description';
import { tagRef, text } from './Description';
import { InteractionDef } from './InteractionDef';
import type { ObjectDef } from './ObjectDef';
import type { WeightSpec } from './PickEffect';
import type { Requirements } from './Requirement';

/**
 * ドラッグ型のカード間相互作用（GameElementDefinition.md 12節）。ドロップされた側（受け側）の
 * object_defに定義する。withは、ドラッグされてきたカードとのマッチング条件（タグのグローバルID、12.1節）。
 */
export class CombinationDef extends InteractionDef {
  private readonly with: number;

  constructor(
    name: string,
    withTagGlobalId: number,
    requirements: Requirements | undefined,
    effect: ActiveEffect | undefined,
    duration?: WeightSpec,
  ) {
    super(name, requirements, effect, duration);
    this.with = withTagGlobalId;
  }

  protected describeTrigger(names: DefNames, out: DescriptionWriter): void {
    out.write(text('with: '), tagRef(names.tagName(this.with)), text('を持つカードのドロップ'));
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
    return this.matches(dragged.def) && this.apply(self, dragged, actor, session);
  }
}
