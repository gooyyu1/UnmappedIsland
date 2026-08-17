import type { ActiveEffect, SpawnEffect, SpawnTargetRoot } from '../defs/ActiveEffect';
import type { CombinationDef } from '../defs/CombinationDef';
import { LocalIndexMap } from '../defs/LocalIndexMap';
import type { ObjectDef } from '../defs/ObjectDef';
import type { ReferenceRoot } from '../defs/ReferenceRoot';
import type { WellKnownProperties } from '../defs/WellKnownProperties';
import type { ObjectStack } from './ObjectStack';
import type { InfluenceWriter, PropertyInfluenceReading } from './PropertyInfluence';
import { PropertyInfluences } from './PropertyInfluence';
import type { PropertyReading, PropertyValue } from './PropertyValue';
import type { Requirement } from '../defs/Requirement';
import type { RegisteredPassiveEffect } from './RegisteredPassiveEffect';
import { Slot } from './Slot';
import type { WorldPlace } from './WorldChange';
import type { WorldSession } from './WorldSession';

/**
 * 実行時のオブジェクト実体（ObjectDefのインスタンス）。
 *
 * プロパティの現在値・スロットの中身は、Def側のローカルIDをそのままindexとする密配列として保持する。
 * プロパティへ登録された効果の一覧・tick毎の反映・実効値の算出はPropertyValueが持ち、WorldObjectはローカルID
 * 解決とグローバルAPIの提供に専念する（プロパティの読み書き）。represented_byによる代表・同種スタック判定では、
 * 自分の代表チェーンのスナップショット化・突き合わせと、中身が入れ替わったときの再スタック伝播を担う。
 * move_to_slotによる所属先の差し替え（旧親からの離脱・新親への合流・weight伝播・passive effect edgeの登録・
 * represented_by再判定）にも専念し、枠の要件・capacityの検証は対象Slot自身へ委ねる。持続効果（modify/add）の
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

  /**
   * このオブジェクトが生きるセッション。**生成したセッションと、その後この物が居るセッションは同じ**
   * ——だから配置の関門（attachToSlot・destroy）が、呼び出し側から渡されずに変化を記録できる
   * （WorldSession.recordChange）。
   */
  private readonly session: WorldSession;

  /** weight/loadの実効値導出（containerContributionTo）が使う、規約で決まったプロパティ名のID。 */
  private get wellKnown(): WellKnownProperties {
    return this.session.codex.wellKnown;
  }

  /**
   * 作りかけの物か（製作中オブジェクト、RecipeSystem.md 1節）。
   *
   * 製作中オブジェクトは完成品のタグを引き継ぐ（同5節）ので、**タグだけを見ると完成品と区別が
   * 付かない**。引き継ぎの目的は枠のacceptに当てはまること1点なので、それ以外の
   * 「その物であること」を問う場所はここで弾く。
   */
  get isInProgress(): boolean {
    return this.session.codex.productOf(this.def) !== undefined;
  }

  /** sessionは必須（value:{min,max}を持つプロパティの初期値ランダム化にsession.rngを使う）。 */
  constructor(instanceId: number, def: ObjectDef, session: WorldSession) {
    this.instanceId = instanceId;
    this.def = def;
    this.session = session;

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

  /**
   * 今この物の中に入っている物すべて（スロットの区別なく、直下の1段だけ）。**どのスロットに
   * 入っているかを問わない見方**なので、スロット名を知らない側——「中に何かこういう物があるか」
   * だけを見たい側——が使う。
   */
  *children(): IterableIterator<WorldObject> {
    for (const slot of this.slots) for (const child of slot.contents) yield child;
  }

  /** 自分の中に入っている物すべて（自分自身は含まず、何段でも下まで）。 */
  *descendants(): IterableIterator<WorldObject> {
    for (const child of this.children()) {
      yield child;
      yield* child.descendants();
    }
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

  /** 登録済みのincoming（modify/add）はそのまま、値の中身だけを差し替える。 */
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
    this.settleChangedVolume(globalPropertyId, session);
  }

  /** 数値プロパティへの不可逆な絶対値代入（9.2節の`set`）。対象プロパティを持たない場合は何もしない（addNumberと同じ規約）。 */
  setNumber(globalPropertyId: number, value: number, session?: WorldSession): void {
    const property = this.tryGetProperty(globalPropertyId);
    property?.setNumber(value, session);
    this.settleChangedVolume(globalPropertyId, session);
  }

  /**
   * volumeを書き換えた直後に、量的オブジェクトの不変条件（settleVolume）を戻す。飲み干した水が次のtickまで
   * 0mLのまま残っていると、その間だけ「空なのに中身がいる容器」が見えてしまう。量を動かした側が後始末を
   * 覚えておかなくて済むよう、動かされた側がその場で畳む。
   *
   * sessionを渡さない呼び出しは、その場では何も判定しない規約（addNumber参照）なのでtickに任せる。
   */
  private settleChangedVolume(globalPropertyId: number, session: WorldSession | undefined): void {
    if (session === undefined) return;
    if (!this.def.isQuantitative || globalPropertyId !== this.wellKnown.volumeId) return;
    this.settleVolume(session);
  }

  /** 指定したプロパティが、今まさに指定した名前のstageに該当しているか（WhenOwnStageゲート専用、6.4節・8節）。 */
  isInStage(propertyGlobalId: number, stageName: string): boolean {
    const property = this.tryGetProperty(propertyGlobalId);
    return property !== undefined && property.isInStage(stageName);
  }

  /**
   * `art_by_stage`（6.4節）が指すプロパティの、今の段が宣言しているart接尾辞。`art_by_stage`を
   * 持たない型、対象プロパティを持たないインスタンス、宣言の無い段では、いずれもundefined
   * （呼び出し側はその型自身の絵をそのまま使う）。
   */
  artSuffix(): string | undefined {
    const propertyGlobalId = this.def.artByStagePropertyGlobalId;
    if (propertyGlobalId === undefined) return undefined;
    return this.tryGetProperty(propertyGlobalId)?.artSuffix();
  }

  /** 名指しした1つのプロパティの現在の状態。持たないオブジェクトではundefined。 */
  readProperty(globalPropertyId: number): PropertyReading | undefined {
    return this.tryGetProperty(globalPropertyId)?.read();
  }

  /**
   * 名指しした1つのプロパティが、今の進み方であと何tickでrangeを超える（on_overflowが起きる）か。
   * そのプロパティを持たない・今は進んでいない場合はundefined。
   */
  ticksUntilOverflow(globalPropertyId: number): number | undefined {
    return this.tryGetProperty(globalPropertyId)?.ticksUntilOverflow();
  }

  /**
   * 自分が入っているスロットを、自分のかさ（7.3節のvolume）がどれだけ満たしているか（0〜1）。
   * どこにも入っていない、あるいはスロットが上限（capacity）を持たず割合を定義できない場合はundefined。
   *
   * 上限は入れ物、量は中身が持つ（LiquidContainerSystem.md 2節）ので、割合はこの2つが出会う
   * 「中身から見た自分の親スロット」でしか出せない。
   */
  fillRatioInParentSlot(): number | undefined {
    if (this._parent === undefined) return undefined;
    return this._parent.getSlotByLocalId(this._parentSlotLocalId).fillRatio(this.wellKnown.volumeId);
  }

  /**
   * 自分の主要なスロット（`main_item_slot`、7.8節）へ入っている物のかさが、そのスロットの上限
   * （capacity）をどれだけ満たしているか（0〜1）。主要なスロットを持たない物、そのスロットが
   * 上限を持たない入れ物ではundefined。
   *
   * fillRatioInParentSlotと表裏で、こちらは入れ物の側から自分の詰まり具合を見る。
   */
  mainSlotFillRatio(): number | undefined {
    const slotGlobalId = this.def.mainItemSlotGlobalId;
    if (slotGlobalId === undefined) return undefined;
    return this.tryGetSlot(slotGlobalId)?.fillRatio(this.wellKnown.volumeId);
  }

  /**
   * 尽きたまま残っている値が今居る段（6.4節）の名前。尽きた値が無ければundefinedで、複数あれば
   * propsの宣言順で最初の1つ。
   *
   * 尽きた瞬間に自分を消すプロパティ（on_shortfallのdestroy、6.3節）は尽きた値のまま静止するので、
   * **世界から出たあとでも「何が尽きて消えたのか」を答えられる**（VitalsSystem.md 6節の死因）。
   */
  exhaustedStage(): string | undefined {
    for (const property of this.properties) {
      const stage = property.exhaustedStage();
      if (stage !== undefined) return stage;
    }
    return undefined;
  }

  /**
   * ゲージとして見せると宣言している（6.8節）プロパティの現在の状態を、propsの宣言順で読み取る。
   * 1つも宣言していないオブジェクトでは空配列。
   *
   * **上下限（range）を持たないプロパティは宣言できない**（ロード時に弾く）ので、返る読み取りの
   * `ratio`は常に定義されている。並ぶ順と本数がそのままカードのバーになる（docs/ui/CardView.md 8節）。
   */
  readGauges(): readonly PropertyReading[] {
    const readings: PropertyReading[] = [];
    for (const property of this.properties) {
      const reading = property.readIfGauge();
      if (reading !== undefined) readings.push(reading);
    }
    return readings;
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
   * 自分を代表しているオブジェクト（represented_by先の最初の子）。represented_by未指定・対象スロット
   * 不存在・空スロットならundefined。1段だけ辿るので、代表がさらに持つ代表は含まない。
   */
  tryGetRepresentative(): WorldObject | undefined {
    if (this.def.representedBySlotGlobalId === undefined) return undefined;
    return this.tryGetSlot(this.def.representedBySlotGlobalId)?.contents.at(0);
  }

  /**
   * interaction/stack判定の代表として採用する、代表チェーンの末端を返す。代表がいなければ自分自身。
   */
  resolveInteractionTarget(): WorldObject {
    return this.tryGetRepresentative()?.resolveInteractionTarget() ?? this;
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

    const represented = this.tryGetRepresentative();
    return represented === undefined ? index : represented.matchRepresentationFrom(expected, index);
  }

  private appendRepresentationChain(chain: number[]): void {
    chain.push(this.def.globalId);
    this.tryGetRepresentative()?.appendRepresentationChain(chain);
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
   * スロット移動を行う唯一の汎用操作（7.1節の`move_to_slot`）。枠の要件・capacityの検証は対象Slot
   * 自身（Slot.canAccept）に委ねる。
   *
   * force=trueは検証を飛ばして必ず配置を成功させる（spawnのフォールバック、9.4節専用）。スロット自体が
   * 存在しない場合はforceでも失敗する。
   *
   * 戻り値: 成功時はundefined、失敗時はその理由。
   */
  moveToSlot(newParent: WorldObject, slotGlobalId: number, force = false): string | undefined {
    return this.attachToSlot(newParent, slotGlobalId, undefined, force);
  }

  /**
   * same_slot専用。置き換えオブジェクトを、originが居たセルを基準に配置する（Slot.placeSameSlot参照）。
   * fixedPositionsで空きが作れず配置できない場合はエラーを返す（＝呼び出し側でfallbackへ委ねる）。
   */
  insertSameSlot(
    newParent: WorldObject,
    slotGlobalId: number,
    placement: SameSlotPlacement,
  ): string | undefined {
    return this.attachToSlot(
      newParent,
      slotGlobalId,
      (slot) => slot.placeSameSlot(this, placement.originCellIndex, placement.kindRemains),
      false,
    );
  }

  /**
   * プレイヤーが隙間を指定して入れる手動配置（Slot.tryInsertAtGap参照）。fixedPositionsのスロットで
   * 既存のセルをずらして場所を作れない場合はエラーを返す。
   */
  moveToSlotAtGap(newParent: WorldObject, slotGlobalId: number, gapIndex: number): string | undefined {
    return this.attachToSlot(newParent, slotGlobalId, (slot) => slot.tryInsertAtGap(this, gapIndex), false);
  }

  /**
   * プレイヤーが空きセルを指定して入れる手動配置（Slot.tryInsertAtCell参照）。fixedPositionsのスロット
   * 専用で、そのセルが空いていない場合はエラーを返す。
   */
  moveToSlotAtCell(newParent: WorldObject, slotGlobalId: number, cellIndex: number): string | undefined {
    return this.attachToSlot(newParent, slotGlobalId, (slot) => slot.tryInsertAtCell(this, cellIndex), false);
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

  /**
   * このスロットへ移れない理由（移れるならundefined）。**移動を提示してよいかを、実際に動かさずに
   * 訊くための入口**——画面はこれを使って、掴んだカードを落とせる場所を決める。
   *
   * 何が移せないかを画面側が場所ごとに覚えていると、ワールド側の宣言と食い違う（設置物のかごを
   * 持ち歩けるようにしたのに、画面がそのレーンを読み取り専用のままにしている、など）。
   */
  rejectionForMoveTo(newParent: WorldObject, slotGlobalId: number, force = false): string | undefined {
    const rejection = this.rejectionBeforeSlot(newParent, slotGlobalId);
    if (rejection !== undefined) return rejection;

    if (force) return undefined;
    return newParent
      .getSlotByLocalId(newParent.def.slotLayout.toLocal(slotGlobalId))
      .canAccept(this, this.wellKnown, newParent.def.name);
  }

  /**
   * 自分に続けてfollowers（同じ束の仲間）を同じスロットへ入れるとき、続けて受け取ってもらえる個数
   * （自分を含む。自分が入らなければ0）。
   *
   * 1つずつrejectionForMoveToを訊いても答えは出ない——2つ目が入るかは1つ目が入った後の空きで
   * 決まるため（Slot.acceptedCount）。**束をまとめて落とす操作が、落とす前に「何枚ついてくるか」を
   * 決めるための問い**で、ついてきた枚数はそのまま「これだけ入る」という約束になる。
   */
  acceptedCountForMoveTo(
    followers: readonly WorldObject[],
    newParent: WorldObject,
    slotGlobalId: number,
  ): number {
    const candidates: WorldObject[] = [];
    for (const candidate of [this as WorldObject, ...followers]) {
      if (candidate.rejectionBeforeSlot(newParent, slotGlobalId) !== undefined) break;
      candidates.push(candidate);
    }
    if (candidates.length === 0) return 0;

    return newParent
      .getSlotByLocalId(newParent.def.slotLayout.toLocal(slotGlobalId))
      .acceptedCount(candidates, this.wellKnown);
  }

  /** 枠の空き（Slot.canAccept）を見るまでもなく移れない理由。移れる個数を数えるときも1つずつ見る。 */
  private rejectionBeforeSlot(newParent: WorldObject, slotGlobalId: number): string | undefined {
    // 入れ物を自分自身や自分の中身の中へ入れると、ツリーから切り離された輪ができる（7.1節）。
    // forceでも許さない——forceが省くのは枠の要件・capacityの判定であって、木構造の不変条件ではない。
    if (this.contains(newParent)) {
      return `'${this.def.name}' を自分自身の中へは入れられません。`;
    }

    // 単独で在れない物は、いったん持ち主に付いたら別の持ち主へは移せない（7.9節）。捻挫は身体から
    // 剥がせないし、道は繋がる土地から外せない。forceでも許さない——枠の要件・capacityの判定ではなく、
    // 「その物がどう存在するか」の不変条件だから。生まれた直後（親を持たない間）の配置は通す。
    if (this.def.boundToOwner && this._parent !== undefined && this._parent !== newParent) {
      return `'${this.def.name}' は '${this._parent.def.name}' から離せません。`;
    }

    if (newParent.def.slotLayout.toLocal(slotGlobalId) === LocalIndexMap.missing) {
      return `'${newParent.def.name}' はスロット(id=${slotGlobalId})を持ちません。`;
    }

    return undefined;
  }

  /**
   * placeは位置を指定する配置（上記のinsertSameSlot・moveToSlotAt*）専用。省略すると通常の追加
   * （Slot.addInternal）になる。
   *
   * **配置を伴う変化の唯一の関門**なので、ここが出入りを記録する（WorldChange）。移動前の居場所は
   * 切り離す前に控える——切り離した後では、どこから来たのかを誰も知らない。
   */
  private attachToSlot(
    newParent: WorldObject,
    slotGlobalId: number,
    place: ((slot: Slot) => boolean) | undefined,
    force: boolean,
  ): string | undefined {
    const rejection = this.rejectionForMoveTo(newParent, slotGlobalId, force);
    if (rejection !== undefined) return rejection;

    const localSlot = newParent.def.slotLayout.toLocal(slotGlobalId);
    const targetSlot = newParent.getSlotByLocalId(localSlot);
    const from = this.currentPlace();

    this.detachFromParent();

    if (place !== undefined) {
      if (!place(targetSlot)) {
        // fixedPositionsで空きが作れず配置できなかった（呼び出し側でfallbackへ）。既に旧親から切り離し済みの
        // ため、この場合は未配置（どこにも属さない）で戻す。
        this.session.recordChange(this, from, undefined);
        return `'${newParent.def.name}.${targetSlot.def.name}' に指定した位置の空きがありません。`;
      }
    } else {
      targetSlot.addInternal(this);
    }

    this.session.recordChange(this, from, { parent: newParent, slotGlobalId });
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
   *
   * **中身は道連れにしない。** 単独で在れる子（bound_to_ownerでない子、7.9節）は、消える自分ではなく
   * 自分の親——子から見た祖父——へこぼれ出す。治った怪我に当てていた包帯が消えてしまわないように、
   * 壊れた籠の中身が地面に散らばるように。
   */
  destroy(): void {
    this.spillContentsTo(this._parent);
    const from = this.currentPlace();
    this.detachFromParent();
    this.session.recordChange(this, from, undefined);
  }

  /** 今の居場所（WorldChange）。どこにも属していなければundefined。 */
  private currentPlace(): WorldPlace | undefined {
    if (this._parent === undefined) return undefined;
    return {
      parent: this._parent,
      slotGlobalId: this._parent.getSlotByLocalId(this._parentSlotLocalId).def.globalId,
    };
  }

  /**
   * 消えるときに中身を送り出す（destroy参照）。単独で在れない子（怪我・液体・道）は送り出さず、
   * 自分にぶら下がったまま道連れにする——ただしその子の中身については同じことを行う（怪我が治れば、
   * 当てていた包帯は身体の親である土地へこぼれる）。
   *
   * 行き先が受け入れられなくても押し込む（force）。既に世界に在る物なので、置き場所が無いことを
   * 理由に消すわけにはいかない（spawnの伝播と同じ扱い、9.4節）。
   */
  private spillContentsTo(destination: WorldObject | undefined): void {
    for (const slot of this.slots) {
      for (const child of [...slot.contents]) {
        if (child.def.boundToOwner) child.spillContentsTo(destination);
        else if (destination !== undefined) child.moveIntoFirstAcceptingSlot(destination, true);
      }
    }
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
   *   自分の volume × density が自分の重さになる（mL × g/mL = g。換算定数は要らない）。
   * - load: 担いだ人が感じる負荷。直接の子の weight に、その子の load_reduction_rate（率）を効かせた分だけ。
   *
   * 率をスロットではなく子（アイテム）が持つのは、同じ入れ物でも背負うか手に提げるかで体感が変わるため
   * （ContainerSystem.md 2節）。
   */
  containerContributionTo(propertyGlobalId: number): number {
    const wellKnown = this.wellKnown;
    if (propertyGlobalId === wellKnown.weightId) {
      let sum = this.def.isQuantitative
        ? this.getNumber(wellKnown.volumeId) * this.getNumber(wellKnown.densityId, 1)
        : 0;
      for (const slot of this.slots) for (const child of slot.contents) sum += child.effectiveWeight();
      return sum;
    }

    if (propertyGlobalId === wellKnown.loadId) {
      let sum = 0;
      for (const slot of this.slots) {
        for (const child of slot.contents) {
          // 1で「まったく感じない」。1を超える宣言は0扱いにするが、負の値は通す——抱えにくい物を
          // 「実際より重く感じる」向きへ書けるようにするため。
          const rate = Math.min(child.getEffectiveValue(wellKnown.loadReductionRateId), 1);
          sum += child.effectiveWeight() * (1 - rate);
        }
      }
      return sum;
    }

    return 0;
  }

  /**
   * 中身と、量的オブジェクトなら自分の量を含めた重さ。weightプロパティを宣言していないオブジェクトでも、
   * 中身の重さは上へ伝わる（液体は volume × density が重さなので、weightを宣言する必要が無い）。
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

  /**
   * 自分自身を含む子孫から、その型のインスタンスを探す（深さ優先、無ければundefined）。
   * 世界にただ1つ在る型（`singleton`、15節）を名前で指す`move`の`to_object`（9.6節）が使う。
   * 同じ型が複数在れば最初に見つかったものを返す。
   */
  findDescendantOfDef(objectDefGlobalId: number): WorldObject | undefined {
    if (this.def.globalId === objectDefGlobalId) return this;

    for (const slot of this.slots) {
      for (const child of slot.contents) {
        const found = child.findDescendantOfDef(objectDefGlobalId);
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
  moveIntoFirstAcceptingSlot(target: WorldObject, force = false, session?: WorldSession): boolean {
    for (const slotDef of target.def.enumerateAutoPlacementSlotDefs()) {
      if (this.def.isQuantitative && !force && session !== undefined) {
        if (this.pourVolumeInto(target, slotDef.globalId, session)) return true;
        continue;
      }
      if (this.moveToSlot(target, slotDef.globalId, force) === undefined) return true;
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
  private pourVolumeInto(target: WorldObject, slotGlobalId: number, session: WorldSession): boolean {
    if (target === this || this.contains(target)) return false;

    const localSlot = target.def.slotLayout.toLocal(slotGlobalId);
    if (localSlot === LocalIndexMap.missing) return false;
    const slot = target.getSlotByLocalId(localSlot);

    const wellKnown = this.wellKnown;
    const available = this.getNumber(wellKnown.volumeId);
    if (available <= 0) return false;

    const merged = slot.findVolumeMergeTarget(this);
    // 合流先が無いときだけ、新しいインスタンスを置ける枠があるかを問う（既にいるなら枠は増えない）。
    if (merged === undefined && !slot.acceptsByRule(this)) return false;

    const amount = Math.min(available, slot.remainingCapacity(wellKnown.volumeId));
    if (amount <= 0) return false;

    if (merged !== undefined) {
      merged.setNumber(wellKnown.volumeId, merged.getNumber(wellKnown.volumeId) + amount, session);
    } else {
      const born = session.spawn(this.def.globalId);
      born.setNumber(wellKnown.volumeId, amount, session);
      if (born.moveToSlot(target, slotGlobalId) !== undefined) return false;
    }

    // 注ぎ切って量が尽きた移し元は、setNumberの中で自分を畳む（settleChangedVolume）。
    this.setNumber(wellKnown.volumeId, available - amount, session);

    return true;
  }

  /**
   * 親子のエッジが形成/解消された契機を、双方の効果（modify/add、8節）へ伝える（register=trueで登録、
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

  /** 現在このプロパティに登録されている全寄与（modify/add両方）。UI表示用。各効果が現在いくら効いているかはRegisteredPassiveEffect.activeAmountで得られる。 */
  getIncomingPassiveEffects(propertyGlobalId: number): readonly RegisteredPassiveEffect[] {
    const property = this.tryGetProperty(propertyGlobalId);
    return property !== undefined ? property.incoming : [];
  }

  /**
   * 名指しした1つのプロパティが、他と交わしている影響（docs/ui/Windows.md 8節）。
   *
   * 集めるのは**自分・自分の祖先・自分の子孫**が宣言する持続効果だけでよい。効果が届く先は
   * self/parent/child/ancestor のいずれか（8.1節）なので、自分へ届く効果も自分が届かせる効果も、
   * 宣言元は必ずこの3方向のどれかに居る——横に並んだ物どうしは互いに届かない。
   */
  readInfluences(propertyGlobalId: number): PropertyInfluenceReading {
    const influences = new PropertyInfluences(this, propertyGlobalId);
    this.collectInfluencesRecursively(influences);
    for (let ancestor = this._parent; ancestor !== undefined; ancestor = ancestor._parent)
      ancestor.def.passives.collectInfluences(ancestor, influences);
    this.collectContainerInfluence(propertyGlobalId, influences);
    return influences;
  }

  /**
   * 中身から受ける寄与（weight/load、ContainerSystem.md 1〜2節）を1本の辺として書き出す。
   *
   * 持続効果ではないが、**読むたびに導出される可逆な押し上げ**なので modify と同じ形になる。
   * 中身1つずつではなく1本にまとめるのは、担いでいる物の数だけ辺が増えても、読み手が知りたい
   * 「何がこの値を押し上げているか」の答えは「中身」の1つだからで、宣言元は自分自身になる。
   */
  private collectContainerInfluence(propertyGlobalId: number, out: InfluenceWriter): void {
    const { weightId, loadId } = this.wellKnown;
    if (propertyGlobalId !== weightId && propertyGlobalId !== loadId) return;

    out.write({
      causeObject: this,
      causePropertyGlobalId: undefined,
      target: this,
      targetPropertyGlobalId: propertyGlobalId,
      reversible: true,
      increases: true,
      // 空身なら押し上げていない（条件が成立していない効果と同じ扱いで、薄く記号無しになる）。
      active: this.containerContributionTo(propertyGlobalId) !== 0,
    });
  }

  /** 自分と、自分の中に入っている物すべてが宣言する持続効果の辺を書き出す。 */
  private collectInfluencesRecursively(out: InfluenceWriter): void {
    this.def.passives.collectInfluences(this, out);
    for (const child of this.children()) child.collectInfluencesRecursively(out);
  }

  /**
   * 持続効果の対象（8.1節）を、影響の一覧のために解決する。**childは今入っている子を全部**返す
   * ——相手が1つに定まらない唯一の対象で、寄与も子ごとに1件ずつ登録される（registerChild）。
   * actor/draggedはpassivesに現れない（parsePassiveTransfers）ため空になる。
   */
  resolveInfluenceTargets(root: ReferenceRoot, propertyGlobalId: number): readonly WorldObject[] {
    if (root === 'child') return [...this.children()];
    const target = this.resolveEffectTargetOrAncestor(root, propertyGlobalId, undefined, undefined);
    return target === undefined ? [] : [target];
  }

  tryExecuteAction(actionName: string, actor: WorldObject | undefined, session: WorldSession): boolean {
    return this.def.tryExecuteAction(this, actor, actionName, session);
  }

  /**
   * actionNameを今実行できない理由（最初に落ちた要件、14節）。実行できるならundefined。
   * ボタンを押せなくし、押せない理由を見せるために使う。
   */
  actionUnmetRequirement(actionName: string, actor: WorldObject | undefined): Requirement | undefined {
    return this.def.actionUnmetRequirement(this, actor, actionName);
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
   * 全プロパティのtick処理（passivesのaddの反映とrangeイベント判定、PropertyValue.tick参照）を行った後、子
   * （すべてのスロットの中身）へ再帰する。すべてのオブジェクトはworldの下にぶら下がるため、worldへ1回呼ぶだけで
   * ツリー全体が処理される。
   *
   * rangeイベントのdestroy/spawnは処理中に自分自身や兄弟をツリーから切り離しうるため、各スロットの中身は
   * 列挙前にスナップショットを取る。
   */
  tick(session: WorldSession): void {
    for (const property of this.properties) property.tick(session);
    // 輸送は、この物のプロパティが積分され切ってから走らせる（8.4節）。
    this.def.passives.applyTickTransfers(this, session);

    for (const slot of this.slots) {
      for (const child of [...slot.contents]) child.tick(session);
    }

    if (this.def.isQuantitative) this.settleVolume(session);
  }

  /**
   * 量的オブジェクト（7.6節）の量を、passivesのaddが動かしたあとの不変条件へ戻す。どちらもスロットの
   * 上限・量の下限という、YAMLの著者ではなくエンジンが持つ約束事なので、各液体に宣言を書かせない。
   *
   * - 「volumeが正であること」と「インスタンスが存在すること」が同値: 量が尽きたら消える（蒸発）。
   * - 中身の量の合計はcapacityを超えない（7.3節）: あふれた分は失われる（降雨）。moveは移し元に
   *   残す（9.6節）が、こちらは移し元が無いため捨てるほかない。
   */
  private settleVolume(session: WorldSession): void {
    const volumeId = session.codex.wellKnown.volumeId;
    const volume = this.getNumber(volumeId);
    if (volume <= 0) {
      this.destroy();
      return;
    }

    if (this._parent === undefined) return;
    const overflow = this._parent.getSlotByLocalId(this._parentSlotLocalId).overflowingVolume(volumeId);
    if (overflow > 0) this.setNumber(volumeId, Math.max(0, volume - overflow), session);
  }

  /**
   * このオブジェクトをselfとして、set/add/destroy/spawnを実行する（9.2〜9.4節）。rangeイベント（6節）と
   * actions/combinations（11節・12節）の両方から呼ばれる（rangeイベント経由ではactor/draggedはundefined）。
   * 対象が解決できない場合（parentが無い、actor/draggedがこの実行文脈に無い）は、その対象への適用のみ無視する。
   *
   * destroyをspawnより先に行う（9.3節・9.4節）: 置き換え後のオブジェクトが破棄されるオブジェクトの位置を
   * 引き継げるよう、destroyで実際に位置が空いてから通常の（force無しの）配置を行う。
   *
   * **ここが「誰の仕業か」の境界**でもある。この中で起きた物の出入りは、すべてselfを主体として記録される
   * （WorldChange.subject）。どの`pick`の候補が選ばれたかによらず1つに決まるので、観測する側は分岐を
   * 知らずに「このオブジェクトが何をしたか」を読める。
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
    session.withSubject(this, () => effect.apply(this, session, actor, dragged, effectSite));
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
   * spawn（9.4節）を実行する。intoへの配置に失敗した場合は起点自身の親へ伝播し、枠の要件・capacityを無視して
   * 強制配置する（place参照）。伝播先の親も無ければ、生成したオブジェクトはworldツリーに繋がらないまま消える。
   */
  executeSpawn(
    effect: SpawnEffect,
    session: WorldSession,
    actor: WorldObject | undefined,
    effectSite: EffectSite | undefined,
  ): void {
    const spawned = session.spawn(effect.objectGlobalId);
    this.place(spawned, effect.into, session, actor, effect.into === 'same_slot' ? effectSite : undefined);
  }

  /**
   * spawnした側は配置先のスロット名を書かない。same_slotなら捕捉しておいた位置へ配置する
   * （EffectSite.placeReplacementへ委ねる）。self/actor/childなら対象のスロットを宣言順に走査し、最初に配置できた
   * スロットへ入れる。配置に失敗した場合は起点自身の親へ伝播し、枠の要件・capacityを無視して強制配置する。
   * 伝播先の親も無ければ何もしない。
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
      placed = site.placeReplacement(spawned);
    } else if (into === 'child') {
      // 受け取れる子が居なければselfの親へ伝播させる（＝持ちきれない物は地面に落ちる、と同じ扱い）。
      primaryTarget = this; // eslint-disable-line @typescript-eslint/no-this-alias -- 伝播先の起点として使うだけ
      placed = this.tryFirstAcceptingChild(spawned, session);
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

  /**
   * 自分の子を順に走査し、最初に受け取れた子のスロットへ入れる（into: child、9.4節）。子のどのスロットが
   * 受け取るかは通常の走査に委ねるため、著者は「どの子か」も「どのスロットか」も書かない。
   */
  private tryFirstAcceptingChild(spawned: WorldObject, session: WorldSession): boolean {
    for (const child of this.children()) {
      if (WorldObject.tryFirstAcceptingSlot(spawned, child, session, false)) return true;
    }
    return false;
  }

  /** targetのスロットを宣言順に走査し、最初に配置できたスロットへ入れる（moveIntoFirstAcceptingSlot参照）。 */
  private static tryFirstAcceptingSlot(
    spawned: WorldObject,
    target: WorldObject,
    session: WorldSession,
    force: boolean,
  ): boolean {
    return spawned.moveIntoFirstAcceptingSlot(target, force);
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
 * スロットの状態から行う（originKindRemains参照）。1つの効果が複数のオブジェクトを生む場合、2個目以降の位置も
 * ここが決めるため（placeReplacement）、置いた場所を覚えている。
 */
export class EffectSite {
  readonly parent: WorldObject;
  readonly parentSlotLocalId: number;

  /** 捕捉時にself(origin)が属していたObjectStack。 */
  private readonly originStack: ObjectStack;

  /** 捕捉時のoriginStackのセル位置。空セルが除去される非fixedPositionsでは、同種が消えた後はindexOfStackで引けなくなるため捕捉値が要る。 */
  private readonly stackIndexAtCapture: number;

  /** 次の1つを「その隣」へ並べる基準になるスタック。直前にセルを消費して置いた置き換えオブジェクトが入る（まだ誰も消費していなければundefined＝originの位置が基準）。 */
  private anchorStack: ObjectStack | undefined;

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
   * 置き換えオブジェクトをoriginが居た位置へ配置する（Slot.placeSameSlot参照）。1つの効果が複数のオブジェクトを
   * 生む場合、位置を引き継ぐのは新しいセルを要る最初の1つで、以降はその隣へ続けて並ぶ。空いた1つのセルを
   * 取り合わせると、2個目以降は置き場所を失ってfallbackで外へこぼれてしまうため（ヤシの実の皮がアイテム
   * レーンへ落ちる）。
   *
   * 戻り値: 配置できたらtrue。falseなら呼び出し側がfallbackへ委ねる。
   */
  placeReplacement(spawned: WorldObject): boolean {
    const slot = this.parent.getSlotByLocalId(this.parentSlotLocalId);
    const placed =
      spawned.insertSameSlot(this.parent, slot.def.globalId, this.nextPlacement(slot)) === undefined;

    // 既存スタックへ合流したもの（findOwnStackがundefined）はセルを消費しないため基準にしない——originの
    // 位置はまだ誰も引き継いでおらず、次の1つのために空けておく。配置に失敗したものも同じ扱いになる。
    const ownStack = placed ? slot.findOwnStack(spawned) : undefined;
    if (ownStack !== undefined) this.anchorStack = ownStack;

    return placed;
  }

  /** 次の置き換えオブジェクトの置き場所。基準になるスタックが居れば「その隣」＝同種が残っている場合と同じ扱いになる。 */
  private nextPlacement(slot: Slot): SameSlotPlacement {
    if (this.anchorStack !== undefined) {
      return new SameSlotPlacement(slot.indexOfStack(this.anchorStack), true);
    }
    return new SameSlotPlacement(this.originCellIndex(slot), this.originKindRemains);
  }

  /**
   * 元のスタックにoriginと同種がまだ残っているか（selfが生き残る／同種の兄弟が残る）。残っていれば置き換え
   * オブジェクトは隣へ、残っていなければ空いたその位置をそのまま引き継ぐ。判定は在庫（members.length）で行う
   * ——「その位置が同種を受け入れられるか」ではない。空になったセルも同種を受け入れ可能だが、位置は引き継ぐ
   * べきだから。
   */
  private get originKindRemains(): boolean {
    return this.originStack.members.length > 0;
  }

  /** originが居たセルの位置。同種が残っていればoriginStackの現在位置、消えていれば捕捉時の位置。 */
  private originCellIndex(slot: Slot): number {
    return this.originKindRemains ? slot.indexOfStack(this.originStack) : this.stackIndexAtCapture;
  }
}
