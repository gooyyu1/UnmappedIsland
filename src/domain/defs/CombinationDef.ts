import type { WorldObject } from '../runtime/WorldObject';
import type { WorldSession } from '../runtime/WorldSession';
import type { ActiveEffect } from './ActiveEffect';
import type { CraftingInput } from './CraftingStep';
import type { DefNames, DescriptionWriter } from './Description';
import { tagRef, text } from './Description';
import { InteractionDef } from './InteractionDef';
import type { ObjectDef } from './ObjectDef';
import type { WeightSpec } from './PickEffect';
import type { Requirements } from './Requirement';

/**
 * ドラッグ型のカード間相互作用（GameElementDefinition.md 12節）。素材側のobject_defに1つだけ定義し、
 * 宣言している側がself・相手がdraggedになる（どちらの札を掴んでも同じ宣言が実行される、12.3節）。
 * withは、相手とのマッチング条件（タグのグローバルID、12.1節）。
 */
export class CombinationDef extends InteractionDef {
  private readonly with: number;

  constructor(
    name: string,
    withTagGlobalId: number,
    requirements: Requirements | undefined,
    effect: ActiveEffect,
    duration?: WeightSpec,
  ) {
    super(name, requirements, effect, duration);
    this.with = withTagGlobalId;
  }

  protected describeTrigger(names: DefNames, out: DescriptionWriter): void {
    out.write(text('with: '), tagRef(names.tagName(this.with)), text('を持つカードのドロップ'));
  }

  protected get craftingKind(): 'combination' {
    return 'combination';
  }

  /** ドラッグされてくる相手はタグで指される。消費されるかはdraggedへのdestroyの有無から分かる。 */
  protected override extraCraftingInputs(effect: ActiveEffect): readonly CraftingInput[] {
    return [{ kind: 'tag', tagGlobalId: this.with, consumed: effect.destroys('dragged') }];
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
