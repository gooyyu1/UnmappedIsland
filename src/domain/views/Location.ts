import type { WorldCodex } from '../WorldCodex';
import type { WorldRuleVocabulary } from '../WorldVocabulary';
import type { SlotPosition } from '../SlotPosition';
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
 * 引く名前はWorldVocabularyが持つ。探索の宣言を持たない土地でも生成できる——「その名前を持つか」は
 * 語彙ではなくインスタンスが答えるので、持たなければ空として読める。
 */
export class Location {
  readonly instance: WorldObject;

  private readonly codex: WorldCodex;
  private readonly words: WorldRuleVocabulary;

  constructor(instance: WorldObject, codex: WorldCodex) {
    this.instance = instance;
    this.codex = codex;
    this.words = codex.vocabulary.world;
  }

  get itemsSlotId(): number {
    return this.words.itemsSlotId;
  }

  get fixturesSlotId(): number {
    return this.words.fixturesSlotId;
  }

  /** 現在の探索進捗（実効値）。 */
  get explorationProgress(): number {
    return this.instance.tryGetProperty(this.words.explorationProgressId)?.getEffectiveValue() ?? 0;
  }

  /**
   * 探索率100%に当たる進捗（=exploration_progressのrange.max、土地ごとにYAMLで定義）。
   * ここに達した後も探索は続けられる（ExplorationSystem.md 2節）。
   */
  get explorationProgressMax(): number {
    return this.instance.def.getPropertyDef(this.words.explorationProgressId)?.range?.max ?? 0;
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
   * atは並びの中の位置（SlotPosition）。省略すると末尾（合流できる同種があればそのスタック）へ入る。
   */
  receiveItem(item: WorldObject, at?: SlotPosition): boolean {
    return item.moveToSlot(this.instance.getSlot(this.itemsSlotId), at) === undefined;
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
    return this.slotContents(this.words.undiscoveredFixturesSlotId);
  }

  /** キャラクタスロットの中身。 */
  get characters(): readonly WorldObject[] {
    return this.slotContents(this.words.charactersSlotId);
  }

  /**
   * この土地から出ている、**発見済みの**道（ExplorationSystem.md 1.2節）。未発見の道は隠しスロットに
   * 居るので含まれない——プレイヤーが見つけていない道は、動物にとっても逃げ道にならない。
   */
  get paths(): readonly Path[] {
    return this.fixtures
      .filter((fixture) => fixture.def.tags.includes(this.words.pathTagId))
      .map((fixture) => new Path(fixture, this.codex));
  }

  /**
   * この土地に居る動物へ、1手ずつ与える（HuntingSystem.md 5.2節）。tickの後処理として呼ばれる
   * （WorldSession.advanceWorldTime → World.runAnimalTurns）。
   *
   * 手番の途中で動物が居なくなりうる（逃げる・仕留められる）ため、列挙前にスナップショットを取る。
   */
  runAnimalTurns(session: WorldSession): void {
    for (const item of [...this.items]) Animal.tryWrap(item, this.codex)?.takeTurn(this, session);
  }

  /**
   * この土地を1回探索する（exploreアクション＋revealDueFixtures）。探索できない土地（exploreアクションを
   * 持たない・条件を満たさない）ならfalse。探索率100%に達した後も探索は続けられる
   * （ExplorationSystem.md 2節）。
   */
  explore(actor: WorldObject | undefined): boolean {
    if (this.instance.tryGetAction(this.words.exploreAction, actor)?.tryExecute() !== true) return false;
    this.revealDueFixtures();
    return true;
  }

  /**
   * undiscovered_fixturesの設置物のうち、required_progressが現在の探索進捗以下のものをfixturesへ移して
   * 「発見」させる。冪等。進捗がYAML側の効果だけで動いた場合に備え、exploreを介さず単独でも呼べる。
   */
  revealDueFixtures(): void {
    const hidden = this.instance.tryGetSlot(this.words.undiscoveredFixturesSlotId);
    if (hidden === undefined) return;

    const progress = this.explorationProgress;
    for (const fixture of [...hidden.contents]) {
      if ((fixture.tryGetProperty(this.words.requiredProgressId)?.getEffectiveValue() ?? 0) <= progress)
        this.reveal(fixture);
    }
  }

  /**
   * 隠しスロットの設置物を1つ公開する。道なら、移動先の土地にある帰り道（return_path_id）も一緒に
   * 公開する。片側だけ見つかると、渡った先の土地を探索し直すまで戻れなくなるため
   * （ExplorationSystem.md 3.1節）。
   */
  private reveal(fixture: WorldObject): void {
    this.revealInOwnLocation(fixture);

    const returnPathId = fixture.tryGetProperty(this.words.returnPathIdId)?.getEffectiveValue() ?? 0;
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

    const hidden = owner.tryGetSlot(this.words.undiscoveredFixturesSlotId);
    if (hidden === undefined || !hidden.contents.includes(fixture)) return;

    fixture.moveToSlot(owner.getSlot(this.fixturesSlotId));
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
