import type { ActiveEffect, SpawnEffect, SpawnTargetRoot } from './ActiveEffect';
import { Action, Combination } from './Interaction';
import { EffectSite } from './EffectSite';
import type { SameSlotPlacement } from './EffectSite';
import { LocalIndexMap } from './LocalIndexMap';
import type { ObjectDef } from './ObjectDef';
import type { ReferenceRoot } from './ReferenceRoot';
import type { WellKnownProperties } from './WellKnownProperties';
import type { InfluenceWriter, PropertyInfluenceReading } from './PropertyInfluence';
import { PropertyInfluences } from './PropertyInfluence';
import { IN_PROGRESS_TAG } from './RecipeDef';
import type { PropertyDef } from './PropertyDef';
import { PropertyValue } from './PropertyValue';
import { Slot } from './Slot';
import type { WorldPlace } from './WorldChange';
import type { WorldSession } from './WorldSession';

/** rangeを持つプロパティなら、その両端へ丸めた値。rangeが無ければそのまま（becomeType参照）。 */
function clampToRange(def: PropertyDef, value: number): number {
  const range = def.range;
  return range === undefined ? value : Math.min(range.max, Math.max(range.min, value));
}

/**
 * 実行時のオブジェクト実体（ObjectDefのインスタンス）。
 *
 * プロパティの現在値・スロットの中身は、Def側のローカルIDをそのままindexとする密配列として保持する。
 * プロパティへ登録された効果の一覧・tick毎の反映・実効値の算出・値を変えた後のrange判定はPropertyValueが
 * 持ち、WorldObjectはローカルID解決とグローバルAPIの提供に専念する。move_to_slotによる所属先の差し替え
 * （旧親からの離脱・新親への合流・weight伝播・passive effect edgeの登録）にも専念し、枠の要件・capacityの
 * 検証は対象Slot自身へ委ねる。持続効果（modify/add）の登録・解除は、生成・エッジ形成/解消・トポロジ変化の
 * 契機で、Defが宣言する効果一式（PassiveEffects）へ「登録/解除してほしい」と依頼するだけで、どのtargetが
 * どこへ紐付くかは効果自身が知る。能動効果（set/add/destroy/spawn/transfer・actions/combinations・tick）は、
 * 適用の入口（applyActiveEffect）と対象解決、same_slot spawnの位置捕捉（EffectSite）・配置（place）を持つが、
 * 値の変更そのものは対象のPropertyValueへ、条件判定・抽選はDef側の効果へ委ねる。
 *
 * **セッションは自分で持つ。** 何かを頼む側がWorldSessionを渡すことはない（sessionフィールド参照）。
 */
export class WorldObject {
  readonly instanceId: number;

  /** 今の型。becomeType（9.9節）だけが差し替える——同じ個体のまま型だけが変わる。 */
  private _def: ObjectDef;
  get def(): ObjectDef {
    return this._def;
  }

  // ローカルindexで並ぶ密配列。それぞれdef.propertyDefs / def.slotDefsと対になる。
  private properties: PropertyValue[];
  private slots: Slot[];

  /** 所属先（7.1節）。ルート（未格納）ならundefined。 */
  private _parent: WorldObject | undefined;
  get parent(): WorldObject | undefined {
    return this._parent;
  }

  /**
   * 今自分が入っている枠（7.1節）。どこにも入っていなければundefined。
   *
   * **親の中での位置を、親のローカルIDでは持たない。** ローカルIDはそのオブジェクトの中でしか意味を
   * 持たない値で、他人の番号を控えると、控えた側が「誰の番号か」を覚えている必要がある。
   */
  private _parentSlot: Slot | undefined;
  get parentSlot(): Slot | undefined {
    return this._parentSlot;
  }

  /**
   * このオブジェクトが生きるセッション。**生成したセッションと、その後この物が居るセッションは同じ**
   * ——だからこの物へ何かを頼む側は、セッションを渡さない。配置の関門（attachToSlot・destroy）も、
   * プロパティの値の変更（PropertyValue.add）も、ここから辿って自分で記録・判定する。
   */
  readonly session: WorldSession;

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
    const wipTagId = this.session.codex.tagNames.tryGetId(IN_PROGRESS_TAG);
    return wipTagId !== undefined && this._def.tags.includes(wipTagId);
  }

  /** sessionは必須（value:{min,max}を持つプロパティの初期値ランダム化にsession.rngを使う）。 */
  constructor(instanceId: number, def: ObjectDef, session: WorldSession) {
    this.instanceId = instanceId;
    this._def = def;
    this.session = session;

    this.properties = def.enumeratePropertyDefs().map((pd) => new PropertyValue(pd, this));
    this.slots = def.enumerateSlotDefs().map((sd) => new Slot(sd));

    // 生成時はまだトポロジが無いため、Self関係のみ登録する。Parent/Child/Ancestorはmove_to_slot以降に登録される。
    def.passives.registerRelation(this, 'self', true);
  }

  tryGetSlot(globalSlotId: number): Slot | undefined {
    const local = this.def.slotLayout.toLocal(globalSlotId);
    if (local === LocalIndexMap.missing) return undefined;
    return this.slots[local];
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

  private setParent(parent: WorldObject | undefined, parentSlot: Slot | undefined): void {
    this._parent = parent;
    this._parentSlot = parentSlot;
  }

  tryGetProperty(globalPropertyId: number): PropertyValue | undefined {
    const local = this.def.propertyLayout.toLocal(globalPropertyId);
    if (local === LocalIndexMap.missing) return undefined;
    return this.properties[local];
  }

  /**
   * tryGetPropertyと同じ引き方で、持っていないことを許さない版。**その型が必ず持っているはずの
   * プロパティ**——生成が書き込む行き先ID、シナリオが名指しする値——を引くときに使う。名前の綴り違いが
   * 黙って無視されず、書いた場所で分かる。
   */
  getProperty(globalPropertyId: number): PropertyValue {
    const property = this.tryGetProperty(globalPropertyId);
    if (property === undefined) {
      throw new Error(`'${this.def.name}' はプロパティ(id=${globalPropertyId})を持ちません。`);
    }
    return property;
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

  /**
   * itemを自分の中へ入れるなら、どの枠か（GameElementDefinition.md 7.8節）。プレイヤーが手で入れられる
   * 枠（`placement: manual`、7.7節）のうち、**宣言順で最初に今itemを受け取れるもの**。どこにも入らな
   * ければundefined。
   *
   * 型が合うかではなく今入るかで選ぶので、先の枠が埋まっていれば次の枠が答えになる。**今itemが居る枠は
   * 答えない**——同じ枠へ入れ直すのは入れる操作ではない。
   */
  putInSlotFor(item: WorldObject): number | undefined {
    const from = item.parent === this ? item.parentSlot : undefined;
    return this.def
      .placementSlotDefs('manual')
      .find(
        (slotDef) => slotDef !== from?.def && item.rejectionForMoveTo(this, slotDef.globalId) === undefined,
      )?.globalId;
  }

  /**
   * 入れ物としての詰まり具合（0〜1）。入れ物として名乗っていない型（`storage`、7.12節）と、
   * 上限（capacity）を持つスロットが1つも無い型ではundefined。
   *
   * **最も詰まっているスロットを返す。** バーが答えるのは「あとどれだけ入るか」なので、先に一杯に
   * なる側を映す——合計で割ると、片方が満杯でも半分に見える。
   *
   * fillRatioInParentSlotと表裏で、こちらは入れ物の側から自分の詰まり具合を見る。
   */
  storageFillRatio(): number | undefined {
    if (!this.def.isStorage) return undefined;

    let fullest: number | undefined;
    for (const slotDef of this.def.slotDefs) {
      const ratio = this.tryGetSlot(slotDef.globalId)?.fillRatio(this.wellKnown.volumeId);
      if (ratio !== undefined) fullest = Math.max(fullest ?? 0, ratio);
    }
    return fullest;
  }

  /**
   * 尽きたまま残っている値が今居る段（6.4節）の名前。尽きた値が無ければundefinedで、複数あれば
   * propsの宣言順で最初の1つ。
   *
   * 尽きた瞬間に自分を消すプロパティ（on_minのdestroy、6.3節）は尽きた値のまま静止するので、
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
   * ゲージとして見せると宣言している（6.8節）プロパティを、propsの宣言順で。1つも宣言していない
   * オブジェクトでは空配列。
   *
   * **上下限（range）を持たないプロパティは宣言できない**（ロード時に弾く）ので、返る値の
   * `ratio`は常に定義されている。並ぶ順と本数がそのままカードのバーになる（docs/ui/CardView.md 8節）。
   */
  gaugeProperties(): readonly PropertyValue[] {
    return this.properties.filter((property) => property.def.gauge !== undefined);
  }

  /**
   * 指定したタグ（6.7節）が付いたプロパティを、propsの宣言順で。タグの付いたプロパティを
   * 1つも持たないオブジェクトでは空配列。
   */
  propertiesWithTag(tagGlobalId: number): readonly PropertyValue[] {
    return this.properties.filter((property) => property.def.hasTag(tagGlobalId));
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
    const slot = this._parentSlot;
    if (slot === undefined) return false;

    const stack = slot.findStackContaining(this);
    return stack !== undefined && slot.tryMoveStackToGap(stack, gapIndex);
  }

  /**
   * プレイヤーによる手動並び替えのうち、行き先を空きセルで指定するもの（Slot.trySetManualPosition参照）。
   * fixedPositionsのスロット専用。
   */
  moveToCellInParentSlot(cellIndex: number): boolean {
    const slot = this._parentSlot;
    if (slot === undefined) return false;

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
    // rejectionBeforeSlotがスロットの存在を確かめた後なので、ここでは必ず引ける。
    return newParent.tryGetSlot(slotGlobalId)!.canAccept(this, this.wellKnown, newParent.def.name);
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

    return newParent.tryGetSlot(slotGlobalId)!.acceptedCount(candidates, this.wellKnown);
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

    const targetSlot = newParent.tryGetSlot(slotGlobalId)!;
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
    this.setParent(newParent, targetSlot);
    this.registerEdgeWith(newParent, true);
    // 祖先対象の登録は、新しい親チェーンが確定した後に行う（detachFromParentでの解除と対、
    // registerAncestorTargetedRecursively参照）。
    this.registerAncestorTargetedRecursively(true);

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
    if (this._parent === undefined || this._parentSlot === undefined) return undefined;
    return { parent: this._parent, slotGlobalId: this._parentSlot.def.globalId };
  }

  /**
   * axisValuesで指した座標に居る型へ、同じ個体のまま変わる（9.9節）。行き先に型が居なければ何もしない。
   */
  becomeAlong(axisValues: ReadonlyMap<string, string>): void {
    const destination = this.session.codex.tryResolveBecome(this._def, axisValues);
    if (destination !== undefined) this.becomeType(destination);
  }

  /** その座標に型が居るか。居なければ、becomeを宣言した操作そのものが成立しない（9.9節）。 */
  canBecomeAlong(axisValues: ReadonlyMap<string, string>): boolean {
    return this.session.codex.tryResolveBecome(this._def, axisValues) !== undefined;
  }

  /**
   * 同じ個体のまま型だけを差し替える（9.9節）。instanceIdも居場所も変わらず、変わるのは型と、そこから
   * 決まるプロパティ・スロットの顔ぶれだけ。
   *
   * - 同じ名前のプロパティは値を引き継ぐ。新しいrangeから外れる値はクランプするだけで、range系イベント
   *   （6.3節）は起こさない——器が変わったのは値の出来事ではない。
   * - 同じ名前のスロットは中身をそのまま引き継ぐ。**新しい型が持たないスロットの中身は親へこぼれる**
   *   （destroyと同じ規則、9.3節）。
   *
   * 登録済みの持続効果は、組み直す前にすべて解除して新しいdefで登録し直す——解除は宣言元のdefを辿るので、
   * 先に差し替えると外し先を見失う。
   */
  private becomeType(newDef: ObjectDef): void {
    if (newDef === this._def) return;

    // 新しい型のスロットを先に組み、中身を宣言順に配ってみる。**受け取れなかった中身は、まだ全部が
    // 噛み合っているこの時点で送り出す**——旧スロットがまだ現役なので、どこから出たかも普段どおり残る。
    const newSlots = newDef.enumerateSlotDefs().map((slotDef) => new Slot(slotDef));
    const rehomed: Array<{ child: WorldObject; slot: Slot }> = [];
    for (const slot of this.slots) {
      const slotLocalId = newDef.slotLayout.toLocal(slot.def.globalId);
      for (const child of [...slot.contents]) {
        const destination = slotLocalId === LocalIndexMap.missing ? undefined : newSlots[slotLocalId];
        if (
          destination === undefined ||
          destination.canAccept(child, this.wellKnown, newDef.name) !== undefined
        ) {
          this.evict(child);
          continue;
        }
        destination.addInternal(child);
        rehomed.push({ child, slot: destination });
      }
    }

    const parent = this._parent;

    this.registerAncestorTargetedRecursively(false);
    this._def.passives.registerRelation(this, 'self', false);
    if (parent !== undefined) this.registerEdgeWith(parent, false);
    for (const { child } of rehomed) child.registerEdgeWith(this, false);

    const carriedValues = new Map<number, number>();
    for (const property of this.properties) carriedValues.set(property.def.globalId, property.number);

    this._def = newDef;
    this.properties = newDef.enumeratePropertyDefs().map((pd) => new PropertyValue(pd, this));
    this.slots = newSlots;
    for (const { child, slot } of rehomed) child.setParent(this, slot);

    for (const property of this.properties) {
      const carried = carriedValues.get(property.def.globalId);
      if (carried !== undefined) property.init(clampToRange(property.def, carried));
    }

    this._def.passives.registerRelation(this, 'self', true);
    if (parent !== undefined) this.registerEdgeWith(parent, true);
    for (const { child } of rehomed) child.registerEdgeWith(this, true);
    this.registerAncestorTargetedRecursively(true);

    // 型が変われば同種の判定も変わる（7.6節）ので、所属スタックを判定し直させる。
    this._parentSlot?.restack(this);
  }

  /**
   * 新しい型が受け取れなかった中身を送り出す（becomeType参照）。行き先はdestroyのこぼし先と同じ
   * 自分の親で、単独で在れない子（7.9節）は移せる先が無いのでそこで失われる。
   */
  private evict(child: WorldObject): void {
    if (child.def.boundToOwner || this._parent === undefined) child.destroy();
    else child.moveIntoFirstAcceptingSlot(this._parent, true);
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
    const oldSlot = this._parentSlot;
    if (oldParent === undefined || oldSlot === undefined) return;

    // 祖先対象の登録解除は、トポロジが変わる前（旧祖先がまだ辿れるうち）に行う（registerAncestorTargetedRecursively
    // 参照。再登録はattachToSlot側）。
    this.registerAncestorTargetedRecursively(false);

    oldSlot.removeInternal(this);
    this.registerEdgeWith(oldParent, false);
    this.setParent(undefined, undefined);
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
      // 中身入りの変種は、抱えている量ぶんだけ自分が重い（fill × density = mL × g/mL = g）。
      // 空の容器はfillを持たないので0になり、器の自重だけが残る。
      let sum =
        (this.tryGetProperty(wellKnown.fillId)?.number ?? 0) *
        (this.tryGetProperty(wellKnown.densityId)?.number ?? 1);
      for (const slot of this.slots) for (const child of slot.contents) sum += child.effectiveWeight();
      return sum;
    }

    if (propertyGlobalId === wellKnown.loadId) {
      let sum = 0;
      for (const slot of this.slots) {
        for (const child of slot.contents) {
          // 1で「まったく感じない」。1を超える宣言は0扱いにするが、負の値は通す——抱えにくい物を
          // 「実際より重く感じる」向きへ書けるようにするため。
          const rate = Math.min(
            child.tryGetProperty(wellKnown.loadReductionRateId)?.getEffectiveValue() ?? 0,
            1,
          );
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
  private effectiveWeight(): number {
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
    return this._parent === undefined ? this : this._parent.findRoot();
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
   * targetの自動配置スロット（ObjectDef.placementSlotDefs）を宣言順に走査し、最初に受け入れられた
   * スロットへ自分自身を移動する（著者がスロット名を知らなくてよい規約。spawnのintoとmoveが共用、
   * 9.4節）。force=trueは受け入れ判定を飛ばすため、自動配置スロットが1つでもあれば必ず成功する。
   *
   * **札を重ねたドロップ（putInSlotFor）と同じ規約の、別の入口。** 走査する枠の並びは1箇所が
   * 答える（placementSlotDefs）。
   */
  moveIntoFirstAcceptingSlot(target: WorldObject, force = false): boolean {
    for (const slotDef of target.def.placementSlotDefs('auto'))
      if (this.moveToSlot(target, slotDef.globalId, force) === undefined) return true;

    return false;
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

  /**
   * actorがこのカードへ起こせる操作（11節、宣言順）。画面のボタンに出すかは呼び出し側が
   * showMenuで絞る（11.1節）。
   */
  actionsFor(actor: WorldObject | undefined): readonly Action[] {
    return this.def.actions.map((action) => new Action(action, this, actor));
  }

  /** 名指しした操作（宣言が無ければundefined）。土地のexplore・道のtravel・動物の1手が使う。 */
  tryGetAction(actionName: string, actor: WorldObject | undefined): Action | undefined {
    const action = this.def.actions.find((a) => a.name === actionName);
    return action === undefined ? undefined : new Action(action, this, actor);
  }

  /**
   * draggedを重ねたときに**今**成立する組み合わせ（12節、宣言順）。相手として受け入れるかだけでなく、
   * 要件（14節）を満たしているかまで見る——満杯の炉に薪をくべる組み合わせは、候補にならない。
   *
   * **要件まで見るのは、候補を選ぶ側と実行できる側を食い違わせないため。** 型だけで選ぶと、選んだ
   * 先が実行できない場合に「落とせるのに何も起きない」になる。**行き先の座標に型が居ない組み合わせ**
   * （`become`、9.9節）も同じ理由で候補にならない。
   *
   * **作りかけの物は相手にならない。** 製作中オブジェクトは完成品のタグを引き継ぐ
   * （RecipeSystem.md 5節）ので、弾かなければ半分できた石斧で木を伐り、獣を殴れてしまう
   * ——引き継ぎは枠のacceptへ入れるためのもので、道具として働けることまでは意味しない。
   */
  combinationsWith(dragged: WorldObject, actor: WorldObject | undefined): readonly Combination[] {
    if (dragged.isInProgress) return [];
    return this.def.combinations
      .filter(
        (c) =>
          c.matches(dragged.def) &&
          c.unmetRequirement(this, dragged, actor) === undefined &&
          c.acceptedCount(this, [dragged], actor) >= 1 &&
          !c.unresolvable(this, dragged, actor),
      )
      .map((c) => new Combination(c, this, dragged, actor));
  }

  /**
   * 全プロパティのtick処理（passivesのaddの反映とrangeイベント判定、PropertyValue.tick参照）を行った後、子
   * （すべてのスロットの中身）へ再帰する。すべてのオブジェクトはworldの下にぶら下がるため、worldへ1回呼ぶだけで
   * ツリー全体が処理される。
   *
   * rangeイベントのdestroy/spawnは処理中に自分自身や兄弟をツリーから切り離しうるため、各スロットの中身は
   * 列挙前にスナップショットを取る。
   */
  tick(): void {
    for (const property of this.properties) property.tick();
    // 輸送は、この物のプロパティが積分され切ってから走らせる（8.4節）。
    this.def.passives.applyTickTransfers(this, this.session);

    for (const slot of this.slots) {
      for (const child of [...slot.contents]) child.tick();
    }
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
    actor: WorldObject | undefined,
    dragged: WorldObject | undefined,
  ): void {
    // same_slot spawnのために「selfが今占めている位置」を、まだ何も起きていないこの入口で捕捉する。destroyが
    // selfを消した後でも、spawnはこのアンカーと配置時のスロットの状態から置き換え位置を決められる（EffectSite
    // 参照）。
    const effectSite = this.captureEffectSite();
    const session = this.session;
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
    const slot = this._parentSlot;
    if (this._parent === undefined || slot === undefined) return undefined;

    const originStack = slot.findStackContaining(this);
    if (originStack === undefined) return undefined;

    return new EffectSite(this._parent, slot, originStack, slot.indexOfStack(originStack));
  }

  /**
   * spawn（9.4節）を実行する。intoへの配置に失敗した場合は起点自身の親へ伝播し、枠の要件・capacityを無視して
   * 強制配置する（place参照）。伝播先の親も無ければ、生成したオブジェクトはworldツリーに繋がらないまま消える。
   */
  executeSpawn(
    effect: SpawnEffect,
    actor: WorldObject | undefined,
    effectSite: EffectSite | undefined,
  ): void {
    const spawned = this.session.spawn(effect.objectGlobalId);
    this.place(spawned, effect.into, actor, effect.into === 'same_slot' ? effectSite : undefined);
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
      placed = this.tryFirstAcceptingChild(spawned);
    } else {
      const target = into === 'self' ? this : actor;
      if (target === undefined) return;
      primaryTarget = target;
      placed = spawned.moveIntoFirstAcceptingSlot(primaryTarget);
    }

    if (placed) return;
    if (primaryTarget.parent === undefined) return;

    spawned.moveIntoFirstAcceptingSlot(primaryTarget.parent, true);
  }

  /**
   * 自分の子を順に走査し、最初に受け取れた子のスロットへ入れる（into: child、9.4節）。子のどのスロットが
   * 受け取るかは通常の走査に委ねるため、著者は「どの子か」も「どのスロットか」も書かない。
   */
  private tryFirstAcceptingChild(spawned: WorldObject): boolean {
    for (const child of this.children()) {
      if (spawned.moveIntoFirstAcceptingSlot(child)) return true;
    }
    return false;
  }
}
