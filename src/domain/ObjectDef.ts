import type { WorldObject } from './WorldObject';
import type { WorldSession } from './WorldSession';
import type { ActionDef } from './ActionDef';
import type { CombinationDef } from './CombinationDef';
import type { EffectDeclaration } from './EffectReader';
import { spawnsObject, writesToProperty } from './effectQueries';
import type { DefNames, DescriptionToken, DescriptionWriter } from './Description';
import { actionRef, combinationRef, propertyRef, text } from './Description';
import type { InteractionDef } from './InteractionDef';
import { LocalIndexMap } from './LocalIndexMap';
import type { PassiveEffect } from './PassiveEffect';
import { PassiveEffects } from './PassiveEffects';
import type { PropertyDef } from './PropertyDef';
import type { RecipeDef } from './RecipeDef';
import type { Requirement } from './Requirement';
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

  /** グローバルなプロパティID → このObjectDefにおけるローカルindex。 */
  readonly propertyLayout: LocalIndexMap;

  /** ローカルindexで並ぶ密配列。propertyLayout と対になる。 */
  private readonly propertyDefs: readonly PropertyDef[];

  /** グローバルなスロットID → このObjectDefにおけるローカルindex。 */
  readonly slotLayout: LocalIndexMap;

  /** ローカルindexで並ぶ密配列。slotLayout と対になる。 */
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

  /** このObjectDefが持つメニュー型操作（11節）。 */
  readonly actions: readonly ActionDef[];

  /** このObjectDefが（selfとして）持つドラッグ型操作（12節）。 */
  readonly combinations: readonly CombinationDef[];

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
    boundToOwner = false,
    stackable = true,
    recipes: readonly RecipeDef[] = [],
    artByStagePropertyGlobalId?: number,
    visibleSlotGlobalIds: readonly number[] = [],
    isStorage = false,
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
    this.actions = actions;
    this.combinations = combinations;
    this.boundToOwner = boundToOwner;
    this.stackable = stackable;
    this.recipes = recipes;
    this.artByStagePropertyGlobalId = artByStagePropertyGlobalId;
    this.visibleSlotGlobalIds = visibleSlotGlobalIds;
    this.isStorage = isStorage;
  }

  /**
   * この型そのものの性質（4節・7節の宣言）を書き出す（Description参照）。既定と同じ性質は書かない
   * ——「特に断っていない」ことと同じ意味なので、並べても読み手の手掛かりにならないため。
   */
  describe(names: DefNames, out: DescriptionWriter): void {
    if (this.isSingleton) out.write(text('singleton: 世界にただ1つだけ存在する'));
    if (!this.stackable) out.write(text('stackable: false（同種でも1個ずつ別の枠に並ぶ）'));
    if (this.boundToOwner) out.write(text('bound_to_owner: 入っていた親が消えるとき一緒に消える'));

    if (this.stackOrder !== undefined) out.write(text('stack_order: '), ...this.stackOrder.describe(names));

    if (this.artByStagePropertyGlobalId !== undefined)
      out.write(
        text('art_by_stage: '),
        propertyRef(names.propertyName(this.artByStagePropertyGlobalId)),
        text('の段が絵を切り替える'),
      );
  }

  /** art_by_stage（6.4節）が指すプロパティの、stagesが宣言しているart接尾辞の一覧。art_by_stageが無ければ空。 */
  artSuffixes(): readonly string[] {
    if (this.artByStagePropertyGlobalId === undefined) return [];
    return this.getPropertyDef(this.artByStagePropertyGlobalId)?.artSuffixes() ?? [];
  }

  /**
   * この型が、propertyGlobalIdのプロパティを書き換えうる箇所をすべて書き出す（プロパティ側からの
   * 逆引き）。
   *
   * ownedByThisDefは、そのプロパティがこの型自身のものか。falseなら、他の型のプロパティを
   * 書き換えうる宣言だけを書く（target=selfは常に宣言元自身のプロパティを指すため、
   * 他の型の同名プロパティには届かない）。
   */
  describeInfluencesOn(
    propertyGlobalId: number,
    ownedByThisDef: boolean,
    names: DefNames,
    out: DescriptionWriter,
  ): void {
    this.passives.describeAffecting(propertyGlobalId, ownedByThisDef, names, out);

    const matches = (declaration: EffectDeclaration): boolean =>
      writesToProperty(declaration, propertyGlobalId, ownedByThisDef);

    for (const propertyDef of this.propertyDefs) {
      // 自分自身を値域へ丸めるon_max/on_minは、そのプロパティの定義を見れば分かる
      // （「どこから影響されるか」を知りたい読み手には何も足さない）。
      if (ownedByThisDef && propertyDef.globalId === propertyGlobalId) continue;
      this.describeRangeEvents(propertyDef, matches, names, out);
    }

    for (const [token, interaction] of this.matchingInteractions(matches)) {
      out.write(token, text(':'));
      out.indented(() => interaction.describe(names, out));
    }
  }

  /**
   * この型が、objectGlobalIdの型を生み出しうるか（生まれる側からの逆引き）。生むのはspawn（9.4節）
   * だけなので、探すのはactions・combinationsとrange系イベント。
   *
   * どの操作で生まれるかまでは返さない——「これはどこから手に入るのか」を知りたい読み手には、
   * 生む側の型が答えで、その先はその型のページにある。
   */
  creates(objectGlobalId: number): boolean {
    const matches = (declaration: EffectDeclaration): boolean => spawnsObject(declaration, objectGlobalId);
    return (
      this.propertyDefs.some((propertyDef) => propertyDef.hasRangeEventMatching(matches)) ||
      this.matchingInteractions(matches).length > 0
    );
  }

  /**
   * この型のレシピが、candidateDefを素材か道具として要求しているか（材料側からの逆引き）。
   * 「何になるのか」を知りたい読み手には完成品＝この型が答えなので、どの工程で使うかまでは返さない。
   */
  usesInRecipes(candidateDef: ObjectDef): boolean {
    return this.recipes.some((recipe) => recipe.requires(candidateDef));
  }

  /** 1つのプロパティのrange系イベントのうち、matchesが真になるものを、宣言元の名前を添えて書き出す。 */
  private describeRangeEvents(
    propertyDef: PropertyDef,
    matches: (declaration: EffectDeclaration) => boolean,
    names: DefNames,
    out: DescriptionWriter,
  ): void {
    if (!propertyDef.hasRangeEventMatching(matches)) return;
    out.write(propertyRef(propertyDef.name), text(':'));
    out.indented(() => propertyDef.describeRangeEventsMatching(matches, names, out));
  }

  /** matchesが真になる操作を、その名前を指す断片（actions/combinationsの区別つき）とともに集める。 */
  private matchingInteractions(
    matches: (declaration: EffectDeclaration) => boolean,
  ): readonly (readonly [DescriptionToken, InteractionDef])[] {
    const found: (readonly [DescriptionToken, InteractionDef])[] = [];
    for (const action of this.actions) if (matches(action)) found.push([actionRef(action.name), action]);
    for (const combination of this.combinations)
      if (matches(combination)) found.push([combinationRef(combination.name), combination]);
    return found;
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
   * 走査から外したスロットは、強制配置（force）で行う場合も候補にならない——forceが省くのは受け入れ
   * 判定であって、「そもそも自動では入らない」という宣言ではないため。
   */
  placementSlotDefs(placement: Placement): readonly SlotDef[] {
    return this.placementSlots[placement];
  }

  tryExecuteAction(
    self: WorldObject,
    actor: WorldObject | undefined,
    actionName: string,
    session: WorldSession,
  ): boolean {
    const action = this.actions.find((a) => a.name === actionName);
    return action !== undefined && action.tryExecute(self, actor, session);
  }

  /**
   * actionNameを今実行できない理由（最初に落ちた要件、14節）。実行できる・宣言が無い場合はundefined。
   */
  actionUnmetRequirement(
    self: WorldObject,
    actor: WorldObject | undefined,
    actionName: string,
  ): Requirement | undefined {
    return this.actions.find((a) => a.name === actionName)?.unmetRequirement(self, actor);
  }

  /** actionNameの実行にかかるゲーム内時間（分）。宣言が無ければ0。 */
  actionMinutes(self: WorldObject, actor: WorldObject | undefined, actionName: string): number {
    return this.actions.find((a) => a.name === actionName)?.minutesFor(self, undefined, actor) ?? 0;
  }

  /** combinationNameの実行にかかるゲーム内時間（分）。宣言が無ければ0。 */
  combinationMinutes(
    self: WorldObject,
    dragged: WorldObject,
    actor: WorldObject | undefined,
    combinationName: string,
  ): number {
    return this.combinations.find((c) => c.name === combinationName)?.minutesFor(self, dragged, actor) ?? 0;
  }

  /**
   * combinationNameをまとめて実行できる個数（宣言が無ければ1）。candidatesは先頭から順に相手になる
   * 個体で、先頭が指の掴んでいたもの。
   */
  combinationAcceptedCount(
    self: WorldObject,
    candidates: readonly WorldObject[],
    actor: WorldObject | undefined,
    combinationName: string,
  ): number {
    return (
      this.combinations.find((c) => c.name === combinationName)?.acceptedCount(self, candidates, actor) ?? 1
    );
  }

  tryExecuteCombination(
    self: WorldObject,
    dragged: WorldObject,
    actor: WorldObject | undefined,
    combinationName: string,
    session: WorldSession,
  ): boolean {
    const combination = combinationsWith(self, dragged, actor).find((c) => c.name === combinationName);
    return combination !== undefined && combination.tryExecute(self, dragged, actor, session);
  }

  /**
   * selfへdraggedを重ねたときに**今**成立する組み合わせ（宣言順）。相手として受け入れるかだけでなく、
   * 要件（14節）を満たしているかまで見る——満杯の炉に薪をくべる組み合わせは、候補にならない。
   */
  combinationsWith(
    self: WorldObject,
    dragged: WorldObject,
    actor: WorldObject | undefined,
  ): readonly CombinationDef[] {
    return combinationsWith(self, dragged, actor);
  }
}

/**
 * resolvedSelfが持つcombinationのうち、resolvedDraggedを相手（with、12.1節）として受け入れ、かつ
 * 今その要件（14節）を満たし、1つ以上受け取れるもの。
 *
 * **要件まで見るのは、候補を選ぶ側と実行できる側を食い違わせないため。** 型だけで選ぶと、選んだ
 * 先が実行できない場合に「落とせるのに何も起きない」になる。
 *
 * **行き先の座標に型が居ない組み合わせも候補にならない**（`become`、9.9節）。要件と同じ理由で、
 * 選んだ先が何も起こせない組み合わせを候補に出さない。
 *
 * **作りかけの物は相手にならない。** 製作中オブジェクトは完成品のタグを引き継ぐ
 * （RecipeSystem.md 5節）ので、弾かなければ半分できた石斧で木を伐り、獣を殴れてしまう
 * ——引き継ぎは枠のacceptへ入れるためのもので、道具として働けることまでは意味しない。
 */
function combinationsWith(
  resolvedSelf: WorldObject,
  resolvedDragged: WorldObject,
  actor: WorldObject | undefined,
): readonly CombinationDef[] {
  if (resolvedDragged.isInProgress) return [];
  return resolvedSelf.def.combinations.filter(
    (c) =>
      c.matches(resolvedDragged.def) &&
      c.unmetRequirement(resolvedSelf, resolvedDragged, actor) === undefined &&
      c.acceptedCount(resolvedSelf, [resolvedDragged], actor) >= 1 &&
      !c.unresolvable(resolvedSelf, resolvedDragged, actor),
  );
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

  /** 全ての型を宣言順に。タグに当てはまる型を挙げる用途（TypeMatchRule.candidates）で使う。 */
  [Symbol.iterator](): Iterator<ObjectDef> {
    return this.byGlobalId[Symbol.iterator]();
  }
}
