import type { InfluenceWriter } from './PropertyInfluence';
import type { WorldObject } from './WorldObject';
import type { PassiveEffect, PropertyPassiveEffect, TransferPassiveEffect } from './PassiveEffect';
import type { PassiveReader } from './PassiveReader';
import type { ReferenceRoot } from './ReferenceRoot';
import type { WorldSession } from './WorldSession';

/** 1つも宣言していない関係の契機で配る先（毎回空の配列を作らずに済ませる）。 */
const NO_REGISTRATIONS: readonly PropertyPassiveEffect[] = [];

/**
 * 1つの ObjectDef が宣言する持続効果（8節）の一式。target・kindを問わず宣言順に1つへまとめて持つ。
 *
 * **受け取った契機は、それを宣言している効果だけへ配る。** どの契機を受け取るかは効果自身が名乗り
 * （PassiveEffect.relationRegistration）、こちらは名乗りのとおりに仕分けて持つ。だから契機を伝える
 * 側は、宣言のtargetもkindも見ずに「こうなった」とだけ言えばよい。
 *
 * **別なのは、輸送を走らせる口（applyTickTransfers）だけ。** 輸送は寄与として登録できない（8.4節）
 * のでこちらが走らせるしかなく、走らせる時点（積分の後、WorldObject.tick）が意味を持つ。そこだけは
 * 「こうなった」ではなく「いま走らせろ」を受け、呼ぶ側がその時点を知っている。
 */
export class PassiveEffects {
  private readonly effects: readonly PassiveEffect[];

  /** そのうちtick毎に走る輸送（登録では効かないので、走らせる側が別に持つ）。 */
  private readonly transfers: readonly TransferPassiveEffect[];

  /**
   * そのうち寄与として登録される効果を、契機になる関係ごとに仕分けたもの。**契機を受け取らない効果まで
   * 回さないため**——役の登録は手番が実行されるたびに起き（WorldObject.joinInteraction）、持続効果を
   * 多く持つ型ほど空振りが積もる。
   */
  private readonly registrationsByRelation: ReadonlyMap<ReferenceRoot, readonly PropertyPassiveEffect[]>;

  constructor(effects: readonly PassiveEffect[]) {
    this.effects = effects;
    this.transfers = effects.flatMap((effect) =>
      effect.tickTransfer === undefined ? [] : [effect.tickTransfer],
    );

    const byRelation = new Map<ReferenceRoot, PropertyPassiveEffect[]>();
    for (const effect of effects) {
      const registration = effect.relationRegistration;
      if (registration === undefined) continue;
      const bucket = byRelation.get(registration.relation) ?? [];
      byRelation.set(registration.relation, bucket);
      bucket.push(registration.effect);
    }
    this.registrationsByRelation = byRelation;
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

  /** 相手がownerから一意に辿れる関係が変わった契機を、その関係を宣言している効果へ伝える
   * （PropertyPassiveEffect.setRelationRegistered参照。childだけは相手が定まらずsetChildRegisteredが持つ）。 */
  setRelationRegistered(owner: WorldObject, relation: ReferenceRoot, register: boolean): void {
    for (const effect of this.registrationsByRelation.get(relation) ?? NO_REGISTRATIONS)
      effect.setRelationRegistered(owner, register);
  }

  /**
   * 宣言している寄与を、関係を問わずまとめて登録/解除する（操作が宣言した持続効果、11.7節）。
   *
   * **物の宣言はここを通らない。** そちらは関係ごとに契機が別々に来る（setRelationRegistered）が、
   * 操作の持続効果は「始まった」「終わった」の1つの契機で全部が同時に動く。
   */
  setAllRegistered(owner: WorldObject, register: boolean): void {
    for (const effects of this.registrationsByRelation.values())
      for (const effect of effects) effect.setRelationRegistered(owner, register);
  }

  /**
   * この一式がこの1 tickで動かす先を、操作の稼ぎを数える対象として名乗る（PropertyGain）。
   *
   * **名乗るのは操作が宣言した一式だけ**（WorldSession.whileInteractionPassives）。物が自分で
   * 宣言した増減は、誰かの操作が増やしたものではない。
   */
  countTickMovementsAsGains(owner: WorldObject, session: WorldSession): void {
    for (const effect of this.effects) effect.countTickMovementAsGain(owner, session);
  }

  /** childがowner（親）に付く/離れる契機を、target=childの効果へ伝える。 */
  setChildRegistered(owner: WorldObject, child: WorldObject, register: boolean): void {
    for (const effect of this.registrationsByRelation.get('child') ?? NO_REGISTRATIONS)
      effect.setChildRegistered(owner, child, register);
  }

  /**
   * この一式が宣言していることを、宣言順にすべて読み上げさせる（PassiveReader参照）。
   *
   * **一式をまるごと読む相手はこちらを呼ぶ。** 宣言を1件ずつ取り出して読ませる形にすると、読み手の
   * 数だけ同じ繰り返しが書き写される。
   */
  read(reader: PassiveReader): void {
    for (const effect of this.effects) effect.read(reader);
  }

  /**
   * 宣言されている持続効果を宣言順に挙げる。**1件ずつを別々に扱う相手だけが呼ぶ**——宣言ごとに絞り込む・
   * 1件につき1つの書き出しを作る・宣言があるかを見る、といったもの。一式をまとめて読むならreadを呼ぶ。
   */
  get declarations(): readonly PassiveEffect[] {
    return this.effects;
  }

  /** すべての効果が持つ影響の辺を書き出す（PassiveEffect.collectInfluences参照）。 */
  collectInfluences(declarer: WorldObject, out: InfluenceWriter): void {
    for (const effect of this.effects) effect.collectInfluences(declarer, out);
  }
}
