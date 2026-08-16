import type { NameRegistry } from '../../defs/NameRegistry';
import type { WorldCodex } from '../../defs/WorldCodex';
import type { WorldObject } from '../WorldObject';
import type { WorldSession } from '../WorldSession';
import { Location } from './Location';

/**
 * 周回の終わりを読むために、画面ではなくこのビューが名前で知っているタグ（voyage.yaml・artifacts.yaml）。
 * 段の名前で死因を読むのと同じ分担で、しきい値も意味も宣言しているのはワールドの側だけになる
 * （docs/engine/VitalsSystem.md 6節）。
 */
const MAINLAND_TAG = 'mainland';
const ARTIFACT_TAG = 'artifact';

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
  readonly handSlotId: number;
  readonly equipmentSlotId: number;
  readonly injuriesSlotId: number;

  constructor(instance: WorldObject, codex: WorldCodex) {
    this.instance = instance;
    this.codex = codex;
    this.hpId = PlayerCharacter.idOrMissing(codex.propertyNames, 'hp');
    this.satietyId = PlayerCharacter.idOrMissing(codex.propertyNames, 'satiety');
    this.handSlotId = PlayerCharacter.idOrMissing(codex.slotNames, 'hand');
    this.equipmentSlotId = PlayerCharacter.idOrMissing(codex.slotNames, 'equipment');
    this.injuriesSlotId = PlayerCharacter.idOrMissing(codex.slotNames, 'injuries');
  }

  /** 未登録の名前は-1（LocalIndexMap.missing扱い）にする。キャラクタの定義（docs/world/Characters.md）がこのビューの知る全プロパティ・スロットを持つとは限らないため、「持っていなければ空として読む」姿勢に合わせる。 */
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
   * 手持ちスロットの各セルの中身（空きセルは空配列、先頭が代表）。固定枠スロットのため、
   * 配列長は常にcellCountと等しく、位置＝添字が安定する（SlotSystem.md 3節）。
   * スロット自体を持たないcodexでは空配列。
   */
  get handStacks(): readonly (readonly WorldObject[])[] {
    const slot = this.instance.tryGetSlot(this.handSlotId);
    return slot === undefined ? [] : slot.cells.map((cell) => cell?.members ?? []);
  }

  /** 装備スロットの中身を、積み重なっているまとまりごとに分けたもの（前詰めなので空きセルは無い）。 */
  get equipmentStacks(): readonly (readonly WorldObject[])[] {
    return this.stacksOf(this.equipmentSlotId);
  }

  /** 怪我スロットの中身を、積み重なっているまとまりごとに分けたもの。 */
  get injuryStacks(): readonly (readonly WorldObject[])[] {
    return this.stacksOf(this.injuriesSlotId);
  }

  private stacksOf(slotGlobalId: number): readonly (readonly WorldObject[])[] {
    const slot = this.instance.tryGetSlot(slotGlobalId);
    return slot === undefined ? [] : slot.cells.flatMap((cell) => (cell === undefined ? [] : [cell.members]));
  }

  /** 手持ちスロットの各セルの代表インスタンス（空きセルはundefined）。 */
  get hand(): readonly (WorldObject | undefined)[] {
    return this.handStacks.map((stack) => stack.at(0));
  }

  /**
   * アイテムを手持ちスロットへ入れる。手持ちが受け入れられなければ（枠の型・枠数の上限）false。
   *
   * gapIndexは枠と枠の隙間の番号（0=先頭の枠の前）で、渡すとその位置へ既存の枠を押し出して入れる
   * （Slot.tryInsertAtGap）。省略すると最初の空き枠へ入る。
   */
  take(item: WorldObject, session: WorldSession, gapIndex?: number): boolean {
    const failure =
      gapIndex === undefined
        ? item.moveToSlot(this.instance, this.handSlotId)
        : item.moveToSlotAtGap(this.instance, this.handSlotId, gapIndex);
    return failure === undefined;
  }

  /**
   * アイテムを手持ちの空き枠（cellIndex）へ入れる。埋まっている枠を指した場合や、手持ちが受け入れ
   * られない場合はfalse（Slot.tryInsertAtCell）。
   */
  takeIntoCell(item: WorldObject, session: WorldSession, cellIndex: number): boolean {
    return item.moveToSlotAtCell(this.instance, this.handSlotId, cellIndex) === undefined;
  }

  /**
   * 手持ちの枠を並び替える。memberが属するスタックを丸ごと、指定した隙間（gapIndexは0が先頭の枠の前）へ
   * 入れ直す（WorldObject.reorderInParentSlot）。並び替えられなければfalse。
   */
  reorderHand(member: WorldObject, gapIndex: number): boolean {
    return member.reorderInParentSlot(gapIndex);
  }

  /**
   * 手持ちの枠を、指定した番号の枠（cellIndex）と入れ替える。空き枠を指せば、他の枠を動かさずに
   * そこへ移る（WorldObject.moveToCellInParentSlot）。動かせなければfalse。
   */
  moveHandToCell(member: WorldObject, cellIndex: number): boolean {
    return member.moveToCellInParentSlot(cellIndex);
  }

  /**
   * 手持ちのアイテムを今いる土地へ置く。土地に居ない・土地が受け入れられないならfalse。
   * gapIndexを渡すと、土地のアイテムの並びのその隙間へ入る（Location.receiveItem）。
   */
  drop(item: WorldObject, session: WorldSession, gapIndex?: number): boolean {
    return this.location?.receiveItem(item, session, gapIndex) ?? false;
  }

  /**
   * 死んでいるか（VitalsSystem.md 6節）。命を絶つ値は尽きた瞬間に自分を消す
   * （`on_shortfall`の`destroy`）ので、**世界の中に居ないことがそのまま死んでいること**になる。
   * 死んだかどうかを覚えておく旗は要らない。
   */
  get isDead(): boolean {
    return this.instance.parent === undefined;
  }

  /**
   * 命を奪った値が居る段の名前（生きていればundefined）。渇き・飢え・失血のどれで死んだかは、
   * 尽きた値のまま残っている段が答える（WorldObject.exhaustedStage）。表示文言は段の名前から引く
   * （Localization.stage）ので、死因を名乗るのはワールドの側だけになる。
   */
  get causeOfDeath(): string | undefined {
    return this.isDead ? this.instance.exhaustedStage() : undefined;
  }

  /**
   * 島から脱出したか（docs/concept/GameEndings.md 3節）。死と同じく旗は持たず、**本土（mainland
   * タグを持つ場所）の中に居ることがそのまま到達を表す**——筏ごと本土へ移った（voyage.yaml）結果として、
   * 自分もその中に居る。
   */
  get hasReachedMainland(): boolean {
    return this.mainland !== undefined;
  }

  /**
   * 持ち帰ったアーティファクト（`artifact`タグ、GameEndings.md 6節）のobject_defの識別子。
   * 着いていなければ空。
   *
   * **本土に着いた物すべてが対象**で、筏の積荷か手持ちかは問わない——渡り切った側に在ることだけが
   * 持ち帰った条件なので、置き場所ごとの数え方を持たない。
   */
  get broughtArtifacts(): readonly string[] {
    const mainland = this.mainland;
    const artifactTagId = this.codex.tagNames.tryGetId(ARTIFACT_TAG);
    if (mainland === undefined || artifactTagId === undefined) return [];

    const names: string[] = [];
    for (const object of mainland.descendants()) {
      if (object.def.tags.includes(artifactTagId)) names.push(object.def.name);
    }
    return names;
  }

  /** 自分が今その中に居る本土（居なければundefined）。 */
  private get mainland(): WorldObject | undefined {
    const mainlandTagId = this.codex.tagNames.tryGetId(MAINLAND_TAG);
    if (mainlandTagId === undefined) return undefined;

    for (let node = this.instance.parent; node !== undefined; node = node.parent) {
      if (node.def.tags.includes(mainlandTagId)) return node;
    }
    return undefined;
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
