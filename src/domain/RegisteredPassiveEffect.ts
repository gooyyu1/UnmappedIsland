import type { PropertyPassiveEffect } from './PassiveEffect';
import type { WorldObject } from './WorldObject';

/**
 * 登録済みの効果1件。target(self/parent/child)・kind(modify/add)を問わず同じ形で持つ。
 *
 * - declarer: この効果を宣言したオブジェクト。WhenOwnStageゲートはこれ自身の該当プロパティを見る
 * - slotBearer: 親子関係で「子」側にあたるオブジェクト。conditionsゲートのselfはこれを指す
 *
 * self対象ならdeclarer === slotBearer === 登録先の自分自身、parent対象（子→親）なら両方とも子、child対象
 * （親→子）ならdeclarerが親・slotBearerが子。この2つを登録時に確定させることで、読み取り側
 * (PropertyValue.getEffectiveValue/tick)はtargetの種類を区別せずに済む。
 */
export class RegisteredPassiveEffect {
  /**
   * この効果を宣言したオブジェクト。解除時の同定と、「このプロパティに何が効いているか」のUI表示
   * （PropertyValue.registeredContributions）のため公開する。
   */
  readonly declarer: WorldObject;

  private readonly slotBearer: WorldObject;
  private readonly def: PropertyPassiveEffect;

  constructor(declarer: WorldObject, slotBearer: WorldObject, def: PropertyPassiveEffect) {
    this.declarer = declarer;
    this.slotBearer = slotBearer;
    this.def = def;
  }

  /** この効果が現在寄与している量。ゲート（8.2節）が有効ならAmount、無効なら0。 */
  activeAmount(): number {
    return this.def.activeAmount(this.declarer, this.slotBearer);
  }
}
