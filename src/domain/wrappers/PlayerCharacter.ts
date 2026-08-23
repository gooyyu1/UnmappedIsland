import { ObjectWrapper } from './ObjectWrapper';
import type { SlotPosition } from '../SlotPosition';
import type { WorldObject } from '../WorldObject';
import { Ending } from './Ending';
import { Location } from './Location';

/**
 * actor（プレイヤーキャラクター、GameElementDefinition.md 8.1節・11節）に対する、UI/ゲームロジック向けの型付き
 * ビュー。Worldと同じ理由で継承ではなくラップにしている。
 *
 * どのプロパティを持つべきかはまだ確定していないため、既存のサンプルに登場済みのものだけを実装している。
 */
export class PlayerCharacter extends ObjectWrapper {
  get handSlotId(): number {
    return this.words.handSlotId;
  }

  get equipmentSlotId(): number {
    return this.words.equipmentSlotId;
  }

  get injuriesSlotId(): number {
    return this.words.injuriesSlotId;
  }

  get hp(): number {
    return this.numberOf(this.words.hpId);
  }

  get satiety(): number {
    return this.numberOf(this.words.satietyId);
  }

  /**
   * 手持ちスロットの各セルの中身（空きセルは空配列、先頭が代表）。固定枠スロットのため、
   * 配列長は常にcellCountと等しく、位置＝添字が安定する（SlotSystem.md 3節）。
   * スロット自体を持たないcodexでは空配列。
   */
  get handStacks(): readonly (readonly WorldObject[])[] {
    const slot = this.instance.tryGetSlot(this.handSlotId);
    return slot === undefined ? [] : slot.cells.map((cell) => cell.stack?.members ?? []);
  }

  /** 装備スロットの中身を、積み重なっているまとまりごとに分けたもの（前詰めなので空きセルは無い）。 */
  get equipmentStacks(): readonly (readonly WorldObject[])[] {
    return this.stacksOf(this.equipmentSlotId);
  }

  /** 怪我スロットの中身を、積み重なっているまとまりごとに分けたもの。 */
  get injuryStacks(): readonly (readonly WorldObject[])[] {
    return this.stacksOf(this.injuriesSlotId);
  }

  /** 手持ちスロットの各セルの代表インスタンス（空きセルはundefined）。 */
  get hand(): readonly (WorldObject | undefined)[] {
    return this.handStacks.map((stack) => stack.at(0));
  }

  /**
   * アイテムを手持ちスロットへ入れる。手持ちが受け入れられなければ（枠の型・枠数の上限）false。
   *
   * atは枠の中の位置（SlotPosition）。隙間を指せばその位置へ既存の枠を押し出して入れ、空き枠を指せば
   * その枠へ入る（埋まっていればfalse）。省略すると最初の空き枠へ入る。
   */
  take(item: WorldObject, at?: SlotPosition): boolean {
    return item.moveToSlot(this.instance.getSlot(this.handSlotId), at) === undefined;
  }

  /** この周回の決着（Ending参照）。 */
  get ending(): Ending {
    return new Ending(this.instance, this.codex);
  }

  /** 今いる土地（自分が入っているcharactersスロットの持ち主）。未配置ならundefined。 */
  get location(): Location | undefined {
    const parent = this.instance.parent;
    return parent === undefined ? undefined : new Location(parent, this.codex);
  }

  /**
   * 今いる土地を1回探索する（Location.explore）。土地に居ない・探索できない土地ならfalse。
   * 「自分をactorとして自分の居場所へ渡す」手順を呼び出し側に持たせないための入口。
   */
  explore(): boolean {
    return this.location?.explore(this.instance) ?? false;
  }
}
