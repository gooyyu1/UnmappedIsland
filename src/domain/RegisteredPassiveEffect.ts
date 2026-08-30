import type { PropertyPassiveEffect } from './PassiveEffect';
import type { WorldObject } from './WorldObject';

/**
 * 登録済みの効果1件。targetの起点・kind(modify/add)を問わず同じ形で持つ（対象に書ける起点は
 * GameElementDefinition.md 14.1節の表が唯一の一覧。操作の関係の役は11.5節「役を書ける場所」）。
 *
 * - declarer: この効果を宣言したオブジェクト。WhenOwnStageゲートはこれ自身の該当プロパティを見る
 * - slotBearer: 親子の連なりで下位（子・子孫）側にあたるオブジェクト。conditionsゲートのselfはこれを指す
 *
 * self対象ならdeclarer === slotBearer === 登録先の自分自身、parent対象（子→親）なら両方とも子、
 * ancestor対象（子孫→祖先、8.6節）なら両方とも子孫、child対象（親→子）ならdeclarerが親・slotBearerが子。
 * この2つを登録時に確定させることで、読み取り側(PropertyValue.getEffectiveValue/tick)はtargetの種類を
 * 区別せずに済む。
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
