import { ObjectWrapper } from './ObjectWrapper';
import type { SlotPosition } from '../SlotPosition';
import type { WorldObject } from '../WorldObject';

/**
 * 土地（locations.yamlのexplorable trait実装オブジェクト）の包み（ObjectWrapper）。
 *
 * 探索の入口はexploreに一本化: exploreアクションの実行に加え、設置物の公開（revealDueFixtures）まで
 * 自分で行い、呼び出し側に後続手順を持たせない。動物の手番（runAnimalTurns）も同じ形で、
 * 呼び出し側は「この土地に居る動物へ1手ずつ与えてほしい」と頼むだけになる。
 */
export class Location extends ObjectWrapper {
  get itemsSlotId(): number {
    return this.words.itemsSlotId;
  }

  get fixturesSlotId(): number {
    return this.words.fixturesSlotId;
  }

  /** 現在の探索進捗（実効値）。 */
  get explorationProgress(): number {
    return this.effectiveNumberOf(this.words.explorationProgressId);
  }

  /**
   * 探索率100%に当たる進捗（=exploration_progressのrange.max、土地ごとにYAMLで定義）。
   * ここに達した後も探索は続けられる（ExplorationSystem.md 2節）。
   */
  get explorationProgressMax(): number {
    return this.instance.def.tryGetPropertyDef(this.words.explorationProgressId)?.range?.max ?? 0;
  }

  /** アイテムスロットの中身。 */
  get items(): readonly WorldObject[] {
    return this.contentsOf(this.itemsSlotId);
  }

  /** アイテムスロットの中身を、積み重なっているまとまり（ObjectStack）ごとに分けたもの（先頭が代表）。 */
  get itemStacks(): readonly (readonly WorldObject[])[] {
    return this.stacksOf(this.itemsSlotId);
  }

  /**
   * アイテムスロットへ受け入れる。受け入れられなければ（枠の型・容量）false。
   *
   * atは並びの中の位置（SlotPosition）。省略すると末尾（合流できる同種があればそのスタック）へ入る。
   */
  receiveItem(item: WorldObject, at?: SlotPosition): boolean {
    return item.moveToSlotOrRejection(this.instance.getSlot(this.itemsSlotId), at) === undefined;
  }

  /** 設置物（道・木・建築物・家具・洞窟入口など、持ち歩けないもの）スロットの中身。 */
  get fixtures(): readonly WorldObject[] {
    return this.contentsOf(this.fixturesSlotId);
  }

  /** 設置物スロットの中身を、積み重なっているまとまりごとに分けたもの（itemStacksと同じ扱い）。 */
  get fixtureStacks(): readonly (readonly WorldObject[])[] {
    return this.stacksOf(this.fixturesSlotId);
  }

  /**
   * 未発見の設置物スロットの中身。画面には出さない（locations.yaml参照）が、道の行き先の絵の
   * 先読み（PlayScene.requestLocationArt）が発見前に行き先を知るために読む。
   */
  get undiscoveredFixtures(): readonly WorldObject[] {
    return this.contentsOf(this.words.undiscoveredFixturesSlotId);
  }

  /** キャラクタスロットの中身。 */
  get characters(): readonly WorldObject[] {
    return this.contentsOf(this.words.charactersSlotId);
  }

  /**
   * この土地を1回探索する（exploreアクション＋revealDueFixtures）。探索できない土地（exploreアクションを
   * 持たない・条件を満たさない）ならfalse。探索率100%に達した後も探索は続けられる
   * （ExplorationSystem.md 2節）。
   */
  explore(agent: WorldObject | undefined): boolean {
    if (this.instance.tryGetAction(this.words.exploreAction, agent)?.tryExecute() !== true) return false;
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

    const returnPath = fixture.findRoot().findSelfOrDescendantByInstanceId(returnPathId);
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

    fixture.moveToSlotOrRejection(owner.getSlot(this.fixturesSlotId));
  }
}
