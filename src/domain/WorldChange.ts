import type { Slot } from './Slot';
import type { WorldObject } from './WorldObject';

/**
 * 世界の形が変わった1件（`WorldSession.observeChanges`）。
 *
 * **記録するのは物の出入りだけで、値の増減は含まない。** 画面に出る値は実効値（modify・inheritを
 * 加味した値、8.3節）で、実体値を誰も書かないまま動きうる——包帯を当てると痛みは下がるが、痛みの
 * 実体値は0のままで、押し上げていた寄与が減るだけ。書き込みを記録しても現れないので、値は前後の
 * 比較で見る（`statusChangesBetween`）。
 *
 * 出入りの側は逆に、前後の比較では足りない。同じtickに2匹が暴れれば「どちらが壊したか」は差分から
 * 決められず、持ち去られた物は画面から消えるだけで壊された物と同じ形に見える。
 */
export interface WorldChange {
  /** 動いた（生まれた・移った・世界から出た）オブジェクト。 */
  readonly object: WorldObject;

  /**
   * この変化を起こした効果を宣言していたオブジェクト（`applyActiveEffect`のself）。**演出で動かす札**が
   * これになる——サルの手番なら常にサル、ヤシの実を割ったならその実。
   *
   * プレイヤーの操作がワールドを直に動かした場合（カードのドラッグ、シナリオの開始状態）はundefined。
   * 世界の側に主体が居ないという意味で、UI側は自分が起点だと知っている。
   */
  readonly subject: WorldObject | undefined;

  /** 直前に入っていた枠。undefinedは「それまで世界の中に無かった」＝生まれたということ。 */
  readonly from: Slot | undefined;

  /** 移った先の枠。undefinedは「世界の中から出た」＝壊れた・外れたということ。 */
  readonly to: Slot | undefined;
}
