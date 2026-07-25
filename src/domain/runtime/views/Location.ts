import type { NameRegistry } from '../../defs/NameRegistry';
import type { WorldCodex } from '../../defs/WorldCodex';
import type { WorldObject } from '../WorldObject';
import type { WorldSession } from '../WorldSession';

/**
 * 土地（locations.yamlのexplorable trait実装オブジェクト）に対する、UI/ゲームロジック向けの型付きビュー。World
 * と同じ理由で継承ではなくラップにしている。
 *
 * 探索の入口はexploreに一本化: exploreアクションの実行に加え、道の公開（revealDuePaths）まで自分で行い、
 * 呼び出し側に後続手順を持たせない。
 *
 * 名前解決はidOrMissingで行い、探索の語彙を持たないcodex（最小のテストフィクスチャ等）でも生成できるようにしている。
 */
export class Location {
  readonly instance: WorldObject;

  private readonly explorationProgressId: number = -1;
  private readonly requiredProgressId: number = -1;
  private readonly itemsSlotId: number = -1;
  private readonly fixturesSlotId: number = -1;
  private readonly charactersSlotId: number = -1;
  private readonly undiscoveredPathsSlotId: number = -1;
  private readonly pathsSlotId: number = -1;

  constructor(instance: WorldObject, codex?: WorldCodex) {
    this.instance = instance;
    if (codex !== undefined) {
      this.explorationProgressId = Location.idOrMissing(codex.propertyNames, 'exploration_progress');
      this.requiredProgressId = Location.idOrMissing(codex.propertyNames, 'required_progress');
      this.itemsSlotId = Location.idOrMissing(codex.slotNames, 'items');
      this.fixturesSlotId = Location.idOrMissing(codex.slotNames, 'fixtures');
      this.charactersSlotId = Location.idOrMissing(codex.slotNames, 'characters');
      this.undiscoveredPathsSlotId = Location.idOrMissing(codex.slotNames, 'undiscovered_paths');
      this.pathsSlotId = Location.idOrMissing(codex.slotNames, 'paths');
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

  /** 設置物（木・植物・建築物・家具・洞窟入口など）スロットの中身。 */
  get fixtures(): readonly WorldObject[] {
    return this.slotContents(this.fixturesSlotId);
  }

  /** キャラクタスロットの中身。 */
  get characters(): readonly WorldObject[] {
    return this.slotContents(this.charactersSlotId);
  }

  /** 発見済みの道。未発見の道（undiscovered_paths側）は含まない。 */
  get paths(): readonly WorldObject[] {
    return this.slotContents(this.pathsSlotId);
  }

  /**
   * この土地を1回探索する（exploreアクション＋revealDuePaths）。探索できない土地（exploreアクションを
   * 持たない・条件を満たさない）ならfalse。探索率100%に達した後も探索は続けられる
   * （ExplorationSystem.md 2節）。
   */
  explore(actor: WorldObject | undefined, session: WorldSession): boolean {
    if (!this.instance.tryExecuteAction('explore', actor, session)) return false;
    this.revealDuePaths(session);
    return true;
  }

  /**
   * undiscovered_pathsの道のうち、required_progressが現在の探索進捗以下のものをpathsへ移して「発見」させる。
   * 冪等。進捗がYAML側の効果だけで動いた場合に備え、exploreを介さず単独でも呼べる。
   */
  revealDuePaths(session: WorldSession): void {
    const hidden = this.instance.tryGetSlot(this.undiscoveredPathsSlotId);
    if (hidden === undefined) return;

    const progress = this.explorationProgress;
    for (const path of [...hidden.contents]) {
      if (path.getEffectiveValue(this.requiredProgressId) <= progress) {
        path.moveToSlot(this.instance, this.pathsSlotId, session.codex.wellKnown);
      }
    }
  }

  private slotContents(slotGlobalId: number): readonly WorldObject[] {
    const slot = this.instance.tryGetSlot(slotGlobalId);
    return slot !== undefined ? slot.contents : [];
  }
}
