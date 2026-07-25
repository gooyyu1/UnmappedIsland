import type { NameRegistry } from '../../defs/NameRegistry';
import type { WorldCodex } from '../../defs/WorldCodex';
import type { WorldObject } from '../WorldObject';
import type { WorldSession } from '../WorldSession';
import { Location } from './Location';

/**
 * actor（プレイヤーキャラクター、GameElementDefinition.md 8.1節・11節）に対する、UI/ゲームロジック向けの型付き
 * ビュー。Worldと同じ理由で継承ではなくラップにしている。
 *
 * どのプロパティを持つべきかはまだ確定していないため、既存のサンプルに登場済みのものだけを実装している。
 */
export class PlayerCharacter {
  readonly instance: WorldObject;

  private readonly codex: WorldCodex;

  private readonly hpId: number;
  private readonly satietyId: number;
  private readonly handSlotId: number;

  constructor(instance: WorldObject, codex: WorldCodex) {
    this.instance = instance;
    this.codex = codex;
    this.hpId = PlayerCharacter.idOrMissing(codex.propertyNames, 'hp');
    this.satietyId = PlayerCharacter.idOrMissing(codex.propertyNames, 'satiety');
    this.handSlotId = PlayerCharacter.idOrMissing(codex.slotNames, 'hand');
  }

  /** 未登録の名前は-1（LocalIndexMap.missing扱い）にする。characters.yamlがこのビューの知る全プロパティ・スロットを持つとは限らないため、「持っていなければ空として読む」姿勢に合わせる。 */
  private static idOrMissing(names: NameRegistry, name: string): number {
    return names.tryGetId(name) ?? -1;
  }

  get hp(): number {
    return this.instance.getEffectiveValue(this.hpId);
  }

  get satiety(): number {
    return this.instance.getEffectiveValue(this.satietyId);
  }

  /**
   * 手持ちスロットの各セルの代表インスタンス（空きセルはundefined）。固定枠スロットのため、
   * 配列長は常にunit_capacityと等しく、位置＝添字が安定する（SlotSystem.md 3節）。
   * スロット自体を持たないcodexでは空配列。
   */
  get hand(): readonly (WorldObject | undefined)[] {
    const slot = this.instance.tryGetSlot(this.handSlotId);
    return slot === undefined ? [] : slot.cells.map((cell) => cell?.members.at(0));
  }

  /**
   * アイテムを手持ちスロットへ入れる。手持ちが受け入れられなければ（accepts制約・6枠の上限）false。
   *
   * gapIndexは枠と枠の隙間の番号（0=先頭の枠の前）で、渡すとその位置へ既存の枠を押し出して入れる
   * （Slot.tryInsertAtGap）。省略すると最初の空き枠へ入る。
   */
  take(item: WorldObject, session: WorldSession, gapIndex?: number): boolean {
    const wellKnown = session.codex.wellKnown;
    const failure =
      gapIndex === undefined
        ? item.moveToSlot(this.instance, this.handSlotId, wellKnown)
        : item.moveToSlotAtGap(this.instance, this.handSlotId, gapIndex, wellKnown);
    return failure === undefined;
  }

  /** 手持ちのアイテムを今いる土地へ置く。土地に居ない・土地が受け入れられないならfalse。 */
  drop(item: WorldObject, session: WorldSession): boolean {
    return this.location?.receiveItem(item, session) ?? false;
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
  explore(session: WorldSession): boolean {
    return this.location?.explore(this.instance, session) ?? false;
  }
}
