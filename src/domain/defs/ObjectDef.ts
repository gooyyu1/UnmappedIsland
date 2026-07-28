import type { WorldObject } from '../runtime/WorldObject';
import type { WorldSession } from '../runtime/WorldSession';
import type { ActionDef } from './ActionDef';
import type { CombinationDef } from './CombinationDef';
import { LocalIndexMap } from './LocalIndexMap';
import type { PassiveEffect } from './PassiveEffect';
import { PassiveEffects } from './PassiveEffects';
import type { PropertyDef } from './PropertyDef';
import type { SlotDef } from './SlotDef';
import type { StackOrderDef } from './StackOrderDef';

/**
 * 型定義（`object_defs` の1エントリ、4節）。ロード完了後は不変として扱う。
 * 実行時インスタンスは WorldObject（runtime）。
 */
export class ObjectDef {
  readonly globalId: number;
  readonly name: string;

  /** 唯一のインスタンスしか存在しない想定(9節、例: world)。 */
  readonly isSingleton: boolean;

  /** この object_def が持つタグのグローバルIDの一覧（4節）。自分自身が直接宣言したタグと、参照した
   * trait（5節）が宣言していたタグの両方を合成済みで持つ（trait自体は合成後に消えるため、
   * slots.accepts（7.2節）・combinations.with（12.1節）はこのタグ集合だけを見てマッチングする）。 */
  readonly tags: readonly number[];

  /** グローバルなプロパティID → このObjectDefにおけるローカルindex。 */
  readonly propertyLayout: LocalIndexMap;

  /** ローカルindexで並ぶ密配列。propertyLayout と対になる。 */
  private readonly propertyDefs: readonly PropertyDef[];

  /** グローバルなスロットID → このObjectDefにおけるローカルindex。 */
  readonly slotLayout: LocalIndexMap;

  /** ローカルindexで並ぶ密配列。slotLayout と対になる。 */
  private readonly slotDefs: readonly SlotDef[];

  /** このObjectDefが宣言する持続効果（8節）の一式（PassiveEffects参照）。 */
  readonly passives: PassiveEffects;

  /** スタック内での並び順（表示専用）。undefined なら並び順は未定義で、常にスタックの末尾へ
   * 追加される（新規インスタンス同士の相対順序＝挿入順）。 */
  readonly stackOrder: StackOrderDef | undefined;

  /** interaction/stack判定を委譲する代表オブジェクトが入っているスロットのグローバルID（7.6節）。
   * undefinedなら常に自分自身が代表。指定時は、そのスロットの先頭の1個（さらにその代表…）が
   * interactionの実行対象・stack判定の識別に使われる。 */
  readonly representedBySlotGlobalId: number | undefined;

  /** このObjectDefが持つメニュー型操作（11節）。 */
  readonly actions: readonly ActionDef[];

  /** このObjectDefが（受け側として）持つドラッグ型操作（12節）。 */
  readonly combinations: readonly CombinationDef[];

  /**
   * 個数ではなく量で存在する型か（7.6節）。真なら、インスタンスの存在と「sizeが正であること」が
   * 同値になる——moveは量を移し、移り先に同種が無ければ生まれ、移し元は量が尽きた時点で消える。
   */
  readonly isQuantitative: boolean;

  constructor(
    globalId: number,
    name: string,
    isSingleton: boolean,
    propertyLayout: LocalIndexMap,
    propertyDefs: readonly PropertyDef[],
    slotLayout: LocalIndexMap,
    slotDefs: readonly SlotDef[],
    passives: readonly PassiveEffect[],
    stackOrder?: StackOrderDef,
    tags: readonly number[] = [],
    actions: readonly ActionDef[] = [],
    combinations: readonly CombinationDef[] = [],
    representedBySlotGlobalId?: number,
    isQuantitative = false,
  ) {
    this.globalId = globalId;
    this.name = name;
    this.isSingleton = isSingleton;
    this.propertyLayout = propertyLayout;
    this.propertyDefs = propertyDefs;
    this.slotLayout = slotLayout;
    this.slotDefs = slotDefs;
    this.passives = new PassiveEffects(passives);
    this.stackOrder = stackOrder;
    this.tags = tags;
    this.actions = actions;
    this.combinations = combinations;
    this.representedBySlotGlobalId = representedBySlotGlobalId;
    this.isQuantitative = isQuantitative;
  }

  /** グローバルIDでこのObjectDefのPropertyDefを取得する。存在しない場合はundefined。 */
  getPropertyDef(globalPropertyId: number): PropertyDef | undefined {
    const local = this.propertyLayout.toLocal(globalPropertyId);
    return local === LocalIndexMap.missing ? undefined : this.propertyDefs[local];
  }

  /** グローバルIDでこのObjectDefのSlotDefを取得する。存在しない場合はundefined。 */
  getSlotDef(globalSlotId: number): SlotDef | undefined {
    const local = this.slotLayout.toLocal(globalSlotId);
    return local === LocalIndexMap.missing ? undefined : this.slotDefs[local];
  }

  /** 全PropertyDefを列挙する（WorldObject内部利用専用）。 */
  enumeratePropertyDefs(): readonly PropertyDef[] {
    return this.propertyDefs;
  }

  /** 全SlotDefを列挙する（WorldObject内部利用専用）。 */
  enumerateSlotDefs(): readonly SlotDef[] {
    return this.slotDefs;
  }

  tryExecuteAction(
    self: WorldObject,
    actor: WorldObject | undefined,
    actionName: string,
    session: WorldSession,
  ): boolean {
    const resolved = self.resolveInteractionTarget();
    const action = resolved.def.actions.find((a) => a.name === actionName);
    return action !== undefined && action.tryExecute(resolved, actor, session);
  }

  tryExecuteCombination(
    self: WorldObject,
    dragged: WorldObject,
    actor: WorldObject | undefined,
    combinationName: string,
    session: WorldSession,
  ): boolean {
    const resolvedSelf = self.resolveInteractionTarget();
    const resolvedDragged = dragged.resolveInteractionTarget();
    const combination = resolvedSelf.def.combinations.find((c) => c.name === combinationName);
    return combination !== undefined && combination.tryExecute(resolvedSelf, resolvedDragged, actor, session);
  }

  findMatchingCombinations(self: WorldObject, dragged: WorldObject): readonly CombinationDef[] {
    const resolvedSelf = self.resolveInteractionTarget();
    const resolvedDragged = dragged.resolveInteractionTarget();
    return resolvedSelf.def.combinations.filter((c) => c.matches(resolvedDragged.def));
  }
}

/** ロード済みの全 ObjectDef を、グローバルIDをそのままindexとする配列で保持する。 */
export class ObjectDefTable {
  private readonly byGlobalId: readonly ObjectDef[];

  constructor(byGlobalId: readonly ObjectDef[]) {
    this.byGlobalId = byGlobalId;
  }

  get count(): number {
    return this.byGlobalId.length;
  }

  get(globalId: number): ObjectDef {
    return this.byGlobalId[globalId];
  }
}
