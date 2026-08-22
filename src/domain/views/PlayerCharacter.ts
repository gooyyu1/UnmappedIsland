import type { WorldCodex } from '../WorldCodex';
import type { WorldRuleVocabulary } from '../WorldVocabulary';
import type { SlotPosition } from '../SlotPosition';
import type { WorldObject } from '../WorldObject';
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

  private readonly words: WorldRuleVocabulary;

  constructor(instance: WorldObject, codex: WorldCodex) {
    this.instance = instance;
    this.codex = codex;
    this.words = codex.vocabulary.world;
  }

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
    return this.instance.tryGetProperty(this.words.hpId)?.getEffectiveValue() ?? 0;
  }

  get satiety(): number {
    return this.instance.tryGetProperty(this.words.satietyId)?.getEffectiveValue() ?? 0;
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
    return this.instance.tryGetSlot(slotGlobalId)?.stacks ?? [];
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

  /**
   * 死んでいるか（VitalsSystem.md 6節）。命を絶つ値は尽きた瞬間に自分を消す
   * （`on_min`の`destroy`）ので、**世界の中に居ないことがそのまま死んでいること**になる。
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
    return this.isDead ? this.instance.exhaustedStage : undefined;
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
    if (mainland === undefined) return [];

    const names: string[] = [];
    for (const object of mainland.descendants()) {
      if (object.def.tags.includes(this.words.artifactTagId)) names.push(object.def.name);
    }
    return names;
  }

  /** 自分が今その中に居る本土（居なければundefined）。 */
  private get mainland(): WorldObject | undefined {
    return this.instance.findAncestorWithTag(this.words.mainlandTagId);
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
