import type { ActiveEffect, SpawnTarget } from './ActiveEffect';
import { Action, Combination } from './Interaction';
import { SameSlotSpawnSite } from './SameSlotSpawnSite';
import type { SameSlotPlacement } from './SameSlotSpawnSite';
import { LocalIndexByGlobalId } from './LocalIndexByGlobalId';
import type { ObjectDef } from './ObjectDef';
import type { PropertyPath } from './ReferenceRoot';
import { ReferenceContext } from './ReferenceRoot';
import type { EngineVocabulary } from './WorldVocabulary';
import type { InfluenceWriter, PropertyInfluenceReading } from './PropertyInfluence';
import { PropertyInfluences } from './PropertyInfluence';
import { PropertyValue } from './PropertyValue';
import { Slot } from './Slot';
import type { SlotPosition } from './SlotPosition';
import type { WorldSession } from './WorldSession';

/** 引けなかったものの呼び名（notFoundMessage）。どの名前空間で引くかもこれが決める。 */
type MemberKind = 'プロパティ' | 'スロット';

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
 * 適用の入口（applyActiveEffect）と対象解決、same_slot spawnの位置捕捉（SameSlotSpawnSite）・配置（place）を持つが、
 * 値の変更そのものは対象のPropertyValueへ、条件判定・抽選はDef側の効果へ委ねる。抵抗（`resists`、7.13節）が
 * 成立したときに持ち主から離れるのも自分で行う——値を変えた側は、その後に何を確かめるべきかを知らない。
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
   * 自分を消した宣言が名乗った名前（`destroy`の`reason`、9.3節）。名前を書かない`destroy`で消えた物と、
   * まだ消えていない物はundefined。
   *
   * **何が起きたのかは、起こした側がその場で名乗る。** 残った値から推測すると、上限で消えた場合・
   * 段を通らない即死・致死でない消滅（動物の立ち去り）を同時に取りこぼす（VitalsSystem.md 6節）。
   */
  private _destroyedReason: string | undefined;
  get destroyedReason(): string | undefined {
    return this._destroyedReason;
  }

  /**
   * このオブジェクトが生きるセッション。**生成したセッションと、その後この物が居るセッションは同じ**
   * ——だからこの物へ何かを頼む側は、セッションを渡さない。配置の関門（attachToSlotOrRejection・destroy）も、
   * プロパティの値の変更（PropertyValue.add）も、ここから辿って自分で記録・判定する。
   */
  readonly session: WorldSession;

  /** 中身から受ける寄与（containerContributionTo）が使う、規約で決まったプロパティのID。 */
  private get engine(): EngineVocabulary {
    return this.session.codex.vocabulary.engine;
  }

  /** sessionは必須（value:{min,max}を持つプロパティの初期値ランダム化にsession.rngを使う）。 */
  constructor(instanceId: number, def: ObjectDef, session: WorldSession) {
    this.instanceId = instanceId;
    this._def = def;
    this.session = session;

    this.properties = def.enumeratePropertyDefs().map((pd) => new PropertyValue(pd, this));
    this.slots = def.enumerateSlotDefs().map((sd) => new Slot(sd, this));

    // 生成時はまだトポロジが無いため、Self関係のみ登録する。Parent/Child/Ancestorはmove_to_slot以降に登録される。
    def.passives.setRelationRegistered(this, 'self', true);
  }

  // ---- プロパティを引く（6節） ----

  tryGetProperty(globalPropertyId: number): PropertyValue | undefined {
    const local = this.def.propertyIndexByGlobalId.toLocal(globalPropertyId);
    return local === LocalIndexByGlobalId.missing ? undefined : this.properties[local];
  }

  /**
   * tryGetPropertyと同じ引き方で、持っていないことを許さない版。**その型が必ず持っているはずの
   * プロパティ**——生成が書き込む行き先ID、シナリオが名指しする値——を引くときに使う。名前の綴り違いが
   * 黙って無視されず、書いた場所で分かる。
   */
  getProperty(globalPropertyId: number): PropertyValue {
    const property = this.tryGetProperty(globalPropertyId);
    if (property === undefined) {
      throw new Error(this.notFoundMessage('プロパティ', globalPropertyId));
    }
    return property;
  }

  /**
   * getProperty・getSlotが引けなかったときの文面。**捕まえたいのはYAMLの書き間違い**なので、
   * IDではなくその名前で言う（'path' はプロパティ 'travel_minute' を持ちません）。
   *
   * codexがそのIDを知らない場合だけIDのまま見せる——名前を出せないこと自体が、名前で引けなかった
   * （NameRegistryに登録の無い名前を使った）という手掛かりになる。
   *
   * **どの名前空間で引くかはkindが決める。** 呼ぶ側にNameRegistryも渡させると、2つが噛み合って
   * いなければならない決まりが呼び出しごとに増える。
   */
  private notFoundMessage(kind: MemberKind, globalId: number): string {
    const { propertyNames, slotNames } = this.session.codex;
    const name = (kind === 'プロパティ' ? propertyNames : slotNames).tryGetName(globalId);
    return name === undefined
      ? `'${this.def.name}' は${kind}(id=${globalId})を持ちません。`
      : `'${this.def.name}' は${kind} '${name}' を持ちません。`;
  }

  // ---- 全プロパティに跨る問い ----

  /**
   * `art_by_stage`（6.4節）が指すプロパティの、今の段が宣言しているart接尾辞。`art_by_stage`を
   * 持たない型、対象プロパティを持たないインスタンス、宣言の無い段では、いずれもundefined
   * （呼び出し側はその型自身の絵をそのまま使う）。
   */
  get artSuffix(): string | undefined {
    const propertyGlobalId = this.def.artByStagePropertyGlobalId;
    return propertyGlobalId === undefined ? undefined : this.tryGetProperty(propertyGlobalId)?.artSuffix;
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

  // ---- スロットを引く・中を見る（7節） ----

  /**
   * tryGetSlotと同じ引き方で、持っていないことを許さない版（getPropertyと同じ対）。名指しした枠が
   * 必ずあるはずの場所——生成・シナリオ・ビューが自分の型の枠を引くとき——に使う。
   */
  getSlot(globalSlotId: number): Slot {
    const slot = this.tryGetSlot(globalSlotId);
    if (slot === undefined) {
      throw new Error(this.notFoundMessage('スロット', globalSlotId));
    }
    return slot;
  }

  tryGetSlot(globalSlotId: number): Slot | undefined {
    const local = this.def.slotIndexByGlobalId.toLocal(globalSlotId);
    return local === LocalIndexByGlobalId.missing ? undefined : this.slots[local];
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

  /**
   * 入れ物としての詰まり具合（0〜1）。入れ物として名乗っていない型（`storage`、7.12節）と、
   * 上限（capacity）を持つスロットが1つも無い型ではundefined。
   *
   * **最も詰まっているスロットを返す。** バーが答えるのは「あとどれだけ入るか」なので、先に一杯に
   * なる側を映す——合計で割ると、片方が満杯でも半分に見える。
   *
   * Slot.fillRatioと表裏で、こちらは入れ物の側から自分の詰まり具合を見る。
   */
  fullestSlotFillRatio(): number | undefined {
    if (!this.def.isStorage) return undefined;

    let fullest: number | undefined;
    for (const slotDef of this.def.slotDefs) {
      const ratio = this.tryGetSlot(slotDef.globalId)?.fillRatio(this.engine.volumeId);
      if (ratio !== undefined) fullest = Math.max(fullest ?? 0, ratio);
    }
    return fullest;
  }

  // ---- 所属ツリーを辿る（7.1節） ----

  /** otherが自分自身か、自分の中に入っているか。入れ物を自分の中へ入れる操作を弾くのに使う。 */
  containsOrIs(other: WorldObject): boolean {
    for (let node: WorldObject | undefined = other; node !== undefined; node = node._parent) {
      if (node === this) return true;
    }
    return false;
  }

  /**
   * 自分の直接の親から遡り、指定したプロパティを定義している最初の祖先を探す（無ければundefined）。
   * base・Target=Ancestor・conditions/weightのAncestor起点が共有する、唯一の祖先探索ロジック。
   */
  findAncestorWithProperty(propertyGlobalId: number): WorldObject | undefined {
    let current = this._parent;
    while (current !== undefined) {
      if (current.def.propertyIndexByGlobalId.toLocal(propertyGlobalId) !== LocalIndexByGlobalId.missing)
        return current;
      current = current.parent;
    }
    return undefined;
  }

  /** 名指しのタグを持つ最も近い祖先。自分自身は見ない（findAncestorWithPropertyと同じ扱い）。 */
  findAncestorWithTag(tagGlobalId: number): WorldObject | undefined {
    for (let node = this._parent; node !== undefined; node = node.parent) {
      if (node.def.hasTag(tagGlobalId)) return node;
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
  findSelfOrDescendantByInstanceId(instanceId: number): WorldObject | undefined {
    if (this.instanceId === instanceId) return this;

    for (const slot of this.slots) {
      for (const child of slot.contents) {
        const found = child.findSelfOrDescendantByInstanceId(instanceId);
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
  findSelfOrDescendantOfDef(objectDefGlobalId: number): WorldObject | undefined {
    if (this.def.globalId === objectDefGlobalId) return this;

    for (const slot of this.slots) {
      for (const child of slot.contents) {
        const found = child.findSelfOrDescendantOfDef(objectDefGlobalId);
        if (found !== undefined) return found;
      }
    }

    return undefined;
  }

  // ---- スロット移動（7.1節のmove_to_slot） ----

  /**
   * スロット移動を行う唯一の汎用操作（7.1節の`move_to_slot`）。枠の要件・capacityの検証は対象Slot
   * 自身（Slot.rejectionFor）に委ねる。
   *
   * atを渡すと枠の中の位置まで指定する（SlotPosition参照）。**指した位置に置けなければ失敗**で、
   * 位置を無視して入れることはしない——プレイヤーが示した場所と違う所へ入るくらいなら、入らないほうが
   * 分かる。gapとcellの読み替えはSlot自身が行うので、呼び出し側はどちらのスロットかを知らなくてよい。
   *
   * 戻り値: 成功時はundefined、失敗時はその理由。
   */
  moveToSlotOrRejection(slot: Slot, at?: SlotPosition): string | undefined {
    return this.attachToSlotOrRejection(
      slot,
      at === undefined ? undefined : (target) => target.insertAt(this, at),
    );
  }

  /**
   * same_slot専用。置き換えオブジェクトを、originが居たセルを基準に配置する（Slot.placeSameSlot参照）。
   * 枠数の決まったスロットで空きが作れず配置できない場合はエラーを返す
   * （＝呼び出し側でfallbackへ委ねる）。
   */
  insertSameSlotOrRejection(slot: Slot, placement: SameSlotPlacement): string | undefined {
    return this.attachToSlotOrRejection(slot, (target) =>
      target.placeSameSlot(this, placement.originCellIndex, placement.sameKindStillInCell),
    );
  }

  /**
   * 今いるスロットの中での並び替え（Slot.moveStackTo参照）。どこにも属していない場合はfalse。
   *
   * 「どのスロットに居るか」を呼び出し側に持たせないための入口。**moveToSlotOrRejectionで同じ枠を指すのとは
   * 別物**——付け替えはいったん抜いてから入れるので、抜いた時点でセルが詰まって指した位置の意味が
   * ずれる。動かすのも1個ではなくスタック丸ごとで、理由はSlot側にある。
   */
  reorderInParentSlot(at: SlotPosition): boolean {
    const slot = this._parentSlot;
    if (slot === undefined) return false;

    const stack = slot.findStackContaining(this);
    return stack !== undefined && slot.moveStackTo(stack, at);
  }

  /**
   * このスロットへ移れない理由（移れるならundefined）。**移動を提示してよいかを、実際に動かさずに
   * 訊くための入口**——画面はこれを使って、掴んだカードを落とせる場所を決める。
   *
   * 何が移せないかを画面側が場所ごとに覚えていると、ワールド側の宣言と食い違う（設置物のかごを
   * 持ち歩けるようにしたのに、画面がそのレーンを読み取り専用のままにしている、など）。
   */
  rejectionForMoveTo(slot: Slot): string | undefined {
    return this.rejectionForLoopOrDetach(slot) ?? slot.rejectionFor(this);
  }

  /**
   * 自分に続けてfollowers（同じ束の仲間）を同じスロットへ入れるとき、続けて受け取ってもらえる個数
   * （自分を含む。自分が入らなければ0）。
   *
   * 1つずつrejectionForMoveToを訊いても答えは出ない——2つ目が入るかは1つ目が入った後の空きで
   * 決まるため（Slot.acceptedCount）。**束をまとめて落とす操作が、落とす前に「何枚ついてくるか」を
   * 決めるための問い**で、ついてきた枚数はそのまま「これだけ入る」という約束になる。
   */
  acceptedCountForMoveToIncludingSelf(followers: readonly WorldObject[], slot: Slot): number {
    const candidates: WorldObject[] = [];
    for (const candidate of [this as WorldObject, ...followers]) {
      if (candidate.rejectionForLoopOrDetach(slot) !== undefined) break;
      candidates.push(candidate);
    }
    if (candidates.length === 0) return 0;

    return slot.acceptedCount(candidates);
  }

  /**
   * 枠が受け入れるかを見るまでもなく成立しない移動の理由（移れるならundefined）。**枠の空きではなく
   * 所属ツリーの形の話**なので、移れる個数を数えるときも1つずつこちらだけを見る。
   */
  private rejectionForLoopOrDetach(slot: Slot): string | undefined {
    // 入れ物を自分自身や自分の中身の中へ入れると、ツリーから切り離された輪ができる（7.1節）。
    if (this.containsOrIs(slot.owner)) {
      return `'${this.def.name}' を自分自身の中へは入れられません。`;
    }

    // 単独で在れない物は、いったん持ち主に付いたら別の持ち主へは移せない（7.9節）。捻挫は身体から
    // 剥がせないし、道は繋がる土地から外せない。生まれた直後（親を持たない間）の配置は通す。
    if (this.def.boundToOwner && this._parent !== undefined && this._parent !== slot.owner) {
      return `'${this.def.name}' は '${this._parent.def.name}' から離せません。`;
    }

    // 抵抗している物は持ち主を持てない（7.13節）。土地だけは持ち主にならないので、そこへは普通に
    // 置けるし、自分で隣の土地へ移るのも通る。生まれた直後（親を持たない間）の配置は、bound_to_owner
    // と同じく通す——罠が獲物を自分の中へ生むのは、誰かが持ち主になろうとする移動ではない。
    if (!slot.owner.isLand && this._parent !== undefined && this.isResisting) {
      return `'${this.def.name}' は '${slot.owner.def.name}' に収まりません。`;
    }

    return undefined;
  }

  /**
   * 今この物が抵抗しているか（`resists`、7.13節）。宣言が無ければ常に偽。
   *
   * 読むのは実効値（`ConditionNode`）なので、外から与えられた寄与——罠の`modify`が警戒を打ち消すような
   * ——もそのまま効く（docs/engine/TrapSystem.md 5節）。
   */
  private get isResisting(): boolean {
    const resists = this.def.resists;
    return resists !== undefined && resists.evaluate(ReferenceContext.forSelf(this));
  }

  /**
   * この物が土地か（`location` タグ）。**土地だけが持ち主にならない親**で、抵抗している物が居られる
   * のはそこだけ（HuntingSystem.md 4節）。
   *
   * エンジンの他の規則と違い、ここは世界の側の語をそのまま読む——「持ち主ではない置き場」を型の宣言
   * から導く手掛かりが他に無いため（`WorldRuleVocabulary`）。
   */
  private get isLand(): boolean {
    return this.def.hasTag(this.session.codex.vocabulary.world.locationTagId);
  }

  /**
   * 抵抗しているのに持ち主の下に居るなら、その場で離れる（7.13節）。台車に積んだ動物の警戒が上がれば、
   * 暴れて荷車から飛び出す。
   *
   * こぼれ先を名指ししないのは、土地以外の親が受け取らなくなる（rejectionForLoopOrDetach）ため
   * ——上へ遡るうちに、最も近い土地が最初の受け取り手になる。
   *
   * **値を変えた側は、この後何を確かめるべきかを覚えなくてよい**（PropertyValue.add・tick・
   * 配置の関門が、それぞれ自分で呼ぶ）。
   */
  spillOutIfResisting(): void {
    const parent = this._parent;
    if (parent === undefined || parent.isLand || !this.isResisting) return;

    this.spillTo(parent);
  }

  /**
   * placeは位置を指定する配置（moveToSlotOrRejectionのat・insertSameSlotOrRejection）専用。省略すると通常の追加
   * （Slot.addWithoutParentLink）になる。
   *
   * **配置を伴う変化の唯一の関門**なので、ここが出入りを記録する（WorldChange）。移動前の居場所は
   * 切り離す前に控える——切り離した後では、どこから来たのかを誰も知らない。
   */
  private attachToSlotOrRejection(
    targetSlot: Slot,
    place: ((slot: Slot) => boolean) | undefined,
  ): string | undefined {
    const rejection = this.rejectionForMoveTo(targetSlot);
    if (rejection !== undefined) return rejection;

    const newParent = targetSlot.owner;
    const from = this._parentSlot;

    this.detachFromParent();

    if (place !== undefined) {
      if (!place(targetSlot)) {
        // 枠数の決まったスロットで空きが作れず配置できなかった（呼び出し側でfallbackへ）。既に旧親から切り離し済みの
        // ため、この場合は未配置（どこにも属さない）で戻す。
        this.session.runAndRecordChange(this, from, undefined);
        return `'${newParent.def.name}.${targetSlot.def.name}' に指定した位置の空きがありません。`;
      }
    } else {
      targetSlot.addWithoutParentLink(this);
    }

    this.session.runAndRecordChange(this, from, targetSlot);
    this.setParent(newParent, targetSlot);
    this.setEdgeRegistered(newParent, true);
    // 祖先対象の登録は、新しい親チェーンが確定した後に行う（detachFromParentでの解除と対、
    // registerAncestorTargetedRecursively参照）。
    this.setAncestorTargetsRegistered(true);

    // 移った先で初めて抵抗が成立することがある（罠から手へ移した瞬間に、警戒を打ち消していた寄与が
    // 消える）。実効値が移り終えた後の値になるのは、登録がすべて済んだこの時点。
    this.spillOutIfResisting();

    return undefined;
  }

  private detachFromParent(): void {
    // 祖先対象の登録解除は、トポロジが変わる前（旧祖先がまだ辿れるうち）に行う（setAncestorTargetsRegistered
    // 参照。再登録はattachToSlotOrRejection側）。**親が居なくても解除する**——自分の中に居る子孫は、
    // この部分木の中で祖先を見つけて既に登録しているので、外さないまま再登録すると二重に効く。
    this.setAncestorTargetsRegistered(false);

    const oldParent = this._parent;
    const oldSlot = this._parentSlot;
    if (oldParent === undefined || oldSlot === undefined) return;

    oldSlot.removeWithoutParentLink(this);
    this.setEdgeRegistered(oldParent, false);
    this.setParent(undefined, undefined);
  }

  private setParent(parent: WorldObject | undefined, parentSlot: Slot | undefined): void {
    this._parent = parent;
    this._parentSlot = parentSlot;
  }

  /**
   * 親子のエッジが形成/解消された契機を、双方の効果（modify/add、8節）へ伝える（register=trueで登録、
   * falseで解除）。親側だけ子thisを明示的に渡すのは、親からどの子かを一意に辿れないため。target=selfは
   * コンストラクタで登録済みのため、ここでは扱わない。
   */
  private setEdgeRegistered(parent: WorldObject, register: boolean): void {
    this.def.passives.setRelationRegistered(this, 'parent', register);
    parent.def.passives.setChildRegistered(parent, this, register);
  }

  /**
   * 自分自身と、すべての子孫について、target=ancestorのpassivesを現在の祖先へ登録/解除する。親が変わると子孫
   * 全員の祖先チェーンも変わるため、再帰で全員分を扱う。トポロジ変化前に解除・変化後に登録する順序を守ることで、
   * いずれの時点でも祖先はownerから辿れ、前回の登録先を憶える必要がない。
   */
  private setAncestorTargetsRegistered(register: boolean): void {
    this.def.passives.setRelationRegistered(this, 'ancestor', register);

    for (const slot of this.slots) {
      for (const child of [...slot.contents]) child.setAncestorTargetsRegistered(register);
    }
  }

  // ---- 枠を名指ししない行き先（7.7〜7.8節・9.4節） ----

  /**
   * itemを自分の中へ入れるなら、どの枠か（GameElementDefinition.md 7.8節）。プレイヤーが手で入れられる
   * 枠（`placement: manual`、7.7節）のうち、**宣言順で最初に今itemを受け取れるもの**。どこにも入らな
   * ければundefined。
   *
   * 型が合うかではなく今入るかで選ぶので、先の枠が埋まっていれば次の枠が答えになる。**今itemが居る枠は
   * 答えない**——同じ枠へ入れ直すのは入れる操作ではない。
   */
  slotForPutIn(item: WorldObject): Slot | undefined {
    const from = item.parent === this ? item.parentSlot : undefined;
    return this.def
      .placementSlotDefs('manual')
      .map((slotDef) => this.getSlot(slotDef.globalId))
      .find((slot) => slot !== from && item.rejectionForMoveTo(slot) === undefined);
  }

  /**
   * targetの自動配置スロット（ObjectDef.placementSlotDefs）を宣言順に走査し、最初に受け入れられた
   * スロットへ自分自身を移動する（著者がスロット名を知らなくてよい規約。spawnのintoとmoveが共用、
   * 9.4節）。
   *
   * **札を重ねたドロップ（slotForPutIn）と同じ規約の、別の入口。** 走査する枠の並びは1箇所が
   * 答える（placementSlotDefs）。
   */
  moveIntoFirstAcceptingSlot(target: WorldObject): boolean {
    for (const slotDef of target.def.placementSlotDefs('auto'))
      if (this.attachToSlotOrRejection(target.getSlot(slotDef.globalId), undefined) === undefined)
        return true;

    return false;
  }

  /**
   * 行き場を失った物を落ち着かせる（7.1節）。hostから始めて、受け入れてもらえなければその親、さらに
   * その親…と遡り、**どこにも入らなければ世界から消える**。
   *
   * 枠が受け入れないものを押し込むことはしない。器に入らない物は器の外——手に持てなければ足元へ、
   * 足元にも置けなければ失われる、という順で落ちていくだけで、どの段でも枠の宣言はそのまま効く。
   *
   * 消えるときも中身は道連れにしない（destroy参照）ので、中身はそこからまた同じように落ちていく。
   */
  spillTo(host: WorldObject | undefined): void {
    for (let candidate = host; candidate !== undefined; candidate = candidate.parent)
      if (this.moveIntoFirstAcceptingSlot(candidate)) return;

    this.destroy();
  }

  // ---- 世界から出る・型が変わる（9.3節・9.9節） ----

  /**
   * 現在の親から切り離す（destroy、9.3節）。切り離された時点でworldツリーから到達不能になり、tickの対象からも
   * 自然に外れる。既に親を持たない場合は何もしない（繰り返し実行しても安全、6.3節）。
   *
   * **消した側は名前を名乗れる**（reason、9.3節）。名乗られた名前は消された側に残り、世界から出た
   * あとでも「どう消されたか」を答える（destroyedReason）。名乗らない消滅——こぼれ落ちて行き場を
   * 失う・立ち去る——は名前を持たないので、死因として読まれることもない。
   *
   * **中身は道連れにしない。** 単独で在れる子（bound_to_ownerでない子、7.9節）は、消える自分ではなく
   * 自分の親——子から見た祖父——へこぼれ出す。治った怪我に当てていた包帯が消えてしまわないように、
   * 壊れた籠の中身が地面に散らばるように。
   */
  destroy(reason?: string): void {
    this._destroyedReason = reason;
    this.spillContentsTo(this._parent);
    const from = this._parentSlot;
    this.detachFromParent();
    this.session.runAndRecordChange(this, from, undefined);
  }

  /**
   * 消えるときに中身を送り出す（destroy参照）。単独で在れない子（怪我・液体・道）は送り出さず、
   * 自分にぶら下がったまま道連れにする——ただしその子の中身については同じことを行う（怪我が治れば、
   * 当てていた包帯は身体の親である土地へこぼれる）。
   *
   * 送り出した先が受け取れなければ、さらにその親へと落ちていく（spillTo）。どこにも入らなければ、
   * その子もそこで失われる。
   */
  private spillContentsTo(destination: WorldObject | undefined): void {
    for (const slot of this.slots) {
      for (const child of [...slot.contents]) {
        if (child.def.boundToOwner) child.spillContentsTo(destination);
        else child.spillTo(destination);
      }
    }
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
    const newSlots = newDef.enumerateSlotDefs().map((slotDef) => new Slot(slotDef, this));
    const rehomed: Array<{ child: WorldObject; slot: Slot }> = [];
    for (const slot of this.slots) {
      const slotLocalId = newDef.slotIndexByGlobalId.toLocal(slot.def.globalId);
      for (const child of [...slot.contents]) {
        const destination = slotLocalId === LocalIndexByGlobalId.missing ? undefined : newSlots[slotLocalId];
        if (destination === undefined || destination.rejectionFor(child) !== undefined) {
          this.evict(child);
          continue;
        }
        destination.addWithoutParentLink(child);
        rehomed.push({ child, slot: destination });
      }
    }

    const parent = this._parent;

    this.setAncestorTargetsRegistered(false);
    this._def.passives.setRelationRegistered(this, 'self', false);
    if (parent !== undefined) this.setEdgeRegistered(parent, false);
    for (const { child } of rehomed) child.setEdgeRegistered(this, false);

    const carriedValues = new Map<number, number>();
    for (const property of this.properties) carriedValues.set(property.def.globalId, property.number);

    this._def = newDef;
    this.properties = newDef.enumeratePropertyDefs().map((pd) => new PropertyValue(pd, this));
    this.slots = newSlots;
    for (const { child, slot } of rehomed) child.setParent(this, slot);

    for (const property of this.properties) {
      const carried = carriedValues.get(property.def.globalId);
      // **新しい型のrangeに収まらなくてもそのまま運ぶ。** rangeは実効値の端（6.3節）なので、
      // 読むときに切られる。実体値を丸めるのはエンジンの仕事ではない。
      if (carried !== undefined) property.setNumberWithoutEvents(carried);
    }

    this._def.passives.setRelationRegistered(this, 'self', true);
    if (parent !== undefined) this.setEdgeRegistered(parent, true);
    for (const { child } of rehomed) child.setEdgeRegistered(this, true);
    this.setAncestorTargetsRegistered(true);

    // 型が変われば同種の判定も変わる（7.6節）ので、所属スタックを判定し直させる。
    this._parentSlot?.restack(this);
  }

  /**
   * 新しい型が受け取れなかった中身を送り出す（becomeType参照）。行き先はdestroyのこぼし先と同じ
   * 自分の親からで、単独で在れない子（7.9節）は移せる先が無いのでそこで失われる。
   */
  private evict(child: WorldObject): void {
    if (child.def.boundToOwner) child.destroy();
    else child.spillTo(this._parent);
  }

  // ---- 影響の読み取り（Windows.md 8節） ----

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
    return influences;
  }

  /** 自分と、自分の中に入っている物すべてが宣言する持続効果の辺を書き出す。 */
  private collectInfluencesRecursively(out: InfluenceWriter): void {
    this.def.passives.collectInfluences(this, out);
    for (const child of this.children()) child.collectInfluencesRecursively(out);
  }

  /**
   * 持続効果の対象（8.1節）を、影響の一覧のために解決する。**childは今入っている子を全部**返す
   * ——相手が1つに定まらない唯一の対象で、寄与も子ごとに1件ずつ登録される（setChildRegistered）。
   * actor/draggedはpassivesに現れない（parsePassiveTransfers）ため空になる。
   */
  resolveInfluenceTargets(path: PropertyPath): readonly WorldObject[] {
    if (path.root === 'child') return [...this.children()];
    const target = path.owner(ReferenceContext.forSelf(this));
    return target === undefined ? [] : [target];
  }

  // ---- プレイヤーが起こせる操作（11節・12節） ----

  /** actorがこのカードへ起こせる、**画面のボタンに出る**操作（11.1節、宣言順）。 */
  menuActionsFor(actor: WorldObject | undefined): readonly Action[] {
    return this.def.menuTriggers.map((trigger) => new Action(trigger, this, actor));
  }

  /**
   * 名指しした操作（宣言が無ければundefined）。土地のexplore・道のtravelが使う。
   *
   * 探すのは相手を伴わないきっかけ（menu・tick）だけ——重ねる操作は相手が決まらないと引けない。
   */
  tryGetAction(actionName: string, actor: WorldObject | undefined): Action | undefined {
    const trigger = [...this.def.menuTriggers, ...this.def.tickTriggers].find(
      (candidate) => candidate.interaction.name === actionName,
    );
    return trigger === undefined ? undefined : new Action(trigger, this, actor);
  }

  /**
   * draggedを重ねたときに**今**成立する組み合わせ（12節、宣言順）。相手として受け入れるかだけでなく、
   * 要件（14節）を満たしているかまで見る——満杯の炉に薪をくべる組み合わせは、候補にならない。
   *
   * **要件まで見るのは、候補を選ぶ側と実行できる側を食い違わせないため。** 型だけで選ぶと、選んだ
   * 先が実行できない場合に「落とせるのに何も起きない」になる。**行き先の座標に型が居ない組み合わせ**
   * （`become`、9.9節）も同じ理由で候補にならない。
   */
  combinationsWith(dragged: WorldObject, actor: WorldObject | undefined): readonly Combination[] {
    const context = ReferenceContext.acting(this, actor, dragged);
    return this.def.dragTriggers
      .filter(
        (trigger) =>
          trigger.acceptsDragged(dragged.def) &&
          trigger.interaction.unmetRequirement(context) === undefined &&
          trigger.acceptedCount(context, [dragged]) >= 1 &&
          !trigger.interaction.blocksOperation(context),
      )
      .map((trigger) => new Combination(trigger, this, dragged, actor));
  }

  // ---- 時間の経過（8.4節） ----

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
    this.def.passives.applyTickTransfers(this);
    // 抵抗の判定も積分の後（7.13節）。時間で動くのは実体値だけでなく、寄与の掛かり方も同じtickで
    // 変わりうるので、値の変更を経ずに成立した抵抗はここが拾う。
    this.spillOutIfResisting();

    for (const slot of this.slots) {
      for (const child of [...slot.contents]) child.tick();
    }
  }

  /**
   * この物から下（すべてのスロットの中身）へ、**時間が起こす操作**（`trigger: tick`、11.1節）を
   * 1手ずつ与える。値の積分（tick）を終えてから呼ぶ——動物が動くのは時間が経ったからで、
   * そのtickの値が出そろった後になる（WorldSession.runTick）。
   *
   * **配る前に集める。** 手番は物を増減させ、逃げれば別の枝へ移るので、走査しながら配ると同じ個体へ
   * 二度回りうる。集めてから配れば、1 tickに1手だけになる。
   */
  runTickActions(): void {
    const pending: WorldObject[] = [];
    this.collectTickActors(pending);

    for (const actor of pending) {
      // 手番の途中で消えた個体は飛ばす——世界から外れると、辿り着く根が変わる。
      if (actor.findRoot() !== this) continue;
      for (const trigger of actor.def.tickTriggers) new Action(trigger, actor, undefined).tryExecute();
    }
  }

  private collectTickActors(into: WorldObject[]): void {
    if (this.def.tickTriggers.length > 0) into.push(this);
    for (const slot of this.slots) {
      for (const child of [...slot.contents]) child.collectTickActors(into);
    }
  }

  // ---- 能動効果とspawn（9.2〜9.4節） ----

  /**
   * このオブジェクトをselfとして、set/add/destroy/spawnを実行する（9.2〜9.4節）。rangeイベント（6節）と
   * actions/combinations（11節・12節）の両方から呼ばれる（rangeイベント経由ではactor/draggedはundefined）。
   * 対象が解決できない場合（parentが無い、actor/draggedがこの実行文脈に無い）は、その対象への適用のみ無視する。
   *
   * destroyをspawnより先に行う（9.3節・9.4節）: 置き換え後のオブジェクトが破棄されるオブジェクトの位置を
   * 引き継げるよう、destroyで実際に位置が空いてから配置を行う。
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
    // selfを消した後でも、spawnはこのアンカーと配置時のスロットの状態から置き換え位置を決められる（SameSlotSpawnSite
    // 参照）。
    const sameSlotSpawnSite = this.captureSameSlotSpawnSite();
    const session = this.session;
    const context = ReferenceContext.acting(this, actor, dragged);
    session.withSubject(this, () => effect.apply(context, session, sameSlotSpawnSite));
  }

  /** same_slotの置き換えのために、selfが今占めている位置を捕捉する。「これから消えるか」の予測は織り込まず、置き換え位置の判断は配置時にSameSlotSpawnSite自身が行う。parentが無ければ位置が無いのでundefined。 */
  private captureSameSlotSpawnSite(): SameSlotSpawnSite | undefined {
    const slot = this._parentSlot;
    if (this._parent === undefined || slot === undefined) return undefined;

    const originStack = slot.findStackContaining(this);
    if (originStack === undefined) return undefined;

    return new SameSlotSpawnSite(this._parent, slot, originStack, slot.indexOfStack(originStack));
  }

  /**
   * spawn（9.4節）を実行する。intoへの配置に失敗した場合は起点自身の親へこぼれ、そこも受け取らなければ
   * さらに上へ遡る（place・spillTo参照）。どこにも入らなければ、生成したオブジェクトはそのまま消える。
   */
  executeSpawn(
    objectGlobalId: number,
    into: SpawnTarget,
    context: ReferenceContext,
    sameSlotSpawnSite: SameSlotSpawnSite | undefined,
  ): void {
    const spawned = this.session.createObject(objectGlobalId);
    this.place(spawned, into, context, into === 'same_slot' ? sameSlotSpawnSite : undefined);
  }

  /**
   * spawnした側は配置先のスロット名を書かない。same_slotなら捕捉しておいた位置へ配置する
   * （SameSlotSpawnSite.placeReplacementへ委ねる）。childなら子を、個体を指す参照ならその相手のスロットを
   * 宣言順に走査し、最初に配置できたスロットへ入れる。**配置に失敗した場合は起点自身の親へこぼれ、
   * そこも受け取らなければさらに上へ**（spillTo）。どこにも入らなければ、生まれた物はそのまま失われる。
   */
  private place(
    spawned: WorldObject,
    into: SpawnTarget,
    context: ReferenceContext,
    site: SameSlotSpawnSite | undefined,
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
      const target = into.resolve(context);
      if (target === undefined) return;
      primaryTarget = target;
      placed = spawned.moveIntoFirstAcceptingSlot(primaryTarget);
    }

    if (!placed) spawned.spillTo(primaryTarget.parent);
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
