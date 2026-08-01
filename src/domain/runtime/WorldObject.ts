import type { ActiveEffect, SpawnEffect, SpawnTargetRoot } from '../defs/ActiveEffect';
import type { CombinationDef } from '../defs/CombinationDef';
import { LocalIndexMap } from '../defs/LocalIndexMap';
import type { ObjectDef } from '../defs/ObjectDef';
import type { ReferenceRoot } from '../defs/ReferenceRoot';
import type { WellKnownProperties } from '../defs/WellKnownProperties';
import type { ObjectStack } from './ObjectStack';
import type { PropertyReading, PropertyValue } from './PropertyValue';
import type { RegisteredPassiveEffect } from './RegisteredPassiveEffect';
import { Slot } from './Slot';
import type { WorldSession } from './WorldSession';

/**
 * 実行時のオブジェクト実体（ObjectDefのインスタンス）。
 *
 * プロパティの現在値・スロットの中身は、Def側のローカルIDをそのままindexとする密配列として保持する。
 * プロパティへ登録された効果の一覧・tick毎の反映・実効値の算出はPropertyValueが持ち、WorldObjectはローカルID
 * 解決とグローバルAPIの提供に専念する（プロパティの読み書き）。represented_byによる代表・同種スタック判定では、
 * 自分の代表チェーンのスナップショット化・突き合わせと、中身が入れ替わったときの再スタック伝播を担う。
 * move_to_slotによる所属先の差し替え（旧親からの離脱・新親への合流・weight伝播・passive effect edgeの登録・
 * represented_by再判定）にも専念し、accepts/capacity検証は対象Slot自身へ委ねる。持続効果（modify/accumulate）の
 * 登録・解除は、生成・エッジ形成/解消・トポロジ変化の契機で、Defが宣言する効果一式（PassiveEffects）へ
 * 「登録/解除してほしい」と依頼するだけで、どのtargetがどこへ紐付くかは効果自身が知る。能動効果
 * （set/add/destroy/spawn/transfer・actions/combinations・tick）は、適用の入口（applyActiveEffect）と対象解決、
 * same_slot spawnの位置捕捉（EffectSite）・配置（place）を持つが、値の変更そのものは対象のPropertyValueへ、
 * 条件判定・抽選はDef側の効果へ委ねる。
 */
export class WorldObject {
  readonly instanceId: number;
  readonly def: ObjectDef;

  // ローカルindexで並ぶ密配列。それぞれdef.propertyDefs / def.slotDefsと対になる。
  private readonly properties: PropertyValue[];
  private readonly slots: Slot[];

  /** 所属先（7.1節）。ルート（未格納）ならundefined。 */
  private _parent: WorldObject | undefined;
  get parent(): WorldObject | undefined {
    return this._parent;
  }

  /** parentの中で自分が入っているスロットのローカルID。parentがundefinedならmissing。 */
  private _parentSlotLocalId: number = LocalIndexMap.missing;
  get parentSlotLocalId(): number {
    return this._parentSlotLocalId;
  }

  /** weight/loadの実効値導出（containerContributionTo）が使う、規約で決まったプロパティ名のID。 */
  private readonly wellKnown: WellKnownProperties;

  /** sessionは必須（value:{min,max}を持つプロパティの初期値ランダム化にsession.rngを使う）。 */
  constructor(instanceId: number, def: ObjectDef, session: WorldSession) {
    this.instanceId = instanceId;
    this.def = def;
    this.wellKnown = session.codex.wellKnown;

    this.properties = def.enumeratePropertyDefs().map((pd) => pd.createValue(this, session));
    this.slots = def.enumerateSlotDefs().map((sd) => new Slot(sd));

    // 生成時はまだトポロジが無いため、Self関係のみ登録する。Parent/Child/Ancestorはmove_to_slot以降に登録される。
    def.passives.registerRelation(this, 'self', true);
  }

  tryGetSlot(globalSlotId: number): Slot | undefined {
    const local = this.def.slotLayout.toLocal(globalSlotId);
    if (local === LocalIndexMap.missing) return undefined;
    return this.slots[local];
  }

  getSlotByLocalId(localId: number): Slot {
    return this.slots[localId];
  }

  setParent(parent: WorldObject | undefined, parentSlotLocalId: number): void {
    this._parent = parent;
    this._parentSlotLocalId = parentSlotLocalId;
  }

  tryGetProperty(globalPropertyId: number): PropertyValue | undefined {
    const local = this.def.propertyLayout.toLocal(globalPropertyId);
    if (local === LocalIndexMap.missing) return undefined;
    return this.properties[local];
  }

  /** 登録済みのincoming（modify/accumulate）はそのまま、値の中身だけを差し替える。 */
  setProperty(globalPropertyId: number, value: number): void {
    const property = this.tryGetProperty(globalPropertyId);
    if (property === undefined) {
      throw new Error(`'${this.def.name}' はプロパティ(id=${globalPropertyId})を持ちません。`);
    }
    property.copyValueFrom(value);
  }

  getNumber(globalPropertyId: number, fallback = 0): number {
    const property = this.tryGetProperty(globalPropertyId);
    return property !== undefined ? property.number : fallback;
  }

  /**
   * 数値プロパティへの不可逆な加減算（9.2節の`add`）。対象プロパティを持たない場合は何もしない（例: 重さを
   * 気にしない置物）。sessionを渡さない呼び出しは、その場ではrange判定を行わない（後で明示的にtick()を呼んで
   * 判定させる呼び出し方）。
   */
  addNumber(globalPropertyId: number, delta: number, session?: WorldSession): void {
    const value = this.tryGetProperty(globalPropertyId);
    value?.add(delta, session);
  }

  /** 数値プロパティへの不可逆な絶対値代入（9.2節の`set`）。対象プロパティを持たない場合は何もしない（addNumberと同じ規約）。 */
  setNumber(globalPropertyId: number, value: number, session?: WorldSession): void {
    const property = this.tryGetProperty(globalPropertyId);
    property?.setNumber(value, session);
  }

  /** 指定したプロパティが、今まさに指定した名前のstageに該当しているか（WhenOwnStageゲート専用、6.4節・8節）。 */
  isInStage(propertyGlobalId: number, stageName: string): boolean {
    const property = this.tryGetProperty(propertyGlobalId);
    return property !== undefined && property.isInStage(stageName);
  }

  /**
   * 指定したタグ（6.7節）が付いたプロパティの現在の状態を、propsの宣言順で読み取る。
   * タグを1つも持たないオブジェクトでは空配列。
   */
  readPropertiesWithTag(tagGlobalId: number): readonly PropertyReading[] {
    const readings: PropertyReading[] = [];
    for (const property of this.properties) {
      const reading = property.readIfTagged(tagGlobalId);
      if (reading !== undefined) readings.push(reading);
    }
    return readings;
  }

  /** modifyのみを加味した実効値（8.3節）。可逆な寄与であり、実体値そのものは書き換えない。プロパティを持たなければ0。 */
  getEffectiveValue(propertyGlobalId: number): number {
    const value = this.tryGetProperty(propertyGlobalId);
    return value !== undefined ? value.getEffectiveValue() : 0;
  }

  /**
   * interaction/stack判定の代表として採用する、represented_by先の最初の子を返す。represented_by未指定・対象
   * スロット不存在・空スロットなら自分自身を返す。代表オブジェクトがさらにrepresented_byを持つ場合は、その
   * 代表へ再帰的に委譲する。
   */
  resolveInteractionTarget(): WorldObject {
    if (this.def.representedBySlotGlobalId === undefined) return this;
    const slot = this.tryGetSlot(this.def.representedBySlotGlobalId);
    if (slot === undefined) return this;
    const represented = slot.contents.at(0);
    return represented !== undefined ? represented.resolveInteractionTarget() : this;
  }

  /**
   * stack判定用の代表ObjectDef列を、現在のrepresented_byチェーンからスナップショットする。先頭は自分自身の
   * ObjectDefで、続いて代表・代表の代表…を深さ順に並べる（外側オブジェクトも同種判定の対象。例: 水入りボウルと
   * 水入り瓶は先頭のObjectDefが違うので別スタック）。
   */
  captureRepresentationChain(): readonly number[] {
    const chain: number[] = [];
    this.appendRepresentationChain(chain);
    return chain;
  }

  /** 自分の代表チェーンが、スナップショット済みのexpectedと完全に一致するか。頻繁に呼ばれるため、候補側の配列生成を伴わずに突き合わせる。 */
  matchesRepresentation(expected: readonly number[]): boolean {
    return this.matchRepresentationFrom(expected, 0) === expected.length;
  }

  /** expected[index..]と、自分以下の代表チェーンを突き合わせる。一致した分だけ進めたindexを返し、途中で食い違う（値が違う／expectedが先に尽きる）と-1を返す。 */
  private matchRepresentationFrom(expected: readonly number[], index: number): number {
    if (index >= expected.length || expected[index] !== this.def.globalId) return -1;
    index++;

    if (this.def.representedBySlotGlobalId === undefined) return index;
    const slot = this.tryGetSlot(this.def.representedBySlotGlobalId);
    if (slot === undefined) return index;

    const represented = slot.contents.at(0);
    return represented === undefined ? index : represented.matchRepresentationFrom(expected, index);
  }

  private appendRepresentationChain(chain: number[]): void {
    chain.push(this.def.globalId);
    if (this.def.representedBySlotGlobalId === undefined) return;
    const slot = this.tryGetSlot(this.def.representedBySlotGlobalId);
    if (slot === undefined) return;

    const represented = slot.contents.at(0);
    represented?.appendRepresentationChain(chain);
  }

  /**
   * 自分の代表チェーンが変わった直後の後始末（represented_by先スロットの中身が入れ替わったときに呼ばれる）。
   * 自分の所属スタックをスロットへ再判定させ（restack）、自分を代表に使う親があれば同じ後始末を親へ伝える。
   * 上りの連鎖はrepresented_byのネスト分だけ有界。
   */
  private onRepresentationChanged(): void {
    if (this._parent === undefined) return;

    this._parent.getSlotByLocalId(this._parentSlotLocalId).restack(this);

    // 自分が親のrepresented_by先スロットに居るなら、自分の代表チェーンの変化は親の代表チェーンの変化でもある。
    if (this._parent.isRepresentedBySlot(this._parentSlotLocalId)) this._parent.onRepresentationChanged();
  }

  /** slotLocalIdが、このオブジェクトの代表を採るスロット（represented_by先）か。 */
  private isRepresentedBySlot(slotLocalId: number): boolean {
    if (this.def.representedBySlotGlobalId === undefined) return false;
    return this.def.slotLayout.toLocal(this.def.representedBySlotGlobalId) === slotLocalId;
  }

  /**
   * スロット移動を行う唯一の汎用操作（7.1節の`move_to_slot`）。accepts/capacity/unitCapacityの検証は対象Slot
   * 自身（Slot.canAccept）に委ねる。
   *
   * force=trueは検証を飛ばして必ず配置を成功させる（spawnのフォールバック、9.4節専用）。スロット自体が
   * 存在しない場合はforceでも失敗する。
   *
   * 戻り値: 成功時はundefined、失敗時はその理由。
   */
  moveToSlot(
    newParent: WorldObject,
    slotGlobalId: number,
    wellKnown: WellKnownProperties,
    force = false,
  ): string | undefined {
    return this.attachToSlot(newParent, slotGlobalId, undefined, wellKnown, force);
  }

  /**
   * same_slot専用。置き換えオブジェクトを新規ObjectStackとして、originが居たセルを基準に配置する
   * （Slot.placeSameSlot参照）。fixedPositionsで空きが作れず配置できない場合はエラーを返す（＝呼び出し側で
   * fallbackへ委ねる）。
   */
  insertSameSlot(
    newParent: WorldObject,
    slotGlobalId: number,
    placement: SameSlotPlacement,
    wellKnown: WellKnownProperties,
    force = false,
  ): string | undefined {
    return this.attachToSlot(
      newParent,
      slotGlobalId,
      (slot) => slot.placeSameSlot(this, placement.originCellIndex, placement.kindRemains),
      wellKnown,
      force,
    );
  }

  /**
   * プレイヤーが隙間を指定して入れる手動配置（Slot.tryInsertAtGap参照）。fixedPositionsのスロットで
   * 既存のセルをずらして場所を作れない場合はエラーを返す。
   */
  moveToSlotAtGap(
    newParent: WorldObject,
    slotGlobalId: number,
    gapIndex: number,
    wellKnown: WellKnownProperties,
  ): string | undefined {
    return this.attachToSlot(
      newParent,
      slotGlobalId,
      (slot) => slot.tryInsertAtGap(this, gapIndex),
      wellKnown,
      false,
    );
  }

  /**
   * プレイヤーが空きセルを指定して入れる手動配置（Slot.tryInsertAtCell参照）。fixedPositionsのスロット
   * 専用で、そのセルが空いていない場合はエラーを返す。
   */
  moveToSlotAtCell(
    newParent: WorldObject,
    slotGlobalId: number,
    cellIndex: number,
    wellKnown: WellKnownProperties,
  ): string | undefined {
    return this.attachToSlot(
      newParent,
      slotGlobalId,
      (slot) => slot.tryInsertAtCell(this, cellIndex),
      wellKnown,
      false,
    );
  }

  /**
   * プレイヤーによる手動並び替え（Slot.tryMoveStackToGap参照）。今いるスロットの中で、自分が属する
   * スタックを丸ごと指定した隙間へ入れ直す。どこにも属していない場合はfalse。
   *
   * 「どのスロットに居るか」を呼び出し側に持たせないための入口。1個ずつではなくスタックごと動かす
   * 理由はSlot側にある。
   */
  reorderInParentSlot(gapIndex: number): boolean {
    if (this._parent === undefined) return false;

    const slot = this._parent.getSlotByLocalId(this._parentSlotLocalId);
    const stack = slot.findStackContaining(this);
    return stack !== undefined && slot.tryMoveStackToGap(stack, gapIndex);
  }

  /**
   * プレイヤーによる手動並び替えのうち、行き先を空きセルで指定するもの（Slot.trySetManualPosition参照）。
   * fixedPositionsのスロット専用。
   */
  moveToCellInParentSlot(cellIndex: number): boolean {
    if (this._parent === undefined) return false;

    const slot = this._parent.getSlotByLocalId(this._parentSlotLocalId);
    const stack = slot.findStackContaining(this);
    return stack !== undefined && slot.trySetManualPosition(stack, cellIndex);
  }

  /** placeは位置を指定する配置（上記のinsertSameSlot・moveToSlotAt*）専用。省略すると通常の追加（Slot.addInternal）になる。 */
  private attachToSlot(
    newParent: WorldObject,
    slotGlobalId: number,
    place: ((slot: Slot) => boolean) | undefined,
    wellKnown: WellKnownProperties,
    force: boolean,
  ): string | undefined {
    // 入れ物を自分自身や自分の中身の中へ入れると、ツリーから切り離された輪ができる（7.1節）。
    // forceでも許さない——forceが省くのはaccepts/capacityの判定であって、木構造の不変条件ではない。
    if (this.contains(newParent)) {
      return `'${this.def.name}' を自分自身の中へは入れられません。`;
    }

    const localSlot = newParent.def.slotLayout.toLocal(slotGlobalId);
    if (localSlot === LocalIndexMap.missing) {
      return `'${newParent.def.name}' はスロット(id=${slotGlobalId})を持ちません。`;
    }

    const targetSlot = newParent.getSlotByLocalId(localSlot);

    if (!force) {
      const error = targetSlot.canAccept(this, wellKnown, newParent.def.name);
      if (error !== undefined) return error;
    }

    this.detachFromParent();

    if (place !== undefined) {
      if (!place(targetSlot)) {
        // fixedPositionsで空きが作れず配置できなかった（呼び出し側でfallbackへ）。既に旧親から切り離し済みの
        // ため、この場合は未配置（どこにも属さない）で戻す。
        return `'${newParent.def.name}.${targetSlot.def.name}' に指定した位置の空きがありません。`;
      }
    } else {
      targetSlot.addInternal(this);
    }

    this.setParent(newParent, localSlot);
    this.registerEdgeWith(newParent, true);
    // 祖先対象の登録は、新しい親チェーンが確定した後に行う（detachFromParentでの解除と対、
    // registerAncestorTargetedRecursively参照）。
    this.registerAncestorTargetedRecursively(true);

    // 入ったスロットがnewParentのrepresented_by先なら、newParentの代表チェーンが変わった。
    if (newParent.isRepresentedBySlot(localSlot)) newParent.onRepresentationChanged();

    return undefined;
  }

  /**
   * 現在の親から切り離す（destroy、9.3節）。切り離された時点でworldツリーから到達不能になり、tickの対象からも
   * 自然に外れる。既に親を持たない場合は何もしない（繰り返し実行しても安全、6.3節）。
   */
  destroy(): void {
    this.detachFromParent();
  }

  private detachFromParent(): void {
    const oldParent = this._parent;
    if (oldParent === undefined) return;

    // 祖先対象の登録解除は、トポロジが変わる前（旧祖先がまだ辿れるうち）に行う（registerAncestorTargetedRecursively
    // 参照。再登録はattachToSlot側）。
    this.registerAncestorTargetedRecursively(false);

    const oldParentSlotLocalId = this._parentSlotLocalId;
    oldParent.getSlotByLocalId(oldParentSlotLocalId).removeInternal(this);
    this.registerEdgeWith(oldParent, false);
    this.setParent(undefined, LocalIndexMap.missing);

    // 抜けたスロットがoldParentのrepresented_by先なら、oldParentの代表チェーンが変わった。
    if (oldParent.isRepresentedBySlot(oldParentSlotLocalId)) oldParent.onRepresentationChanged();
  }

  /**
   * ContainerSystem.md 1〜2節: weight/load は実効値として読むたびに導出する。自分のプロパティのうち
   * weight と load だけが、中身から寄与を受ける。
   *
   * - weight: 物の重さ。子の weight をそのまま足す（率はかけない）。量的オブジェクト（7.6節）は
   *   自分の size × density ÷ 100 が自分の重さになる。
   * - load: 担いだ人が感じる負荷。直接の子の weight に、その子の load_reduction_rate（%）を効かせた分だけ。
   *
   * 率をスロットではなく子（アイテム）が持つのは、同じ入れ物でも背負うか手に提げるかで体感が変わるため
   * （ContainerSystem.md 2節）。
   */
  containerContributionTo(propertyGlobalId: number): number {
    const wellKnown = this.wellKnown;
    if (propertyGlobalId === wellKnown.weightId) {
      let sum = this.def.isQuantitative
        ? Math.round((this.getNumber(wellKnown.sizeId) * this.getNumber(wellKnown.densityId, 100)) / 100)
        : 0;
      for (const slot of this.slots) for (const child of slot.contents) sum += child.effectiveWeight();
      return sum;
    }

    if (propertyGlobalId === wellKnown.loadId) {
      let sum = 0;
      for (const slot of this.slots) {
        for (const child of slot.contents) {
          const rate = Math.min(child.getEffectiveValue(wellKnown.loadReductionRateId), 100);
          sum += Math.round((child.effectiveWeight() * (100 - rate)) / 100);
        }
      }
      return sum;
    }

    return 0;
  }

  /**
   * 中身と、量的オブジェクトなら自分の量を含めた重さ。weightプロパティを宣言していないオブジェクトでも、
   * 中身の重さは上へ伝わる（液体は size × density が重さなので、weightを宣言する必要が無い）。
   */
  effectiveWeight(): number {
    const own = this.tryGetProperty(this.wellKnown.weightId);
    return own !== undefined
      ? own.getEffectiveValue()
      : this.containerContributionTo(this.wellKnown.weightId);
  }

  /**
   * 自分の直接の親から遡り、指定したプロパティを定義している最初の祖先を探す（無ければundefined）。
   * inherit・Target=Ancestor・conditions/weightのAncestor起点が共有する、唯一の祖先探索ロジック。
   */
  findAncestorWithProperty(propertyGlobalId: number): WorldObject | undefined {
    let current = this._parent;
    while (current !== undefined) {
      if (current.def.propertyLayout.toLocal(propertyGlobalId) !== LocalIndexMap.missing) return current;
      current = current.parent;
    }
    return undefined;
  }

  /** 自分から親を遡った、所属ツリーの根（通常はworld。未配置なら自分自身）。 */
  findRoot(): WorldObject {
    return WorldObject.findRootFrom(this);
  }

  private static findRootFrom(start: WorldObject): WorldObject {
    let current = start;
    while (current.parent !== undefined) current = current.parent;
    return current;
  }

  /**
   * 自分自身を含む子孫から、指定したinstanceIdを持つWorldObjectを探す（深さ優先、無ければundefined）。
   * 「世界に存在する＝worldツリーに繋がっている」という前提（7.1節）のもと、別途のインスタンス一覧を持たず
   * ツリー走査だけで解決する。
   */
  findDescendantByInstanceId(instanceId: number): WorldObject | undefined {
    if (this.instanceId === instanceId) return this;

    for (const slot of this.slots) {
      for (const child of slot.contents) {
        const found = child.findDescendantByInstanceId(instanceId);
        if (found !== undefined) return found;
      }
    }

    return undefined;
  }

  /** otherが自分自身か、自分の中に入っているか。入れ物を自分の中へ入れる操作を弾くのに使う。 */
  contains(other: WorldObject): boolean {
    for (let node: WorldObject | undefined = other; node !== undefined; node = node._parent) {
      if (node === this) return true;
    }
    return false;
  }

  /**
   * targetの自動配置スロット（ObjectDef.enumerateAutoPlacementSlotDefs）を宣言順に走査し、最初に受け入れ
   * られたスロットへ自分自身を移動する（著者がスロット名を知らなくてよい規約。spawnのintoとmoveが共用、
   * 9.4節）。force=trueは受け入れ判定を飛ばすため、自動配置スロットが1つでもあれば必ず成功する。
   */
  moveIntoFirstAcceptingSlot(
    target: WorldObject,
    wellKnown: WellKnownProperties,
    force = false,
    session?: WorldSession,
  ): boolean {
    for (const slotDef of target.def.enumerateAutoPlacementSlotDefs()) {
      if (this.def.isQuantitative && !force && session !== undefined) {
        if (this.pourQuantityInto(target, slotDef.globalId, wellKnown, session)) return true;
        continue;
      }
      if (this.moveToSlot(target, slotDef.globalId, wellKnown, force) === undefined) return true;
    }

    return false;
  }

  /**
   * 量的オブジェクト（7.6節）の量を、target のスロットへ移す。インスタンスは移動せず、
   * **移り先に生まれ、移し元は量が尽きた時点で消える**（「量が正であること」と「インスタンスが
   * 存在すること」が同値、という不変条件を保つ唯一のやり方）。入りきらない量は移し元に残る。
   *
   * 戻り値: 1単位でも移せたか。
   */
  private pourQuantityInto(
    target: WorldObject,
    slotGlobalId: number,
    wellKnown: WellKnownProperties,
    session: WorldSession,
  ): boolean {
    if (target === this || this.contains(target)) return false;

    const localSlot = target.def.slotLayout.toLocal(slotGlobalId);
    if (localSlot === LocalIndexMap.missing) return false;
    const slot = target.getSlotByLocalId(localSlot);

    const available = this.getNumber(wellKnown.sizeId);
    if (available <= 0) return false;

    const merged = slot.findQuantityMergeTarget(this);
    // 合流先が無いときだけ、新しいインスタンスを置けるかをacceptsに問う（既にいるなら枠は増えない）。
    if (merged === undefined && !slot.acceptsByRule(this)) return false;

    const amount = Math.min(available, slot.remainingCapacity(wellKnown.sizeId));
    if (amount <= 0) return false;

    if (merged !== undefined) {
      merged.setNumber(wellKnown.sizeId, merged.getNumber(wellKnown.sizeId) + amount, session);
    } else {
      const born = session.spawn(this.def.globalId);
      born.setNumber(wellKnown.sizeId, amount, session);
      if (born.moveToSlot(target, slotGlobalId, wellKnown) !== undefined) return false;
    }

    const left = available - amount;
    this.setNumber(wellKnown.sizeId, left, session);
    if (left <= 0) this.destroy();

    return true;
  }

  /**
   * 親子のエッジが形成/解消された契機を、双方の効果（modify/accumulate、8節）へ伝える（register=trueで登録、
   * falseで解除）。親側だけ子thisを明示的に渡すのは、親からどの子かを一意に辿れないため。target=selfは
   * コンストラクタで登録済みのため、ここでは扱わない。
   */
  private registerEdgeWith(parent: WorldObject, register: boolean): void {
    this.def.passives.registerRelation(this, 'parent', register);
    parent.def.passives.registerChild(parent, this, register);
  }

  /**
   * 自分自身と、すべての子孫について、target=ancestorのpassivesを現在の祖先へ登録/解除する。親が変わると子孫
   * 全員の祖先チェーンも変わるため、再帰で全員分を扱う。トポロジ変化前に解除・変化後に登録する順序を守ることで、
   * いずれの時点でも祖先はownerから辿れ、前回の登録先を憶える必要がない。
   */
  private registerAncestorTargetedRecursively(register: boolean): void {
    this.def.passives.registerRelation(this, 'ancestor', register);

    for (const slot of this.slots) {
      for (const child of [...slot.contents]) child.registerAncestorTargetedRecursively(register);
    }
  }

  /** 対象プロパティのincomingへ、登録済み効果1件を登録する。このオブジェクトがそのプロパティを持たなければ何もしない（呼び出し側は宛先の有無を気にしなくてよい）。 */
  registerPassiveEffect(propertyGlobalId: number, effect: RegisteredPassiveEffect): void {
    const property = this.tryGetProperty(propertyGlobalId);
    property?.registerPassiveEffect(effect);
  }

  /** 対象プロパティから、declarerが宣言した登録を解除する。プロパティを持たなければ何もしない。 */
  unregisterPassiveEffectsFrom(declarer: WorldObject, propertyGlobalId: number): void {
    const property = this.tryGetProperty(propertyGlobalId);
    property?.unregisterPassiveEffectsFrom(declarer);
  }

  /** 現在このプロパティに登録されている全寄与（modify/accumulate両方）。UI表示用。各効果が現在いくら効いているかはRegisteredPassiveEffect.activeAmountで得られる。 */
  getIncomingPassiveEffects(propertyGlobalId: number): readonly RegisteredPassiveEffect[] {
    const property = this.tryGetProperty(propertyGlobalId);
    return property !== undefined ? property.incoming : [];
  }

  tryExecuteAction(actionName: string, actor: WorldObject | undefined, session: WorldSession): boolean {
    return this.def.tryExecuteAction(this, actor, actionName, session);
  }

  /** actionNameの実行にかかるゲーム内時間（分）。実行前に所要時間を見せるために使う。 */
  actionMinutes(actionName: string, actor: WorldObject | undefined): number {
    return this.def.actionMinutes(this, actor, actionName);
  }

  tryExecuteCombination(
    dragged: WorldObject,
    actor: WorldObject | undefined,
    combinationName: string,
    session: WorldSession,
  ): boolean {
    return this.def.tryExecuteCombination(this, dragged, actor, combinationName, session);
  }

  /** combinationNameの実行にかかるゲーム内時間（分）。 */
  combinationMinutes(dragged: WorldObject, actor: WorldObject | undefined, combinationName: string): number {
    return this.def.combinationMinutes(this, dragged, actor, combinationName);
  }

  findMatchingCombinations(dragged: WorldObject): readonly CombinationDef[] {
    return this.def.findMatchingCombinations(this, dragged);
  }

  /**
   * 全プロパティのtick処理（accumulateの反映とrangeイベント判定、PropertyValue.tick参照）を行った後、子
   * （すべてのスロットの中身）へ再帰する。すべてのオブジェクトはworldの下にぶら下がるため、worldへ1回呼ぶだけで
   * ツリー全体が処理される。
   *
   * rangeイベントのdestroy/spawnは処理中に自分自身や兄弟をツリーから切り離しうるため、各スロットの中身は
   * 列挙前にスナップショットを取る。
   */
  tick(session: WorldSession): void {
    for (const property of this.properties) property.tick(session);

    for (const slot of this.slots) {
      for (const child of [...slot.contents]) child.tick(session);
    }

    // 量的オブジェクト（7.6節）は「sizeが正であること」と「インスタンスが存在すること」が同値。
    // 蒸発などで量が尽きたら、この不変条件を自分で回復する（on_shortfallの宣言を各液体に書かせない）。
    if (this.def.isQuantitative && this.getNumber(session.codex.wellKnown.sizeId) <= 0) {
      this.destroy();
    }
  }

  /**
   * このオブジェクトをselfとして、set/add/destroy/spawnを実行する（9.2〜9.4節）。rangeイベント（6節）と
   * actions/combinations（11節・12節）の両方から呼ばれる（rangeイベント経由ではactor/draggedはundefined）。
   * 対象が解決できない場合（parentが無い、actor/draggedがこの実行文脈に無い）は、その対象への適用のみ無視する。
   *
   * destroyをspawnより先に行う（9.3節・9.4節）: 置き換え後のオブジェクトが破棄されるオブジェクトの位置を
   * 引き継げるよう、destroyで実際に位置が空いてから通常の（force無しの）配置を行う。
   */
  applyActiveEffect(
    effect: ActiveEffect,
    session: WorldSession,
    actor: WorldObject | undefined,
    dragged: WorldObject | undefined,
  ): void {
    // same_slot spawnのために「selfが今占めている位置」を、まだ何も起きていないこの入口で捕捉する。destroyが
    // selfを消した後でも、spawnはこのアンカーと配置時のスロットの状態から置き換え位置を決められる（EffectSite
    // 参照）。
    const effectSite = this.captureEffectSite();
    effect.apply(this, session, actor, dragged, effectSite);
  }

  /** 効果の対象キー(self/parent/actor/dragged)を解決する。ancestorはプロパティごとに解決先が変わりうるため扱わない（resolveEffectTargetOrAncestor参照）。 */
  resolveEffectTarget(
    root: ReferenceRoot,
    actor: WorldObject | undefined,
    dragged: WorldObject | undefined,
  ): WorldObject | undefined {
    switch (root) {
      case 'self':
        return this;
      case 'parent':
        return this._parent;
      case 'actor':
        return actor;
      case 'dragged':
        return dragged;
      default:
        return undefined;
    }
  }

  /** resolveEffectTargetに加えancestorも解決する（propertyGlobalIdはancestor解決にのみ使う）。 */
  resolveEffectTargetOrAncestor(
    root: ReferenceRoot,
    propertyGlobalId: number,
    actor: WorldObject | undefined,
    dragged: WorldObject | undefined,
  ): WorldObject | undefined {
    return root === 'ancestor'
      ? this.findAncestorWithProperty(propertyGlobalId)
      : this.resolveEffectTarget(root, actor, dragged);
  }

  /** same_slotの置き換えのために、selfが今占めている位置を捕捉する。「これから消えるか」の予測は織り込まず、置き換え位置の判断は配置時にEffectSite自身が行う。parentが無ければ位置が無いのでundefined。 */
  private captureEffectSite(): EffectSite | undefined {
    if (this._parent === undefined) return undefined;

    const slot = this._parent.getSlotByLocalId(this._parentSlotLocalId);
    const originStack = slot.findStackContaining(this);
    if (originStack === undefined) return undefined;

    return new EffectSite(this._parent, this._parentSlotLocalId, originStack, slot.indexOfStack(originStack));
  }

  /**
   * spawn（9.4節）を実行する。intoへの配置に失敗した場合は起点自身の親へ伝播し、accepts/capacityを無視して
   * 強制配置する（place参照）。伝播先の親も無ければ、生成したオブジェクトはworldツリーに繋がらないまま消える。
   */
  executeSpawn(
    effect: SpawnEffect,
    session: WorldSession,
    actor: WorldObject | undefined,
    effectSite: EffectSite | undefined,
  ): void {
    const spawned = session.spawn(effect.objectGlobalId);
    if (effect.into === 'same_slot') this.copySharedPropertiesTo(spawned);
    this.place(spawned, effect.into, session, actor, effect.into === 'same_slot' ? effectSite : undefined);
  }

  private copySharedPropertiesTo(other: WorldObject): void {
    for (const propertyDef of other.def.enumeratePropertyDefs()) {
      const value = this.tryGetProperty(propertyDef.globalId);
      if (value === undefined) continue;
      other.setProperty(propertyDef.globalId, value.number);
    }
  }

  /**
   * spawnした側は配置先のスロット名を書かない。same_slotなら捕捉しておいた位置へ配置する（同種スタックへの
   * 合流を除き、originが居たセルを基準にSlot.placeSameSlotへ委ねる）。self/actorなら対象のスロットを宣言順に
   * 走査し、最初に配置できたスロットへ入れる。配置に失敗した場合は起点自身の親へ伝播し、accepts/capacityを
   * 無視して強制配置する。伝播先の親も無ければ何もしない。
   */
  private place(
    spawned: WorldObject,
    into: SpawnTargetRoot,
    session: WorldSession,
    actor: WorldObject | undefined,
    site: EffectSite | undefined,
  ): void {
    let primaryTarget: WorldObject;
    let placed: boolean;

    if (into === 'same_slot') {
      if (site === undefined) return;
      primaryTarget = site.parent;
      const slot = site.parent.getSlotByLocalId(site.parentSlotLocalId);

      if (slot.def.fixedPositions && slot.findMatchingStack(spawned) !== undefined) {
        // 置き換え先の型が既にこのスロットに存在する（同種スタックへの合流）。位置操作は不要。
        placed =
          spawned.moveToSlot(site.parent, slot.def.globalId, session.codex.wellKnown, false) === undefined;
      } else {
        // originが居たセルを基準に置き換えを配置する（Slot.placeSameSlot参照）。
        placed =
          spawned.insertSameSlot(
            site.parent,
            slot.def.globalId,
            new SameSlotPlacement(site.originCellIndex(slot), site.originKindRemains),
            session.codex.wellKnown,
            false,
          ) === undefined;
      }
    } else {
      const target = into === 'self' ? this : actor;
      if (target === undefined) return;
      primaryTarget = target;
      placed = WorldObject.tryFirstAcceptingSlot(spawned, primaryTarget, session, false);
    }

    if (placed) return;
    if (primaryTarget.parent === undefined) return;

    WorldObject.tryFirstAcceptingSlot(spawned, primaryTarget.parent, session, true);
  }

  /** targetのスロットを宣言順に走査し、最初に配置できたスロットへ入れる（moveIntoFirstAcceptingSlot参照）。 */
  private static tryFirstAcceptingSlot(
    spawned: WorldObject,
    target: WorldObject,
    session: WorldSession,
    force: boolean,
  ): boolean {
    return spawned.moveIntoFirstAcceptingSlot(target, session.codex.wellKnown, force);
  }
}

/** same_slot置き換えの配置指示: originが居たセルの位置と、そのセルに同種が残っているか。 */
export class SameSlotPlacement {
  readonly originCellIndex: number;
  readonly kindRemains: boolean;

  constructor(originCellIndex: number, kindRemains: boolean) {
    this.originCellIndex = originCellIndex;
    this.kindRemains = kindRemains;
  }
}

/**
 * applyActiveEffectの入口でself（効果の起点）が占めていた位置を捕捉したスナップショット。same_slot spawnだけが
 * これを使い、置き換え先を決める。「これからselfが消えるか」は捕捉時には織り込まず、置き換え位置の判断は配置時の
 * スロットの状態から行う（originKindRemains参照）。
 */
export class EffectSite {
  readonly parent: WorldObject;
  readonly parentSlotLocalId: number;

  /** 捕捉時にself(origin)が属していたObjectStack。 */
  private readonly originStack: ObjectStack;

  /** 捕捉時のoriginStackのセル位置。空セルが除去される非fixedPositionsでは、同種が消えた後はindexOfStackで引けなくなるため捕捉値が要る。 */
  private readonly stackIndexAtCapture: number;

  constructor(
    parent: WorldObject,
    parentSlotLocalId: number,
    originStack: ObjectStack,
    stackIndexAtCapture: number,
  ) {
    this.parent = parent;
    this.parentSlotLocalId = parentSlotLocalId;
    this.originStack = originStack;
    this.stackIndexAtCapture = stackIndexAtCapture;
  }

  /**
   * 元のスタックにoriginと同種がまだ残っているか（selfが生き残る／同種の兄弟が残る）。残っていれば置き換え
   * オブジェクトは隣へ、残っていなければ空いたその位置をそのまま引き継ぐ。判定は在庫（members.length）で行う
   * ——「その位置が同種を受け入れられるか」ではない。空になったセルも同種を受け入れ可能だが、位置は引き継ぐ
   * べきだから。
   */
  get originKindRemains(): boolean {
    return this.originStack.members.length > 0;
  }

  /** originが居たセルの位置。同種が残っていればoriginStackの現在位置、消えていれば捕捉時の位置。Slot.placeSameSlotがこれを基準に配置する。 */
  originCellIndex(slot: Slot): number {
    return this.originKindRemains ? slot.indexOfStack(this.originStack) : this.stackIndexAtCapture;
  }
}
