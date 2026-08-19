import type { WorldObject } from './WorldObject';
import type { WorldSession } from './WorldSession';
import type { ActiveEffect } from './ActiveEffect';
import type { DefNames, DescriptionWriter } from './Description';
import { text } from './Description';
import { InteractionDef } from './InteractionDef';
import type { ObjectDef } from './ObjectDef';
import type { WeightSpec } from './PickEffect';
import type { Requirements } from './Requirement';
import type { TypeMatchReading, TypeMatchRule } from './TypeMatchRule';

/**
 * ドラッグ型のカード間相互作用（GameElementDefinition.md 12節）。素材側のobject_defに1つだけ定義し、
 * 宣言している側がself・相手がdraggedになる（どちらの札を掴んでも同じ宣言が実行される、12.3節）。
 * withは、相手とのマッチング条件（タグかobject_defのid、12.1節）。
 */
export class CombinationDef extends InteractionDef {
  /** 相手とのマッチング条件（12.1節）。 */
  readonly with: TypeMatchRule;

  constructor(
    name: string,
    withRule: TypeMatchRule,
    requirements: Requirements | undefined,
    effect: ActiveEffect,
    duration?: WeightSpec,
  ) {
    super(name, requirements, effect, duration);
    this.with = withRule;
  }

  protected describeTrigger(names: DefNames, out: DescriptionWriter): void {
    out.write(text('with: '), ...this.with.describe(names), text('のカードのドロップ'));
  }

  override get draggedReading(): TypeMatchReading {
    return this.with.reading;
  }

  /** draggedDefがこのcombinationのwithに当てはまれば真（12.1節）。 */
  matches(draggedDef: ObjectDef): boolean {
    return this.with.matches(draggedDef);
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
