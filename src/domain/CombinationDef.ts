import type { WorldObject } from './WorldObject';
import type { WorldSession } from './WorldSession';
import type { ActiveEffect } from './ActiveEffect';
import type { InteractionTriggerReading } from './InteractionDef';
import { InteractionDef } from './InteractionDef';
import type { ObjectDef } from './ObjectDef';
import type { WeightSpec } from './PickEffect';
import type { Requirements } from './Requirement';
import type { TypeMatchRule } from './TypeMatchRule';

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
   * draggedたちを先頭から順に重ねたとき、続けて実行できる個数。効果が数を答えられなければ1で、
   * まとめてよいと宣言していなければ（allow_multiple）、数えられても1までにする。
   *
   * **0は「重ねても何も起きない」ではなく「起こしてはいけない」。** 器へ入らないまま相手を消す効果
   * （満杯の炉へ薪をくべる）が、黙って薪だけ失う結果になるのを防ぐ。
   */
  acceptedCount(
    self: WorldObject,
    candidates: readonly WorldObject[],
    actor: WorldObject | undefined,
  ): number {
    const counted = this.effect.acceptedCount(self, candidates, actor);
    return counted === undefined ? 1 : this.allowMultiple ? counted : Math.min(1, counted);
  }

  get triggerReading(): InteractionTriggerReading {
    return { kind: 'drag', with: this.with.reading };
  }

  /** draggedDefをこの組み合わせの相手にできるか（withに当てはまるか、12.1節）。 */
  acceptsDragged(draggedDef: ObjectDef): boolean {
    return this.with.matches(draggedDef);
  }

  /**
   * 相手の型も実行の時点で引き直す。候補に選ばれてから落とされるまでに、相手が別の型になっている
   * ことがある（`become`、9.9節）——基底が要件を引き直すのと同じ理由。
   */
  override execute(
    self: WorldObject,
    actor: WorldObject | undefined,
    dragged: WorldObject | undefined,
    session: WorldSession,
  ): boolean {
    if (dragged === undefined || !this.acceptsDragged(dragged.def)) return false;
    return super.execute(self, actor, dragged, session);
  }
}
