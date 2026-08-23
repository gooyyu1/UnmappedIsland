import type {
  DragTrigger,
  InteractionTrigger,
  MenuTrigger,
  TickTrigger,
  TriggerGroups,
} from './InteractionTrigger';
import { LocalIndexMap } from './LocalIndexMap';
import type { PassiveEffect } from './PassiveEffect';
import { PassiveEffects } from './PassiveEffects';
import type { PropertyDef } from './PropertyDef';
import type { RecipeDef } from './RecipeDef';
import type { Placement, SlotDef } from './SlotDef';
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
   * タグ指定のマッチング（TypeMatchRule）はこのタグ集合だけを見る）。 */
  readonly tags: readonly number[];

  /**
   * 作りかけの物の型か（製作中オブジェクト、RecipeSystem.md 1節）。
   *
   * 製作中オブジェクトは完成品のタグを引き継ぐ（同5節）ので、**タグだけを見ると完成品と区別が
   * 付かない**。引き継ぎの目的は枠のacceptに当てはまること1点なので、それ以外の「その物であること」を
   * 問う場所はこれで弾く。判定はロード時に済ませる——型ごとに一度決まれば変わらない。
   */
  readonly isInProgress: boolean;

  /** グローバルなプロパティID → このObjectDefにおけるローカルindex。 */
  readonly propertyLayout: LocalIndexMap;

  /** ローカルindexで並ぶ密配列。propertyLayout と対になる。 */
  private readonly propertyDefs: readonly PropertyDef[];

  /** グローバルなスロットID → このObjectDefにおけるローカルindex。 */
  readonly slotLayout: LocalIndexMap;

  /** このobject_defが持つスロットの定義（宣言順）。 */
  readonly slotDefs: readonly SlotDef[];

  /** slotDefsのうち、それぞれの走査（`placement`、7.7節）に参加するものだけを宣言順に並べたもの。 */
  private readonly placementSlots: Readonly<Record<Placement, readonly SlotDef[]>>;

  /** このObjectDefが宣言する持続効果（8節）の一式（PassiveEffects参照）。 */
  readonly passives: PassiveEffects;

  /** この型を成果物とするレシピ（13節）。宣言順。 */
  readonly recipes: readonly RecipeDef[];

  /** スタック内での並び順（表示専用）。undefined なら並び順は未定義で、常にスタックの末尾へ
   * 追加される（新規インスタンス同士の相対順序＝挿入順）。 */
  readonly stackOrder: StackOrderDef | undefined;

  /**
   * 外から中身が見えるスロット（`visible_slots`、7.11節）のグローバルID。**並びが表示順**で、
   * 子ウィンドウのタブになる（Windows.md 1.2節）。名乗らないスロットは、中に入らないと分からない。
   */
  readonly visibleSlotGlobalIds: readonly number[];

  /**
   * 物を溜める入れ物として使う型か（`storage`、7.12節）。名乗った型は、上限（capacity）を持つ
   * スロットの詰まり具合をカードのバーに出す（CardView.md 8節）。
   */
  readonly isStorage: boolean;

  /**
   * **カードに出す絵を段で切り替えるプロパティ**のグローバルID（`art_by_stage`、6.4節）。undefinedなら
   * 持たず、常にこの型自身の絵（`object_defの識別子.png`）を出す。
   *
   * 1つの型につき高々1つ——複数のプロパティが同時に絵を主張する曖昧さを構造で禁じる。`art`（段の
   * 兄弟キー）を宣言できるのは、ここが指すプロパティの段だけ（ロード時に検証、RawObjectDef.resolve）。
   */
  readonly artByStagePropertyGlobalId: number | undefined;

  /**
   * **単独では存在できない型か**（7.9節、既定false）。trueなら、入っていた親が消えるとき一緒に消える。
   *
   * 身体から離れた「捻挫」も、器の無い水も、繋がる土地の無い道も存在しない。falseの物（包帯・石）は
   * 親が消えるとその親の親へこぼれ出る。
   */
  readonly boundToOwner: boolean;

  /**
   * **同種と束ねてよい型か**（既定true）。falseなら、同じ型でも1個ずつ別の枠に並ぶ。
   *
   * 束ねたくないのは、その個体を名指しで操作する必要があるとき。道は行き先が個体ごとに違い、かごは
   * 中身が個体ごとに違うので、束ねると代表の行き先・中身しか触れなくなる。**入れ物ではなく物の性質**
   * なので、スロットではなくここで宣言する（SlotSystem.md 4節）。
   */
  readonly stackable: boolean;

  /**
   * このObjectDefが宣言している操作のきっかけ（11節・12節）。宣言順で、種類は混ざっている
   * ——ページに並べるときと名前で引くときだけ、この並びを見る。
   */
  readonly triggers: readonly InteractionTrigger[];

  /** 画面のボタンに出る操作（11.1節）。 */
  readonly menuTriggers: readonly MenuTrigger[];

  /** 時間が起こす操作（11.1節）。 */
  readonly tickTriggers: readonly TickTrigger[];

  /** このObjectDefが（selfとして）持つ、カードを重ねて起こす操作（12節）。 */
  readonly dragTriggers: readonly DragTrigger[];

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
    triggers: readonly InteractionTrigger[] = [],
    boundToOwner = false,
    stackable = true,
    recipes: readonly RecipeDef[] = [],
    artByStagePropertyGlobalId?: number,
    visibleSlotGlobalIds: readonly number[] = [],
    isStorage = false,
    isInProgress = false,
  ) {
    this.globalId = globalId;
    this.name = name;
    this.isSingleton = isSingleton;
    this.propertyLayout = propertyLayout;
    this.propertyDefs = propertyDefs;
    this.slotLayout = slotLayout;
    this.slotDefs = slotDefs;
    this.placementSlots = {
      auto: slotDefs.filter((slotDef) => slotDef.allows('auto')),
      manual: slotDefs.filter((slotDef) => slotDef.allows('manual')),
    };
    this.passives = new PassiveEffects(passives);
    this.stackOrder = stackOrder;
    this.tags = tags;
    this.triggers = triggers;
    // どの束に入るかはきっかけ自身が知っている（InteractionTrigger.addTo）。
    const groups: TriggerGroups = { menu: [], tick: [], drag: [] };
    for (const trigger of triggers) trigger.addTo(groups);
    this.menuTriggers = groups.menu;
    this.tickTriggers = groups.tick;
    this.dragTriggers = groups.drag;
    this.boundToOwner = boundToOwner;
    this.stackable = stackable;
    this.recipes = recipes;
    this.artByStagePropertyGlobalId = artByStagePropertyGlobalId;
    this.visibleSlotGlobalIds = visibleSlotGlobalIds;
    this.isStorage = isStorage;
    this.isInProgress = isInProgress;
  }

  /** その名前の操作を宣言しているか（きっかけは問わない）。 */
  declaresInteraction(name: string): boolean {
    return this.triggers.some((trigger) => trigger.interaction.name === name);
  }

  /** この型にタグ（5節）が付いているか（PropertyDef.hasTagと同じ揃え）。 */
  hasTag(tagGlobalId: number): boolean {
    return this.tags.includes(tagGlobalId);
  }

  /** art_by_stage（6.4節）が指すプロパティの、stagesが宣言しているart接尾辞の一覧。art_by_stageが無ければ空。 */
  artSuffixes(): readonly string[] {
    if (this.artByStagePropertyGlobalId === undefined) return [];
    return this.tryGetPropertyDef(this.artByStagePropertyGlobalId)?.artSuffixes() ?? [];
  }

  /** グローバルIDでこのObjectDefのPropertyDefを取得する。存在しない場合はundefined。 */
  tryGetPropertyDef(globalPropertyId: number): PropertyDef | undefined {
    const local = this.propertyLayout.toLocal(globalPropertyId);
    return local === LocalIndexMap.missing ? undefined : this.propertyDefs[local];
  }

  /** グローバルIDでこのObjectDefのSlotDefを取得する。存在しない場合はundefined。 */
  tryGetSlotDef(globalSlotId: number): SlotDef | undefined {
    const local = this.slotLayout.toLocal(globalSlotId);
    return local === LocalIndexMap.missing ? undefined : this.slotDefs[local];
  }

  /** 全PropertyDefを列挙する。 */
  enumeratePropertyDefs(): readonly PropertyDef[] {
    return this.propertyDefs;
  }

  /** 全SlotDefを列挙する。 */
  enumerateSlotDefs(): readonly SlotDef[] {
    return this.slotDefs;
  }

  /**
   * その走査（`placement`、7.7節）で宛先候補になるSlotDefを宣言順に列挙する。**行き先を宣言順に探す
   * 規約は1つで、入口が2つあるだけ**——`auto`はspawn/moveが、`manual`は札を重ねたドロップが辿る。
   *
   * 走査から外したスロットは、こぼれ落ちる先を探すとき（WorldObject.spillTo）にも候補にならない
   * ——「そもそも自動では入らない」という宣言だから。
   */
  placementSlotDefs(placement: Placement): readonly SlotDef[] {
    return this.placementSlots[placement];
  }
}

/**
 * ロード済みの全 ObjectDef を、グローバルIDをそのままindexとする配列で保持する。
 *
 * **並びには穴が空く。** 名前だけが登録されていて定義が無いID（参照だけされた型）がありうるので、
 * 添字で辿る側はそれを踏む——型がundefinedを含むのはそのため。
 */
export class ObjectDefTable {
  private readonly byGlobalId: readonly (ObjectDef | undefined)[];

  constructor(byGlobalId: readonly (ObjectDef | undefined)[]) {
    this.byGlobalId = byGlobalId;
  }

  get count(): number {
    return this.byGlobalId.length;
  }

  /**
   * そのIDの型。**名前だけが登録されていて定義が無いIDがありうる**（参照だけされた型）ので、
   * 在るか分からないIDを引くときはtryGetを使う（NameRegistryのgetId/tryGetIdと同じ揃え）。
   */
  get(globalId: number): ObjectDef {
    const def = this.tryGet(globalId);
    if (def === undefined) throw new Error(`グローバルID ${globalId} の型は登録されていません。`);
    return def;
  }

  /** そのIDの型。定義が無ければundefined（範囲外・穴のどちらも同じ扱い）。 */
  tryGet(globalId: number): ObjectDef | undefined {
    return this.byGlobalId[globalId];
  }

  /** **定義のある型**を宣言順に。穴は飛ばす。 */
  *[Symbol.iterator](): IterableIterator<ObjectDef> {
    for (const def of this.byGlobalId) if (def !== undefined) yield def;
  }
}
