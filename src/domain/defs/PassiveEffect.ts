import type { PropertyValue } from '../runtime/PropertyValue';
import type { TransferEffect } from './ActiveEffect';
import { RegisteredPassiveEffect } from '../runtime/RegisteredPassiveEffect';
import type { WorldObject } from '../runtime/WorldObject';
import type { WorldSession } from '../runtime/WorldSession';
import type { ConditionNode } from './ConditionNode';
import type { InfluenceWriter } from '../runtime/PropertyInfluence';
import type { DefNames, DescriptionToken, DescriptionWriter } from './Description';
import { propertyRef, signedNumber, stageRef, text } from './Description';
import type { ReferenceRoot } from './ReferenceRoot';

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
  private readonly propertyGlobalId: number | undefined;
  private readonly stageName: string | undefined;

  constructor(conditions: ConditionNode | undefined, propertyGlobalId?: number, stageName?: string) {
    this.conditions = conditions;
    this.propertyGlobalId = propertyGlobalId;
    this.stageName = stageName;
  }

  /**
   * このゲートが見ている段（8.2節）のプロパティ。段で縛っていないゲートではundefined。
   * 「このステータスが何を動かしているか」（PropertyInfluences）は、これを原因として辿る。
   */
  get stagePropertyGlobalId(): number | undefined {
    return this.stageName === undefined ? undefined : this.propertyGlobalId;
  }

  isSatisfied(declarer: WorldObject, slotBearer: WorldObject): boolean {
    if (this.stageName !== undefined) {
      if (this.propertyGlobalId === undefined || !declarer.isInStage(this.propertyGlobalId, this.stageName))
        return false;
    }

    if (
      this.conditions !== undefined &&
      !this.conditions.evaluate((root) => PassiveEffectGate.resolve(root, slotBearer))
    )
      return false;

    return true;
  }

  /** このゲートを書き表す（Description参照）。常時有効なら空（条件が無いことを書き足さない）。 */
  describe(names: DefNames): readonly DescriptionToken[] {
    const tokens: DescriptionToken[] = [];
    if (this.stageName !== undefined && this.propertyGlobalId !== undefined)
      tokens.push(
        propertyRef(names.propertyName(this.propertyGlobalId)),
        text('が段'),
        stageRef(this.stageName),
        text('にある'),
      );

    if (this.conditions !== undefined) {
      if (tokens.length > 0) tokens.push(text(' かつ '));
      tokens.push(...this.conditions.describe(names));
    }
    return tokens;
  }

  private static resolve(root: ReferenceRoot, slotBearer: WorldObject): WorldObject | undefined {
    switch (root) {
      case 'self':
        return slotBearer;
      case 'parent':
        return slotBearer.parent;
      default:
        return undefined;
    }
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
  /** この効果を1行で書き表す（Description参照）。 */
  abstract describe(names: DefNames, out: DescriptionWriter): void;

  /**
   * この効果がpropertyGlobalIdのプロパティを書き換えうるか（プロパティ側からの逆引き用）。
   *
   * ownedByDeclarerは、そのプロパティが宣言元のobject_def自身のものか。target=selfの効果は
   * 宣言元自身のプロパティしか書き換えないため、他の型の同名プロパティは書き換え対象にならない。
   */
  abstract affects(propertyGlobalId: number, ownedByDeclarer: boolean): boolean;

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
  private readonly target: ReferenceRoot;
  private readonly targetPropertyGlobalId: number;
  private readonly amount: number;
  private readonly gate: PassiveEffectGate;

  protected constructor(
    target: ReferenceRoot,
    targetPropertyGlobalId: number,
    amount: number,
    gate: PassiveEffectGate,
  ) {
    super();
    this.target = target;
    this.targetPropertyGlobalId = targetPropertyGlobalId;
    this.amount = amount;
    this.gate = gate;
  }

  /** この効果（registration）を、対象プロパティ値（target）のmodify用/積分用incomingのうち
   * 具象クラスに応じた側へ登録する。 */
  abstract registerInto(target: PropertyValue, registration: RegisteredPassiveEffect): void;

  /** YAMLでの書き方の名前（modify/add）。describeが対象の前に置く。 */
  protected abstract get kindLabel(): string;

  /** 可逆な寄与（modify、8.3節）か。影響の一覧が記号の形をこれで選ぶ（PropertyInfluence）。 */
  protected abstract get reversible(): boolean;

  /**
   * 対象へ届く辺を書き出す。**対象がchildのときは今入っている子の数だけ辺を書く**——寄与の登録
   * （registerChild）が子ごとに1件ずつ作られるのと同じで、「どの子か」は1つに決まらない。
   */
  override collectInfluences(declarer: WorldObject, out: InfluenceWriter): void {
    for (const target of declarer.resolveInfluenceTargets(this.target, this.targetPropertyGlobalId)) {
      // ゲートのself（＝slotBearer）はエッジの子側（registerResolvedRelationと同じ決まり）。
      const slotBearer = this.target === 'child' ? target : declarer;
      out.write({
        causeObject: declarer,
        causePropertyGlobalId: this.gate.stagePropertyGlobalId,
        target,
        targetPropertyGlobalId: this.targetPropertyGlobalId,
        reversible: this.reversible,
        increases: this.amount >= 0,
        active: this.gate.isSatisfied(declarer, slotBearer),
      });
    }
  }

  override affects(propertyGlobalId: number, ownedByDeclarer: boolean): boolean {
    if (this.targetPropertyGlobalId !== propertyGlobalId) return false;
    return ownedByDeclarer || this.target !== 'self';
  }

  override describe(names: DefNames, out: DescriptionWriter): void {
    const tokens: DescriptionToken[] = [
      text(`${this.kindLabel} `),
      propertyRef(names.propertyName(this.targetPropertyGlobalId), this.target),
      text(` ${signedNumber(this.amount)}`),
    ];

    const gate = this.gate.describe(names);
    if (gate.length > 0) tokens.push(text('（'), ...gate, text('間）'));
    out.write(...tokens);
  }

  /** declarer/slotBearerの現在の文脈でゲート（8.2節）が有効ならamountを、無効なら0を返す。
   * modifyでもaddでも同じ量。 */
  activeAmount(declarer: WorldObject, slotBearer: WorldObject): number {
    return this.gate.isSatisfied(declarer, slotBearer) ? this.amount : 0;
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
    const related =
      relation === 'self'
        ? owner
        : relation === 'parent'
          ? owner.parent
          : relation === 'ancestor'
            ? owner.findAncestorWithProperty(this.targetPropertyGlobalId)
            : undefined;
    this.registerResolvedRelation(owner, relation, related, register);
  }

  /**
   * childがparentに付く/離れる際に、parent（owner）側のtarget=child効果を、その付いた/離れた子(child)へ
   * 登録/解除する。childは相手がownerから一意に辿れない唯一の関係のため、childを明示的に受け取る。
   */
  override registerChild(owner: WorldObject, child: WorldObject, register: boolean): void {
    this.registerResolvedRelation(owner, 'child', child, register);
  }

  /**
   * 内部共通処理: この効果の対象がrelationと一致するときだけrelatedの対象プロパティへ登録/解除する。
   * gateのself（＝slotBearer）はエッジの子側（child対象なら子=related、それ以外はowner）。
   * relationとrelatedに矛盾した組を外部から渡せないよう非公開。
   */
  private registerResolvedRelation(
    owner: WorldObject,
    relation: ReferenceRoot,
    related: WorldObject | undefined,
    register: boolean,
  ): void {
    if (this.target !== relation) return;
    const slotBearer = relation === 'child' ? related! : owner;
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
    targetOwner.registerPassiveEffect(
      this.targetPropertyGlobalId,
      new RegisteredPassiveEffect(declarer, slotBearer, this),
    );
  }

  /** targetOwnerの対象プロパティから、declarerが宣言した登録を解除する。 */
  private unregister(targetOwner: WorldObject | undefined, declarer: WorldObject): void {
    targetOwner?.unregisterPassiveEffectsFrom(declarer, this.targetPropertyGlobalId);
  }
}

/**
 * 条件が真の間だけ、都度導出される実効値に寄与する持続効果（可逆、8.3節）。実体値そのものは
 * 書き換えない。PropertyValueのmodify用incomingへ登録され、WorldObject.getEffectiveValueが走査する。
 */
export class ModifyEffect extends PropertyPassiveEffect {
  constructor(
    target: ReferenceRoot,
    targetPropertyGlobalId: number,
    amount: number,
    gate: PassiveEffectGate,
  ) {
    super(target, targetPropertyGlobalId, amount, gate);
  }

  protected get kindLabel(): string {
    return 'modify';
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
  constructor(
    target: ReferenceRoot,
    targetPropertyGlobalId: number,
    amount: number,
    gate: PassiveEffectGate,
  ) {
    super(target, targetPropertyGlobalId, amount, gate);
  }

  protected get kindLabel(): string {
    return 'add';
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
  applyTick(owner: WorldObject, session: WorldSession): void {
    if (!this.gate.isSatisfied(owner, owner)) return;
    this.transfer.apply(owner, session, undefined, undefined);
  }

  override collectInfluences(declarer: WorldObject, out: InfluenceWriter): void {
    this.transfer.collectInfluences(declarer, this.gate.isSatisfied(declarer, declarer), out);
  }

  override describe(names: DefNames, out: DescriptionWriter): void {
    const gate = this.gate.describe(names);
    const suffix = gate.length > 0 ? [text('（'), ...gate, text('間、tick毎）')] : [text('（tick毎）')];
    this.transfer.describe(names, out, suffix);
  }

  override affects(propertyGlobalId: number, ownedByDeclarer: boolean): boolean {
    return this.transfer.affects(propertyGlobalId, ownedByDeclarer);
  }
}
