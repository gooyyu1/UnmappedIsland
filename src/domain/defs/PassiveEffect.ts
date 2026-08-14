import type { PropertyValue } from '../runtime/PropertyValue';
import { RegisteredPassiveEffect } from '../runtime/RegisteredPassiveEffect';
import type { WorldObject } from '../runtime/WorldObject';
import type { ConditionNode } from './ConditionNode';
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
 * modify（条件が真の間だけ実効値へ寄与＝可逆）と`add`（条件が真の間tick毎に実体値へ加減算＝不可逆）は
 * 別クラスで表し、判別用のkindは持たない。唯一の差は「PropertyValueのどちらのincomingへ登録されるか」で、
 * registerIntoの実装で表現する。
 *
 * **動詞が名乗るのは可逆性だけで、一度きりかtick毎かは置き場所（active／passives）が決める**
 * （8.4節）。そのため不可逆な加減算はどちらの置き場所でも `add` と書き、クラス名だけが
 * 「毎tick実体値へ積分する」という中身（AccumulateEffect）を名乗る。
 *
 * 登録先の解決と登録/解除はtargetの種別に応じて自分で行い、呼び出し側（WorldObject）はライフサイクルの
 * 契機で登録/解除を依頼するだけで、どのtargetがどこへ紐付くかは知らない。
 *
 * アクション/combination/pickの一時的な `add`（実行の瞬間に1回だけ効く）は、持続するゲート判定が不要な
 * ため、この登録の仕組みには乗らない。
 */
export abstract class PassiveEffect {
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

  /**
   * この効果がpropertyGlobalIdのプロパティを書き換えうるか（プロパティ側からの逆引き用）。
   *
   * ownedByDeclarerは、そのプロパティが宣言元のobject_def自身のものか。target=selfの効果は
   * 宣言元自身のプロパティしか書き換えないため、他の型の同名プロパティは書き換え対象にならない。
   */
  affects(propertyGlobalId: number, ownedByDeclarer: boolean): boolean {
    if (this.targetPropertyGlobalId !== propertyGlobalId) return false;
    return ownedByDeclarer || this.target !== 'self';
  }

  /** この効果を1行で書き表す（Description参照）。 */
  describe(names: DefNames, out: DescriptionWriter): void {
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
  registerRelation(owner: WorldObject, relation: ReferenceRoot, register: boolean): void {
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
  registerChild(owner: WorldObject, child: WorldObject, register: boolean): void {
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
export class ModifyEffect extends PassiveEffect {
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

  registerInto(target: PropertyValue, registration: RegisteredPassiveEffect): void {
    target.registerModify(registration);
  }
}

/**
 * 条件が真の間、tick毎に実体値そのものへ加減算し続ける持続効果（YAMLでは `add`、不可逆、8.4節）。
 * PropertyValueの積分用incomingへ登録され、WorldObject.tickが走査する。
 */
export class AccumulateEffect extends PassiveEffect {
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

  registerInto(target: PropertyValue, registration: RegisteredPassiveEffect): void {
    target.registerAccumulate(registration);
  }
}
