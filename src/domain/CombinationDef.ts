import type { WorldObject } from './WorldObject';
import type { WorldSession } from './WorldSession';
import type { ActiveEffect } from './ActiveEffect';
import type { DefNames, DescriptionWriter } from './Description';
import { text } from './Description';
import { InteractionDef } from './InteractionDef';
import type { ObjectDef } from './ObjectDef';
import type { WeightSpec } from './PickEffect';
import type { Requirement, Requirements } from './Requirement';
import type { TypeMatchReading, TypeMatchRule } from './TypeMatchRule';

/**
 * ドラッグ型のカード間相互作用（GameElementDefinition.md 12節）。素材側のobject_defに1つだけ定義し、
 * 宣言している側がself・相手がdraggedになる（どちらの札を掴んでも同じ宣言が実行される、12.3節）。
 * withは、相手とのマッチング条件（タグかobject_defのid、12.1節）。
 */
export class CombinationDef extends InteractionDef {
  /** 相手とのマッチング条件（12.1節）。 */
  readonly with: TypeMatchRule;

  /**
   * まとめて重ねてよいか（`allow_multiple`、12.4節）。**構造として何個受け取れるかとは別の宣言**——
   * 器が答えられても、まとめて実行させたくない操作はある（時間のかかる操作を止める手段がプレイヤーに
   * 無いため）。既定はfalseで、1枚ずつ。
   */
  private readonly allowMultiple: boolean;

  constructor(
    name: string,
    withRule: TypeMatchRule,
    requirements: Requirements | undefined,
    effect: ActiveEffect,
    duration?: WeightSpec,
    allowMultiple = false,
  ) {
    super(name, requirements, effect, duration);
    this.with = withRule;
    this.allowMultiple = allowMultiple;
  }

  /**
   * draggedたちを先頭から順に重ねたとき、続けて実行できる個数。まとめてよいと宣言していなければ1で、
   * 宣言していても効果が数を答えられなければ1。
   */
  acceptedCount(
    self: WorldObject,
    candidates: readonly WorldObject[],
    actor: WorldObject | undefined,
  ): number {
    if (!this.allowMultiple) return 1;
    return Math.max(1, this.acceptedCountOf(self, candidates, actor) ?? 1);
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

  /** 今この組み合わせを実行できない理由（最初に落ちた要件、14節）。実行できるならundefined。 */
  unmetRequirement(
    self: WorldObject,
    dragged: WorldObject,
    actor: WorldObject | undefined,
  ): Requirement | undefined {
    return this.firstUnmetRequirement(self, dragged, actor);
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
