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
  private readonly stage: { readonly propertyGlobalId: number; readonly name: string } | undefined;

  constructor(
    conditions: ConditionNode | undefined,
    stage?: { readonly propertyGlobalId: number; readonly name: string },
  ) {
    this.conditions = conditions;
    this.stage = stage;
  }

  /**
   * このゲートが見ている段のプロパティ。段で縛っていないゲートではundefined。
   * 「このステータスが何を動かしているか」（PropertyInfluences）は、これを原因として辿る。
   */
  get stagePropertyGlobalId(): number | undefined {
    return this.stage?.propertyGlobalId;
  }

  /** このゲートの宣言そのもの（GateReading参照）。 */
  get reading(): GateReading {
    return { stage: this.stage, conditions: this.conditions };
  }

  isSatisfied(declarer: WorldObject, slotBearer: WorldObject): boolean {
    if (
      this.stage !== undefined &&
      !(declarer.tryGetProperty(this.stage.propertyGlobalId)?.isInStage(this.stage.name) ?? false)
    )
      return false;

    if (
      this.conditions !== undefined &&
      // ゲートはactor/draggedを持たない文脈で評価する（誰かが操作しているとは限らない）。
      !this.conditions.evaluate(ReferenceContext.of(slotBearer))
    )
      return false;

    return true;
  }
}

/**
 * 1つの ObjectDef が宣言する、1つの持続効果（8節）。ObjectDef.passives の要素。
 *
 * **動詞が名乗るのは可逆性だけで、一度きりかtick毎かは置き場所（active／passives）が決める**（8.4節）。
 * そのため passives に書ける動詞は3つ——可逆な `modify`、不可逆な `add`、そして輸送の `transfer`——で、
 * 後の2つは active と同じ語のまま、tick毎に効く側になる。
 *
 * 効き方は2通りに分かれる。`modify`/`add` は**対象プロパティへ寄与として登録**され（PropertyPassiveEffect）、
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

  /** 関係（self/parent/ancestor）が変わった契機。登録を持たない効果は何もしない。 */
  registerRelation(_owner: WorldObject, _relation: ReferenceRoot, _register: boolean): void {}

  /** 子が付く/離れる契機。登録を持たない効果は何もしない。 */
  registerChild(_owner: WorldObject, _child: WorldObject, _register: boolean): void {}

  /**
   * tick毎に走る輸送（8.4節）ならそれ自身。寄与として登録される効果（modify/add）ではundefined。
   * 走らせる側（PassiveEffects）が種別で振り分けずに済むよう、効果自身が名乗る。
   */
  get tickTransfer(): TransferPassiveEffect | undefined {
    return undefined;
  }
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
   * （registerChild）が子ごとに1件ずつ作られるのと同じで、「どの子か」は1つに決まらない。
   */
  override collectInfluences(declarer: WorldObject, out: InfluenceWriter): void {
    for (const target of declarer.resolveInfluenceTargets(this.target)) {
      // ゲートのself（＝slotBearer）はエッジの子側（registerResolvedRelationと同じ決まり）。
      const slotBearer = this.target.root === 'child' ? target : declarer;
      out.write({
        causeObject: declarer,
        causePropertyGlobalId: this.gate.stagePropertyGlobalId,
        target,
        targetPropertyGlobalId: this.target.propertyGlobalId,
        reversible: this.reversible,
        increases: this.amount.of(declarer) >= 0,
        active: this.gate.isSatisfied(declarer, slotBearer),
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

  /** declarer/slotBearerの現在の文脈でゲート（8.2節）が有効ならamountを、無効なら0を返す。
   * modifyでもaddでも同じ量。 */
  activeAmount(declarer: WorldObject, slotBearer: WorldObject): number {
    return this.gate.isSatisfied(declarer, slotBearer) ? this.amount.of(declarer) : 0;
  }

  /**
   * 相手（related）がownerから直接辿れる関係（self/parent/ancestor）の登録/解除。相手はowner自身から
   * 解決するため、呼び出し側がrelationとrelatedに矛盾した組を渡す余地が無い。
   *
   * ancestorは、ツリー構造が変わる前に解除・変わった後に登録という順序を呼び出し側
   * （WorldObject.registerAncestorTargetedRecursively）が守る前提で、「今この瞬間の祖先」を毎回辿るだけで
   * よく、前回の登録先を憶えない。
   *
   * childは相手（どの子か）がownerから一意に辿れないため、ここでは扱わずregisterChildを使う。
   */
  override registerRelation(owner: WorldObject, relation: ReferenceRoot, register: boolean): void {
    if (this.target.root !== relation) return;
    this.registerResolvedRelation(owner, this.target.owner(ReferenceContext.of(owner)), register);
  }

  /**
   * childがparentに付く/離れる際に、parent（owner）側のtarget=child効果を、その付いた/離れた子(child)へ
   * 登録/解除する。childは相手がownerから一意に辿れない唯一の関係のため、childを明示的に受け取る。
   */
  override registerChild(owner: WorldObject, child: WorldObject, register: boolean): void {
    if (this.target.root !== 'child') return;
    this.registerResolvedRelation(owner, child, register);
  }

  /**
   * 内部共通処理: この効果の対象がrelationと一致するときだけrelatedの対象プロパティへ登録/解除する。
   * gateのself（＝slotBearer）はエッジの子側（child対象なら子=related、それ以外はowner）。
   * relationとrelatedに矛盾した組を外部から渡せないよう非公開。
   */
  private registerResolvedRelation(
    owner: WorldObject,
    related: WorldObject | undefined,
    register: boolean,
  ): void {
    const slotBearer = this.target.root === 'child' ? related! : owner;
    if (register) this.register(related, owner, slotBearer);
    else this.unregister(related, owner);
  }

  /** この効果を、targetOwnerの対象プロパティへ1件登録する（そのプロパティを持たなければ何もしない）。 */
  private register(
    targetOwner: WorldObject | undefined,
    declarer: WorldObject,
    slotBearer: WorldObject,
  ): void {
    if (targetOwner === undefined) return;
    const target = targetOwner.tryGetProperty(this.target.propertyGlobalId);
    // modify用と積分用のどちらへ入れるかは、具象クラスのregisterIntoが決める（8.3節）。
    if (target !== undefined)
      this.registerInto(target, new RegisteredPassiveEffect(declarer, slotBearer, this));
  }

  /** targetOwnerの対象プロパティから、declarerが宣言した登録を解除する。 */
  private unregister(targetOwner: WorldObject | undefined, declarer: WorldObject): void {
    targetOwner?.tryGetProperty(this.target.propertyGlobalId)?.unregisterPassiveEffectsFrom(declarer);
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
    if (!this.gate.isSatisfied(owner, owner)) return;
    this.transfer.apply(ReferenceContext.of(owner));
  }

  override collectInfluences(declarer: WorldObject, out: InfluenceWriter): void {
    this.transfer.collectTransferInfluences(declarer, this.gate.isSatisfied(declarer, declarer), out);
  }

  read(reader: PassiveReader): void {
    reader.transfer(this.transfer.reading, this.gate.reading);
  }
}
