import type { InfluenceWriter } from '../runtime/PropertyInfluence';
import type { WorldObject } from '../runtime/WorldObject';
import type { WorldSession } from '../runtime/WorldSession';
import type { DefNames, DescriptionWriter } from './Description';
import { describePassive, passiveWritesToProperty } from './describePassive';
import type { PassiveEffect, TransferPassiveEffect } from './PassiveEffect';
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
   * **宣言順にそのまま適用し、互いの結果を見る**（activeの命令と同じ、9節）。だから同じ値から出す
   * 輸送を並べても在庫が二重に動くことはなく、直列に繋いだ輸送の緩衝は**速度の差**が作る
   * （上流を速くすれば、その差が中間に溜まる。8.4.1節）。
   */
  applyTickTransfers(owner: WorldObject, session: WorldSession): void {
    for (const transfer of this.transfers) transfer.applyTick(owner, session);
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

  /** 宣言されている持続効果を宣言順に挙げる（読み上げは効果自身が答える、PassiveReader参照）。 */
  get declarations(): readonly PassiveEffect[] {
    return this.effects;
  }

  /** すべての効果が持つ影響の辺を書き出す（PassiveEffect.collectInfluences参照）。 */
  collectInfluences(declarer: WorldObject, out: InfluenceWriter): void {
    for (const effect of this.effects) effect.collectInfluences(declarer, out);
  }

  /** すべての効果を宣言順に書き出す（Description参照）。 */
  describe(names: DefNames, out: DescriptionWriter): void {
    for (const effect of this.effects) describePassive(effect, names, out);
  }

  /** propertyGlobalIdを書き換えうる効果だけを書き出す（引数の意味はPassiveEffect.affects）。 */
  describeAffecting(
    propertyGlobalId: number,
    ownedByDeclarer: boolean,
    names: DefNames,
    out: DescriptionWriter,
  ): void {
    for (const effect of this.effects)
      if (passiveWritesToProperty(effect, propertyGlobalId, ownedByDeclarer))
        describePassive(effect, names, out);
  }
}
