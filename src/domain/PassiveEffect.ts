import type { PropertyValue } from './PropertyValue';
import type { TransferEffect } from './ActiveEffect';
import { RegisteredPassiveEffect } from './RegisteredPassiveEffect';
import type { WorldObject } from './WorldObject';
import type { ConditionNode } from './ConditionNode';
import type { GateReading, PassivePropertyReading, PassiveReader } from './PassiveReader';
import type { InfluenceWriter } from './PropertyInfluence';
import type { ReferenceRoot } from './ReferenceRoot';
import { ReferenceContext } from './ReferenceRoot';
import type { PropertyPath } from './ReferenceRoot';
import type { PassiveAmount } from './PassiveAmount';
import type { WorldSession } from './WorldSession';
import type { PropertyGlobalId } from './GlobalId';

/**
 * 効果の発動条件。判別子は持たず、各フィールドの有無が「何をチェックすべきか」を表す
 * （stageNameが設定済み→WhenOwnStage判定、conditionsが設定済み→conditions判定、両方設定済み=AND、
 * 両方未設定=常時有効）。
 *
 * 参照はグローバルIDのまま持ち、評価のたびにローカル化する（変換コストは1 tick=15分の時間スケールに
 * 対して無視できるため、ビルド時の2段階パースを避ける）。
 */
export class PassiveEffectGate {
  private readonly conditions: ConditionNode | undefined;

  /**
   * 見ている段（8.2節）。**プロパティと段の名前は組で1つ**——片方だけでは「どのプロパティのどの段か」
   * を言えないので、分けて持たない。段で縛っていないゲートではundefined。
   */
  private readonly stage: { readonly propertyGlobalId: PropertyGlobalId; readonly name: string } | undefined;

  constructor(
    conditions: ConditionNode | undefined,
    stage?: { readonly propertyGlobalId: PropertyGlobalId; readonly name: string },
  ) {
    this.conditions = conditions;
    this.stage = stage;
  }

  /**
   * このゲートが見ている段のプロパティ。段で縛っていないゲートではundefined。
   * 「このステータスが何を動かしているか」（PropertyInfluences）は、これを原因として辿る。
   */
  get stagePropertyGlobalId(): PropertyGlobalId | undefined {
    return this.stage?.propertyGlobalId;
  }

  /** このゲートの宣言そのもの（GateReading参照）。 */
  get reading(): GateReading {
    return { stage: this.stage, conditions: this.conditions };
  }

  /**
   * 段（WhenOwnStage）とconditionsを両方満たすか。段は宣言元（declarer）自身のプロパティを見る。
   *
   * **conditionsのselfは辺の子側（slotBearer）、役はrolesが答える。** 両者を組み合わせるのはここ
   * だけで、呼び出し側は役の出どころ（宣言が置かれた場所で決まる。11.5節・RegisteredPassiveEffect）
   * を渡すだけでよい。child対象ではselfと宣言元が食い違うので、まとめて片方から引くと「宣言元は
   * 操作に参加しているのに解決しない」が起きる。
   */
  isSatisfied(declarer: WorldObject, slotBearer: WorldObject, roles: ReferenceContext): boolean {
    if (
      this.stage !== undefined &&
      !(declarer.tryGetProperty(this.stage.propertyGlobalId)?.isInStage(this.stage.name) ?? false)
    )
      return false;

    return this.conditions === undefined || this.conditions.evaluate(roles.withSelf(slotBearer));
  }
}

/**
 * 寄与として登録される効果1つと、その登録の契機になる関係（8.1節の `target` の起点）。**仕分ける側は
 * この2つを効果自身から同時に受け取る**——関係だけを名乗らせると、仕分けた先で誰を呼べるかが
 * また種別の判別に戻る。
 */
export interface RelationRegistration {
  readonly relation: ReferenceRoot;
  readonly effect: PropertyPassiveEffect;
}

/**
 * 1つの ObjectDef が宣言する、1つの持続効果（8節）。ObjectDef.passives の要素。
 *
 * **動詞が名乗るのは可逆性だけで、一度きりかtick毎かは置き場所（active／passives）が決める**（8.4節）。
 * そのため passives に書ける動詞は、可逆な `modify`、不可逆な `add`、そして輸送の `transfer`。
 * `add` と `transfer` は active と同じ語のまま、tick毎に効く側になる。
 *
 * 効き方は分かれる。`modify`/`add` は**対象プロパティへ寄与として登録**され（PropertyPassiveEffect）、
 * `transfer` は登録を持たず**宣言したオブジェクトのtickで走る**（TransferPassiveEffect）——2つのプロパティを
 * 同時に動かす操作は、どちらか一方への寄与としては表せないため。
 */
export abstract class PassiveEffect {
  /**
   * この効果が何を宣言しているかを読み上げる（PassiveReader参照）。**抽象なのは取りこぼしを防ぐため**
   * ——既定を持たせると、動詞を1つ足したときに読み手が黙って何も受け取らなくなる。
   */
  abstract read(reader: PassiveReader): void;

  /**
   * この効果が持つ影響の辺（InfluenceEdge）を書き出す。declarerは宣言したオブジェクトで、
   * 対象も原因もそこから辿る。どの一覧へ入るかは書き込み先が決める（PropertyInfluences）。
   */
  abstract collectInfluences(declarer: WorldObject, out: InfluenceWriter): void;

  /**
   * 登録の契機を受け取る関係（8.1節の `target` の起点）と、それを受け取る自分自身。寄与として
   * 登録されない効果（transfer）ではundefined。仕分ける側（PassiveEffects）が種別で振り分けずに
   * 済むよう、効果自身が名乗る。
   */
  get relationRegistration(): RelationRegistration | undefined {
    return undefined;
  }

  /**
   * tick毎に走る輸送（8.4節）ならそれ自身。寄与として登録される効果（modify/add）ではundefined。
   * 走らせる側（PassiveEffects）が種別で振り分けずに済むよう、効果自身が名乗る。
   */
  get tickTransfer(): TransferPassiveEffect | undefined {
    return undefined;
  }

  /**
   * この1 tickで自分が動かす先を、操作の稼ぎを数える対象として名乗る
   * （PassiveEffects.countTickMovementsAsGains）。
   *
   * **既定は何もしない。** 呼ばれるのは操作が宣言した一式だけで（11.7節）、そこに書けるのは
   * 実体値へ積む`add`と、実体値を動かさない`modify`しかない——輸送は書けない（8.4.1節）。
   */
  countTickMovementAsGain(_owner: WorldObject, _context: ReferenceContext, _session: WorldSession): void {}
}

/**
 * 対象プロパティへ寄与として登録される持続効果（`modify`/`add`）。
 *
 * 2つは別クラスで表し、判別用のkindは持たない。唯一の差は「PropertyValueのどちらのincomingへ
 * 登録されるか」で、registerIntoの実装で表現する。
 *
 * 登録先の解決と登録/解除はtargetの種別に応じて自分で行い、呼び出し側（WorldObject）はライフサイクルの
 * 契機で登録/解除を依頼するだけで、どのtargetがどこへ紐付くかは知らない。
 *
 * アクション/combination/pickの一時的な `add`（実行の瞬間に1回だけ効く）は、持続するゲート判定が不要な
 * ため、この登録の仕組みには乗らない。
 */
export abstract class PropertyPassiveEffect extends PassiveEffect {
  private readonly target: PropertyPath;
  private readonly amount: PassiveAmount;
  private readonly gate: PassiveEffectGate;

  constructor(target: PropertyPath, amount: PassiveAmount, gate: PassiveEffectGate) {
    super();
    this.target = target;
    this.amount = amount;
    this.gate = gate;
  }

  /** この効果（registration）を、対象プロパティ値（target）のmodify用/積分用incomingのうち
   * 具象クラスに応じた側へ登録する。 */
  abstract registerInto(target: PropertyValue, registration: RegisteredPassiveEffect): void;

  /** 可逆な寄与（modify、8.3節）か。影響の一覧が記号の形をこれで選ぶ（PropertyInfluence）。 */
  protected abstract get reversible(): boolean;

  /**
   * 対象へ届く辺を書き出す。**対象がchildのときは今入っている子の数だけ辺を書く**——寄与の登録
   * （setChildRegistered）が子ごとに1件ずつ作られるのと同じで、「どの子か」は1つに決まらない。
   */
  override collectInfluences(declarer: WorldObject, out: InfluenceWriter): void {
    const roles = ReferenceContext.forParticipant(declarer);
    for (const target of declarer.resolveInfluenceTargets(this.target)) {
      // ゲートのself（＝slotBearer）はエッジの子側（setResolvedRelationRegisteredと同じ決まり）。
      const slotBearer = this.target.root === 'child' ? target : declarer;
      out.write({
        causeObject: declarer,
        causePropertyGlobalId: this.gate.stagePropertyGlobalId,
        target,
        targetPropertyGlobalId: this.target.propertyGlobalId,
        reversible: this.reversible,
        increases: this.amount.amountFor(declarer) >= 0,
        active: this.gate.isSatisfied(declarer, slotBearer, roles),
      });
    }
  }

  /** 自分を1件の宣言として読んだもの（PassivePropertyReading参照）。 */
  protected get reading(): PassivePropertyReading {
    return {
      target: this.target.root,
      propertyGlobalId: this.target.propertyGlobalId,
      amount: this.amount.reading,
      gate: this.gate.reading,
    };
  }

  /** ゲート（8.2節）が有効ならamountを、無効なら0を返す。modifyでもaddでも同じ量。
   * rolesは役の出どころ（PassiveEffectGate.isSatisfied）。 */
  activeAmount(declarer: WorldObject, slotBearer: WorldObject, roles: ReferenceContext): number {
    return this.gate.isSatisfied(declarer, slotBearer, roles) ? this.amount.amountFor(declarer) : 0;
  }

  override get relationRegistration(): RelationRegistration {
    return { relation: this.target.root, effect: this };
  }

  /**
   * 実体値へ積む寄与（`add`）なら、動かす先を稼ぎの数え先として名乗る。可逆な寄与（`modify`）は
   * 実体値を動かさないので名乗らない。
   *
   * **相手もゲートの役もcontextから解く**（setRegisteredInContextと同じ、登録先と同じ物になる）。
   * 呼ばれるのは操作の宣言だけで、そこにchildは書けない（8.1節）ので、ゲートのselfはownerでよい。
   *
   * **名乗るのは先だけで、量は言わない。** 数えられるのはそのプロパティがこのtickで実際に動いた量
   * （PropertyValue.tick）で、同じtickの他の寄与も端のクランプも既に引かれている。
   *
   * **今tick何も足さないなら名乗らない。** ゲートが閉じている効果の対象を数え先にすると、物が
   * 自分で宣言した増減まで操作の稼ぎになる。
   */
  override countTickMovementAsGain(
    owner: WorldObject,
    context: ReferenceContext,
    session: WorldSession,
  ): void {
    if (this.reversible || this.activeAmount(owner, owner, context) === 0) return;

    const target = this.target.owner(context);
    const property = target?.tryGetProperty(this.target.propertyGlobalId);
    if (property !== undefined) session.countTickMovementAsGain(property);
  }

  /**
   * 対象（relationRegistrationで名乗った関係）の相手へ、この効果を登録/解除する。相手はowner自身から
   * 解決するので、呼び出し側は相手を知らなくてよい。**呼ばれるのは名乗った関係の契機だけ**
   * （仕分けはPassiveEffectsが持つ）。
   *
   * ancestorは、ツリー構造が変わる前に解除・変わった後に登録という順序を呼び出し側
   * （WorldObject.setAncestorTargetsRegistered）が守る前提で、「今この瞬間の祖先」を毎回辿るだけで
   * よく、前回の登録先を憶えない。
   *
   * 操作の役（11.5節）も、ownerが今役を解く関係から辿れるので同じ経路に乗る。**頼まれる契機は
   * 関係を張った/外したときだけではない**——関係の内側で型が変われば、宣言も登録先も入れ替わるので
   * そこでも張り直す（頼む側はWorldObject.setRoleTargetsRegisteredの呼び手）。
   *
   * childは相手（どの子か）がownerから一意に辿れないため、ここでは扱わずsetChildRegisteredを使う。
   */
  setRelationRegistered(owner: WorldObject, register: boolean): void {
    // 今の参加を引くのは登録先を解くためだけで、**憶えさせない**——物のdefの宣言が見る役は、
    // 登録の後もownerの参加に追随する（RegisteredPassiveEffect参照）。
    const target = this.target.owner(ReferenceContext.forParticipant(owner));
    this.setResolvedRelationRegistered(owner, target, register, undefined);
  }

  /**
   * contextで対象を解いて、この効果を相手へ登録/解除する。**役の解決先を呼び出し側が持っているとき
   * だけ**呼ぶ——操作が宣言した持続効果（11.7節）の役は、宣言したその操作の関係が答えるもので、
   * 宣言元が後から別の関係へ加わっても動かない（WorldSession.whileInteractionPassives）。
   *
   * **憶えるのは登録先だけではない。** ゲート（8.2節）が見る役も同じ関係が答えるので、contextを
   * 登録そのものへ持たせる（RegisteredPassiveEffect）。
   */
  setRegisteredInContext(owner: WorldObject, context: ReferenceContext, register: boolean): void {
    this.setResolvedRelationRegistered(owner, this.target.owner(context), register, context);
  }

  /**
   * childがparentに付く/離れる際に、parent（owner）側のtarget=child効果を、その付いた/離れた子(child)へ
   * 登録/解除する。childは相手がownerから一意に辿れない唯一の関係のため、childを明示的に受け取る。
   */
  setChildRegistered(owner: WorldObject, child: WorldObject, register: boolean): void {
    this.setResolvedRelationRegistered(owner, child, register, undefined);
  }

  /**
   * 内部共通処理: relatedの対象プロパティへこの効果を登録/解除する。
   * gateのself（＝slotBearer）はエッジの子側（child対象なら子=related、それ以外はowner）。
   * 対象と食い違うrelatedを外部から渡せないよう非公開。
   *
   * interactionRolesは、ゲートの役を答える文脈（RegisteredPassiveEffect参照）。
   */
  private setResolvedRelationRegistered(
    owner: WorldObject,
    related: WorldObject | undefined,
    register: boolean,
    interactionRoles: ReferenceContext | undefined,
  ): void {
    const slotBearer = this.target.root === 'child' ? related! : owner;
    if (register) this.register(related, owner, slotBearer, interactionRoles);
    else this.unregister(related, owner);
  }

  /** この効果を、targetOwnerの対象プロパティへ1件登録する（そのプロパティを持たなければ何もしない）。 */
  private register(
    targetOwner: WorldObject | undefined,
    declarer: WorldObject,
    slotBearer: WorldObject,
    interactionRoles: ReferenceContext | undefined,
  ): void {
    if (targetOwner === undefined) return;
    const target = targetOwner.tryGetProperty(this.target.propertyGlobalId);
    // modify用と積分用のどちらへ入れるかは、具象クラスのregisterIntoが決める（8.3節）。
    if (target !== undefined)
      this.registerInto(target, new RegisteredPassiveEffect(declarer, slotBearer, this, interactionRoles));
  }

  /** targetOwnerの対象プロパティから、declarerが宣言した登録を解除する。 */
  private unregister(targetOwner: WorldObject | undefined, declarer: WorldObject): void {
    targetOwner?.tryGetProperty(this.target.propertyGlobalId)?.unregisterPassiveEffect(declarer, this);
  }
}

/**
 * 条件が真の間だけ、都度導出される実効値に寄与する持続効果（可逆、8.3節）。実体値そのものは
 * 書き換えない。PropertyValueのmodify用incomingへ登録され、WorldObject.getEffectiveValueが走査する。
 */
export class ModifyEffect extends PropertyPassiveEffect {
  read(reader: PassiveReader): void {
    reader.modify(this.reading);
  }

  protected get reversible(): boolean {
    return true;
  }

  registerInto(target: PropertyValue, registration: RegisteredPassiveEffect): void {
    target.registerModify(registration);
  }
}

/**
 * 条件が真の間、tick毎に実体値そのものへ加減算し続ける持続効果（YAMLでは `add`、不可逆、8.4節）。
 * PropertyValueの積分用incomingへ登録され、WorldObject.tickが走査する。
 */
export class AccumulateEffect extends PropertyPassiveEffect {
  read(reader: PassiveReader): void {
    reader.accumulate(this.reading);
  }

  protected get reversible(): boolean {
    return false;
  }

  registerInto(target: PropertyValue, registration: RegisteredPassiveEffect): void {
    target.registerAccumulate(registration);
  }
}

/**
 * 条件が真の間、tick毎に走る輸送（YAMLでは `transfer`、8.4節・9.5節）。
 *
 * **寄与としては登録しない。** 2つのプロパティを同時に動かす操作は、どちらか一方への寄与としては
 * 表せないため、宣言したオブジェクトのtickでそのまま走る（PassiveEffects.applyTickTransfers）。
 * 走らせ方はactiveの輸送と全く同じで、違いは「毎tick呼ばれること」だけ。
 */
export class TransferPassiveEffect extends PassiveEffect {
  private readonly transfer: TransferEffect;
  private readonly gate: PassiveEffectGate;

  constructor(transfer: TransferEffect, gate: PassiveEffectGate) {
    super();
    this.transfer = transfer;
    this.gate = gate;
  }

  override get tickTransfer(): TransferPassiveEffect {
    return this;
  }

  /** ゲートが開いている間、1 tick分の輸送を走らせる（activeの輸送と同じ経路をそのまま通る）。 */
  applyTick(owner: WorldObject): void {
    const roles = ReferenceContext.forParticipant(owner);
    if (!this.gate.isSatisfied(owner, owner, roles)) return;
    this.transfer.apply(roles);
  }

  override collectInfluences(declarer: WorldObject, out: InfluenceWriter): void {
    const roles = ReferenceContext.forParticipant(declarer);
    this.transfer.collectTransferInfluences(declarer, this.gate.isSatisfied(declarer, declarer, roles), out);
  }

  read(reader: PassiveReader): void {
    reader.transfer(this.transfer.reading, this.gate.reading);
  }
}
