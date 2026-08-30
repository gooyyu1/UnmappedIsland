import type { InfluenceWriter } from './PropertyInfluence';
import type { WorldObject } from './WorldObject';
import type { PassiveEffect, TransferPassiveEffect } from './PassiveEffect';
import type { ReferenceRoot } from './ReferenceRoot';

/**
 * 1つの ObjectDef が宣言する持続効果（8節）の一式。target・kindを問わず宣言順に1つへまとめて持つ。
 *
 * **受け取った契機はそのまま全effectへ配り、どれが反応するかは効果自身が決める。** だから契機を伝える
 * 側は、宣言のtargetもkindも見ずに「こうなった」とだけ言えばよい。
 *
 * **寄与として登録できない輸送（8.4節）だけが別。** 登録が無い以上こちらが走らせるしかなく、走らせる
 * 時点（積分の後、WorldObject.tick）が意味を持つので、そこは「こうなった」ではなく「いま走らせろ」を
 * 受ける——呼ぶ側がその時点を知っている。
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
  applyTickTransfers(owner: WorldObject): void {
    for (const transfer of this.transfers) transfer.applyTick(owner);
  }

  /** 相手がownerから一意に辿れる関係が変わった契機を全effectへ伝える
   * （PassiveEffect.setRelationRegistered参照。childだけは相手が定まらずsetChildRegisteredが持つ）。 */
  setRelationRegistered(owner: WorldObject, relation: ReferenceRoot, register: boolean): void {
    for (const effect of this.effects) effect.setRelationRegistered(owner, relation, register);
  }

  /** childがowner（親）に付く/離れる契機を全effectへ伝える（target=childのものだけが反応する）。 */
  setChildRegistered(owner: WorldObject, child: WorldObject, register: boolean): void {
    for (const effect of this.effects) effect.setChildRegistered(owner, child, register);
  }

  /** 宣言されている持続効果を宣言順に挙げる（読み上げは効果自身が答える、PassiveReader参照）。 */
  get declarations(): readonly PassiveEffect[] {
    return this.effects;
  }

  /** すべての効果が持つ影響の辺を書き出す（PassiveEffect.collectInfluences参照）。 */
  collectInfluences(declarer: WorldObject, out: InfluenceWriter): void {
    for (const effect of this.effects) effect.collectInfluences(declarer, out);
  }
}
