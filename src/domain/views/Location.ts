import type { NameRegistry } from '../NameRegistry';
import type { WorldCodex } from '../WorldCodex';
import type { WorldObject } from '../WorldObject';
import type { WorldSession } from '../WorldSession';
import { Animal } from './Animal';
import { Path } from './Path';

/**
 * 土地（locations.yamlのexplorable trait実装オブジェクト）に対する、UI/ゲームロジック向けの型付きビュー。World
 * と同じ理由で継承ではなくラップにしている。
 *
 * 探索の入口はexploreに一本化: exploreアクションの実行に加え、設置物の公開（revealDueFixtures）まで
 * 自分で行い、呼び出し側に後続手順を持たせない。動物の手番（runAnimalTurns）も同じ形で、
 * 呼び出し側は「この土地に居る動物へ1手ずつ与えてほしい」と頼むだけになる。
 *
 * 名前解決はidOrMissingで行い、探索の語彙を持たないcodex（最小のテストフィクスチャ等）でも生成できるようにしている。
 */
export class Location {
  readonly instance: WorldObject;

  /** 語彙を持たないcodex（最小のテストフィクスチャ等）で生成された場合はundefined。 */
  private readonly codex: WorldCodex | undefined;

  private readonly explorationProgressId: number = -1;
  private readonly requiredProgressId: number = -1;
  private readonly returnPathIdId: number = -1;
  private readonly pathTagId: number = -1;
  readonly itemsSlotId: number = -1;
  readonly fixturesSlotId: number = -1;
  private readonly charactersSlotId: number = -1;
  private readonly undiscoveredFixturesSlotId: number = -1;

  constructor(instance: WorldObject, codex?: WorldCodex) {
    this.instance = instance;
    this.codex = codex;
    if (codex !== undefined) {
      this.pathTagId = codex.tagNames.tryGetId('path') ?? -1;
      this.explorationProgressId = Location.idOrMissing(codex.propertyNames, 'exploration_progress');
      this.requiredProgressId = Location.idOrMissing(codex.propertyNames, 'required_progress');
      this.returnPathIdId = Location.idOrMissing(codex.propertyNames, 'return_path_id');
      this.itemsSlotId = Location.idOrMissing(codex.slotNames, 'items');
      this.fixturesSlotId = Location.idOrMissing(codex.slotNames, 'fixtures');
      this.charactersSlotId = Location.idOrMissing(codex.slotNames, 'characters');
      this.undiscoveredFixturesSlotId = Location.idOrMissing(codex.slotNames, 'undiscovered_fixtures');
    }
  }

  /** 未登録の名前は-1（LocalIndexMap.missing扱い）にする。tryGetId失敗時の0は別の名前の有効なIDになりうるため、そのままでは使えない。 */
  private static idOrMissing(names: NameRegistry, name: string): number {
    return names.tryGetId(name) ?? -1;
  }

  /** 現在の探索進捗（実効値）。 */
  get explorationProgress(): number {
    return this.instance.getEffectiveValue(this.explorationProgressId);
  }

  /**
   * 探索率100%に当たる進捗（=exploration_progressのrange.max、土地ごとにYAMLで定義）。
   * ここに達した後も探索は続けられる（ExplorationSystem.md 2節）。
   */
  get explorationProgressMax(): number {
    return this.instance.def.getPropertyDef(this.explorationProgressId)?.range?.max ?? 0;
  }

  /** アイテムスロットの中身。 */
  get items(): readonly WorldObject[] {
    return this.slotContents(this.itemsSlotId);
  }

  /** アイテムスロットの中身を、積み重なっているまとまり（ObjectStack）ごとに分けたもの（先頭が代表）。 */
  get itemStacks(): readonly (readonly WorldObject[])[] {
    return this.slotStacks(this.itemsSlotId);
  }

  /**
   * アイテムスロットへ受け入れる。受け入れられなければ（枠の型・容量）false。
   *
   * gapIndexは並びの隙間の番号（0=先頭の前）で、渡すとその位置へ入れる（Slot.tryInsertAtGap）。
   * 省略すると末尾（合流できる同種があればそのスタック）へ入る。
   */
  receiveItem(item: WorldObject, session: WorldSession, gapIndex?: number): boolean {
    const failure =
      gapIndex === undefined
        ? item.moveToSlot(this.instance, this.itemsSlotId)
        : item.moveToSlotAtGap(this.instance, this.itemsSlotId, gapIndex);
    return failure === undefined;
  }

  /**
   * アイテムスロットの中で並び替える。memberが属するスタックを丸ごと、指定した隙間（0=先頭の前）へ
   * 入れ直す（WorldObject.reorderInParentSlot）。並び替えられなければfalse。
   */
  reorderItems(member: WorldObject, gapIndex: number): boolean {
    return member.reorderInParentSlot(gapIndex);
  }

  /** 設置物（道・木・建築物・家具・洞窟入口など、持ち歩けないもの）スロットの中身。 */
  get fixtures(): readonly WorldObject[] {
    return this.slotContents(this.fixturesSlotId);
  }

  /** 設置物スロットの中身を、積み重なっているまとまりごとに分けたもの（itemStacksと同じ扱い）。 */
  get fixtureStacks(): readonly (readonly WorldObject[])[] {
    return this.slotStacks(this.fixturesSlotId);
  }

  /**
   * 未発見の設置物スロットの中身。画面には出さない（locations.yaml参照）が、道の行き先の絵の
   * 先読み（PlayScene.requestLocationArt）が発見前に行き先を知るために読む。
   */
  get undiscoveredFixtures(): readonly WorldObject[] {
    return this.slotContents(this.undiscoveredFixturesSlotId);
  }

  /**
   * 設置物スロットの中で並び替える。プレイヤーが地形をどう捉えているかで並べ方が変わるため、
   * 持ち出せない設置物にも並び替えだけは許す（reorderItemsと同じ扱い）。
   */
  reorderFixtures(member: WorldObject, gapIndex: number): boolean {
    return member.reorderInParentSlot(gapIndex);
  }

  /** キャラクタスロットの中身。 */
  get characters(): readonly WorldObject[] {
    return this.slotContents(this.charactersSlotId);
  }

  /**
   * この土地から出ている、**発見済みの**道（ExplorationSystem.md 1.2節）。未発見の道は隠しスロットに
   * 居るので含まれない——プレイヤーが見つけていない道は、動物にとっても逃げ道にならない。
   */
  get paths(): readonly Path[] {
    if (this.codex === undefined) return [];
    const names = this.codex.propertyNames;
    return this.fixtures
      .filter((fixture) => fixture.def.tags.includes(this.pathTagId))
      .map((fixture) => new Path(fixture, names));
  }

  /**
   * この土地に居る動物へ、1手ずつ与える（HuntingSystem.md 5.2節）。tickの後処理として呼ばれる
   * （WorldSession.advanceWorldTime → World.runAnimalTurns）。
   *
   * 手番の途中で動物が居なくなりうる（逃げる・仕留められる）ため、列挙前にスナップショットを取る。
   */
  runAnimalTurns(session: WorldSession): void {
    if (this.codex === undefined) return;
    for (const item of [...this.items]) Animal.tryWrap(item, this.codex)?.takeTurn(this, session);
  }

  /**
   * この土地を1回探索する（exploreアクション＋revealDueFixtures）。探索できない土地（exploreアクションを
   * 持たない・条件を満たさない）ならfalse。探索率100%に達した後も探索は続けられる
   * （ExplorationSystem.md 2節）。
   */
  explore(actor: WorldObject | undefined): boolean {
    if (!this.instance.tryExecuteAction('explore', actor)) return false;
    this.revealDueFixtures();
    return true;
  }

  /**
   * undiscovered_fixturesの設置物のうち、required_progressが現在の探索進捗以下のものをfixturesへ移して
   * 「発見」させる。冪等。進捗がYAML側の効果だけで動いた場合に備え、exploreを介さず単独でも呼べる。
   */
  revealDueFixtures(): void {
    const hidden = this.instance.tryGetSlot(this.undiscoveredFixturesSlotId);
    if (hidden === undefined) return;

    const progress = this.explorationProgress;
    for (const fixture of [...hidden.contents]) {
      if (fixture.getEffectiveValue(this.requiredProgressId) <= progress) this.reveal(fixture);
    }
  }

  /**
   * 隠しスロットの設置物を1つ公開する。道なら、移動先の土地にある帰り道（return_path_id）も一緒に
   * 公開する。片側だけ見つかると、渡った先の土地を探索し直すまで戻れなくなるため
   * （ExplorationSystem.md 3.1節）。
   */
  private reveal(fixture: WorldObject): void {
    this.revealInOwnLocation(fixture);

    const returnPathId = fixture.getEffectiveValue(this.returnPathIdId);
    if (returnPathId === 0) return;

    const returnPath = fixture.findRoot().findDescendantByInstanceId(returnPathId);
    if (returnPath !== undefined) this.revealInOwnLocation(returnPath);
  }

  /**
   * 設置物を、それ自身が今属している土地の公開スロットへ移す。帰り道は別の土地に居るため、
   * 移し先はthis.instanceではなくその設置物の親を見る。既に公開済みなら何もしない（冪等）。
   */
  private revealInOwnLocation(fixture: WorldObject): void {
    const owner = fixture.parent;
    if (owner === undefined) return;

    const hidden = owner.tryGetSlot(this.undiscoveredFixturesSlotId);
    if (hidden === undefined || !hidden.contents.includes(fixture)) return;

    fixture.moveToSlot(owner, this.fixturesSlotId);
  }

  private slotContents(slotGlobalId: number): readonly WorldObject[] {
    const slot = this.instance.tryGetSlot(slotGlobalId);
    return slot !== undefined ? slot.contents : [];
  }

  private slotStacks(slotGlobalId: number): readonly (readonly WorldObject[])[] {
    const slot = this.instance.tryGetSlot(slotGlobalId);
    return slot === undefined ? [] : slot.cells.flatMap((cell) => (cell === undefined ? [] : [cell.members]));
  }
}
