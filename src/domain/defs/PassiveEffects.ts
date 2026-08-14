import type { PropertyValue } from '../runtime/PropertyValue';
import type { WorldObject } from '../runtime/WorldObject';
import type { WorldSession } from '../runtime/WorldSession';
import type { DefNames, DescriptionWriter } from './Description';
import type { PassiveEffect, PlannedTransfer, TransferPassiveEffect } from './PassiveEffect';
import type { ReferenceRoot } from './ReferenceRoot';

/**
 * 1つの ObjectDef が宣言する持続効果（8節）の一式。target・kindを問わず1つにまとめて持ち、
 * 要素リストは公開せず、登録/解除の一括依頼（registerRelation/registerChild）だけを受ける。
 */
export class PassiveEffects {
  private readonly effects: readonly PassiveEffect[];

  /** そのうちtick毎に走る輸送（登録では効かないので、走らせる側が別に持つ）。 */
  private readonly transfers: readonly TransferPassiveEffect[];

  constructor(effects: readonly PassiveEffect[]) {
    this.effects = effects;
    this.transfers = effects.flatMap((effect) =>
      effect.tickTransfer === undefined ? [] : [effect.tickTransfer],
    );
  }

  /**
   * このオブジェクトが宣言する輸送（8.4節の `transfer`）を1 tick分走らせる。
   *
   * **全件を決めてから、まとめて動かす。** 決める段では互いの到着が見えないので、同じ物を運ぶ輸送を
   * 並べても1 tickで連鎖しない（胃→腸→蓄えは、1 tickにつき1段ずつ進む）。一方で**出した量は帳簿に
   * 残す**ので、同じ値から出す輸送が複数あっても二重には動かない。
   */
  applyTickTransfers(owner: WorldObject, session: WorldSession): void {
    if (this.transfers.length === 0) return;

    const takenOut = new Map<PropertyValue, number>();
    const putIn = new Map<PropertyValue, number>();
    const planned: PlannedTransfer[] = [];
    for (const transfer of this.transfers) {
      const plan = transfer.planTick(
        owner,
        (value) => takenOut.get(value) ?? 0,
        (value) => putIn.get(value) ?? 0,
      );
      if (plan === undefined) continue;

      takenOut.set(plan.ends.fromValue, (takenOut.get(plan.ends.fromValue) ?? 0) + plan.taken);
      putIn.set(plan.ends.toValue, (putIn.get(plan.ends.toValue) ?? 0) + plan.given);
      planned.push(plan);
    }

    for (const plan of planned)
      plan.effect.applyTake(plan.ends, plan.taken, owner, session, undefined, undefined);
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
