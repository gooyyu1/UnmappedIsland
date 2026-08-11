import type { WorldObject } from '../runtime/WorldObject';
import type { DefNames, DescriptionWriter } from './Description';
import type { PassiveEffect } from './PassiveEffect';
import type { ReferenceRoot } from './ReferenceRoot';

/**
 * 1つの ObjectDef が宣言する持続効果（8節）の一式。target・kindを問わず1つにまとめて持ち、
 * 要素リストは公開せず、登録/解除の一括依頼（registerRelation/registerChild）だけを受ける。
 */
export class PassiveEffects {
  private readonly effects: readonly PassiveEffect[];

  constructor(effects: readonly PassiveEffect[]) {
    this.effects = effects;
  }

  /** owner自身から辿れる関係（self/parent/ancestor）が変わった契機を全effectへ伝える
   * （PassiveEffect.registerRelation参照）。 */
  registerRelation(owner: WorldObject, relation: ReferenceRoot, register: boolean): void {
    for (const effect of this.effects) effect.registerRelation(owner, relation, register);
  }

  /** childがowner（親）に付く/離れる契機を全effectへ伝える（target=childのものだけが反応する）。 */
  registerChild(owner: WorldObject, child: WorldObject, register: boolean): void {
    for (const effect of this.effects) effect.registerChild(owner, child, register);
  }

  /** すべての効果を宣言順に書き出す（Description参照）。 */
  describe(names: DefNames, out: DescriptionWriter): void {
    for (const effect of this.effects) effect.describe(names, out);
  }

  /** propertyGlobalIdを書き換えうる効果だけを書き出す（引数の意味はPassiveEffect.affects）。 */
  describeAffecting(
    propertyGlobalId: number,
    ownedByDeclarer: boolean,
    names: DefNames,
    out: DescriptionWriter,
  ): void {
    for (const effect of this.effects)
      if (effect.affects(propertyGlobalId, ownedByDeclarer)) effect.describe(names, out);
  }
}
