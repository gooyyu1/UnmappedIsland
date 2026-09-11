import type { PropertyPassiveEffect } from './PassiveEffect';
import type { WorldObject } from './WorldObject';
import { ReferenceContext } from './ReferenceRoot';

/**
 * 登録済みの効果1件。targetの起点・kind(modify/add)を問わず同じ形で持つ（対象に書ける起点は
 * GameElementDefinition.md 14.1節の表が唯一の一覧。操作の関係の役は11.5節「役を書ける場所」）。
 *
 * - declarer: この効果を宣言したオブジェクト。WhenOwnStageゲートはこれ自身の該当プロパティを見る
 * - slotBearer: 親子の連なりで下位（子・子孫）側にあたるオブジェクト。conditionsゲートのselfはこれを指す
 *
 * self対象ならdeclarer === slotBearer === 登録先の自分自身、parent対象（子→親）なら両方とも子、
 * ancestor対象（子孫→祖先、8.6節）なら両方とも子孫、child対象（親→子）ならdeclarerが親・slotBearerが子。
 * これらを登録時に確定させることで、読み取り側(PropertyValue.getEffectiveValue/tick)はtargetの種類を
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

  /**
   * ゲート（8.2節）の役（11.5節）を答える文脈。**持つのは操作が宣言した持続効果（11.7節）だけ**
   * ——役を答えるのは宣言したその操作の関係で、宣言元が経過中に別の関係へも加わっても動かない
   * （押す先を登録時に確定させるのと同じ理由。WorldSession.whileInteractionPassives）。
   *
   * **物のdefの宣言では持たず、そのつど宣言元の今の参加から解く。** self/parent対象の宣言は参加が
   * 変わっても張り直されないので、憶えると「手番の外で登録された分は、どの手番でもagentを解決しない」
   * になる。
   */
  private readonly interactionRoles: ReferenceContext | undefined;

  constructor(
    declarer: WorldObject,
    slotBearer: WorldObject,
    def: PropertyPassiveEffect,
    interactionRoles: ReferenceContext | undefined,
  ) {
    this.declarer = declarer;
    this.slotBearer = slotBearer;
    this.def = def;
    this.interactionRoles = interactionRoles;
  }

  /**
   * この登録が、declarerの宣言したdefそのものか。**解除は1件ずつ同定する**——同じ宣言元が同じ
   * プロパティへ2件登録していることがある（操作の役が宣言元自身へ解決したとき、11.5節）。
   */
  declaredBy(declarer: WorldObject, def: PropertyPassiveEffect): boolean {
    return this.declarer === declarer && this.def === def;
  }

  /** この効果が現在寄与している量。ゲート（8.2節）が有効ならAmount、無効なら0。 */
  activeAmount(): number {
    return this.def.activeAmount(this.declarer, this.slotBearer, this.gateRoles);
  }

  /** ゲートの役を答える文脈（interactionRolesの決まりで）。selfはゲート自身が差し替える。 */
  private get gateRoles(): ReferenceContext {
    return this.interactionRoles ?? ReferenceContext.forParticipant(this.declarer);
  }
}
