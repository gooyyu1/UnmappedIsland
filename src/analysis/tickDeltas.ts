import type {
  ConditionDeclaration,
  ConditionOp,
  ConditionReader,
  PropertyConditionReading,
} from '../domain/ConditionReader';
import type { ObjectDef } from '../domain/ObjectDef';
import type { TransferReading } from '../domain/EffectReader';
import type {
  GateReading,
  PassiveDeclaration,
  PassivePropertyReading,
  PassiveReader,
} from '../domain/PassiveReader';
import type { ReferenceRoot } from '../domain/ReferenceRoot';
import type { TypeMatchReading } from '../domain/TypeMatchRule';

/**
 * tick毎に実体値を動かす持続効果を、実行時のオブジェクトを使わずに読んだもの（8.4節）。
 * 可逆な寄与（`modify`、8.3節）は実体値を動かさないので含まない。
 */
export interface TickDelta {
  readonly target: ReferenceRoot;
  readonly propertyGlobalId: number;
  readonly amount: number;
  readonly gate: TickGate;

  /** 在庫の続く間だけ動く輸送（8.4節のtransfer）か。真ならamountは上限で、実際はそれ以下になりうる。 */
  readonly capped: boolean;
}

/** tick毎の増減を縛るゲートの、定義だけから読める姿。 */
export class TickGate {
  /** 段で縛られているならその段（8.2節）。常時効くならundefined。 */
  readonly stage: { readonly propertyGlobalId: number; readonly name: string } | undefined;

  /**
   * 段以外の条件（conditions、14節）。無ければundefined。
   *
   * **「縛られているか」の1ビットへ畳まず、宣言そのものを持つ。** 畳むと、置けば成立する罠の判定と、
   * 囲いと飼葉が要るヤケイの繁殖が同じ姿になり、何の条件かを名前で出せなくなる（issue #961）。
   * 以降のフィールドは、この宣言から**特定の問いのために**取り出した答えで、条件そのものではない。
   */
  readonly conditions: ConditionDeclaration | undefined;

  /**
   * 条件が見ている、宣言元自身のプロパティ。**その増減がいつまで効くか**の手掛かりで、出血なら
   * `bleeding`——それが尽きた時点で血を奪うのが止まる。
   */
  readonly watchedSelfProperties: readonly number[];

  /**
   * 増減が効くために、宣言元自身が入っていなければならない段（6.4節）。**その増減がいつから効き
   * 始めるか**の手掛かりで、膿んだ傷が宿主の菌を押し上げる増減なら `infection` の `festering`
   * ——そこへ届くまでは効かない。{@link watchedSelfProperties} の裏側。
   *
   * 段の宣言の下に置かれた増減（8.2節）と、条件が名指した段（`in_stage`・`in_stage_or_above`、
   * 14.1節）のどちらもここへ来る。**ちょうどその段かその段以上かは分けない**——どちらも同じ下端を
   * 下から跨いだ時点で成立するので、そこへ届くまでの時間は変わらない。
   */
  readonly requiredSelfStages: readonly SelfStageRequirement[];

  /**
   * 条件が祖先（＝置かれている場所）に課している比較のうち、**成立していなければ効かない**もの。
   * 外の状態でしか決まらない増減——雨で溜まる水は `ancestor.weather` が雨の間だけ増える——を、
   * その状態が続く時間から数えられるようにする。
   */
  readonly ancestorConditions: readonly AncestorCondition[];

  /** 条件が宣言元自身の型に課している指定のうち、成立していなければ効かないもの。 */
  private readonly selfTypeMatches: readonly TypeMatchReading[];

  /** 型だけでは真偽の決まらない条件が残っているか（{@link conditional}）。 */
  private readonly hasRuntimeConditions: boolean;

  constructor(gate: GateReading) {
    const collector = new GateConditionCollector();
    gate.conditions?.read(collector);

    this.stage = gate.stage;
    this.conditions = gate.conditions;
    this.watchedSelfProperties = collector.selfProperties;
    this.requiredSelfStages = [
      ...(gate.stage === undefined
        ? []
        : [{ propertyGlobalId: gate.stage.propertyGlobalId, stageName: gate.stage.name }]),
      ...collector.requiredSelfStages,
    ];
    this.ancestorConditions = collector.ancestorConditions;
    this.selfTypeMatches = collector.selfTypeMatches;
    this.hasRuntimeConditions = collector.hasRuntimeConditions;
  }

  /**
   * 段以外の条件でも縛られているか。真なら、その条件が成立している間だけ効く。
   *
   * **型だけで真偽の決まる条件は、縛りとして数えない。** 塩蔵されていない間だけ効く腐敗（`not`で
   * `cured`タグを見る）は、塩漬けの版では一度も効かず、生の版では常に効く——どちらでも「成立する
   * 場合としない場合がある」ではない。成立しない側は{@link possibleFor}が宣言ごと落とすので、
   * ここまで来たものは常に効く。
   */
  get conditional(): boolean {
    return this.hasRuntimeConditions;
  }

  /**
   * その型で成り立ちうるゲートか。**蒸発も雨も口径ごとに宣言が分かれており**（`self` の型を見る
   * 条件）、ヤシの器あての宣言は甕にとって一度も効かない。宣言を持っていることと、それがその型で
   * 効くことは別。
   */
  possibleFor(def: ObjectDef): boolean {
    return this.selfTypeMatches.every((match) => matchesType(def, match));
  }
}

/** 増減が効くために、宣言元自身が入っていなければならない段1つ（TickGate.requiredSelfStages）。 */
export interface SelfStageRequirement {
  readonly propertyGlobalId: number;
  readonly stageName: string;
}

/** 祖先のプロパティに課された比較1つ。 */
export interface AncestorCondition {
  readonly propertyGlobalId: number;
  readonly op: ConditionOp;

  /** 比較の相手。別のプロパティを見ている比較（valueRef）はここへ来ない。 */
  readonly values: readonly number[];
}

/**
 * その型が宣言している、tick毎に実体値を動かす分を宣言順に挙げる。「1日に何がどれだけ要るか」は
 * これを96倍すれば出る。**その型では成り立ちようのない条件で縛られた宣言は含まない**
 * （TickDeltaCollector.tickGateOf）。
 */
export function tickDeltasOf(def: ObjectDef): readonly TickDelta[] {
  const collector = new TickDeltaCollector(def);
  for (const declaration of def.passives.declarations) (declaration as PassiveDeclaration).read(collector);
  return collector.deltas;
}

class TickDeltaCollector implements PassiveReader {
  readonly deltas: TickDelta[] = [];

  private readonly def: ObjectDef;

  constructor(def: ObjectDef) {
    this.def = def;
  }

  /** 可逆な寄与は実体値を動かさない（8.3節）ので数えない。 */
  modify(): void {}

  accumulate(reading: PassivePropertyReading): void {
    // 導出される量（PassiveAmount）を持つのは中身の重さの伝播だけで、それは可逆な寄与
    // （modify）なのでここへは来ない。1 tickの増減として数えられるのは定数だけ。
    if (reading.amount.kind !== 'fixed') return;

    const gate = this.tickGateOf(reading.gate);
    if (gate === undefined) return;

    this.deltas.push({
      target: reading.target,
      propertyGlobalId: reading.propertyGlobalId,
      amount: reading.amount.value,
      gate,
      capped: false,
    });
  }

  /** 輸送の両端を、在庫の続く間だけ動く増減（capped）として並べる。量は輸送自身が名乗る。 */
  transfer(reading: TransferReading, gate: GateReading): void {
    const tickGate = this.tickGateOf(gate);
    if (tickGate === undefined) return;

    const ends = [
      { target: reading.from, propertyGlobalId: reading.fromPropertyGlobalId, amount: -reading.amount },
      { target: reading.to, propertyGlobalId: reading.toPropertyGlobalId, amount: reading.toAmount },
      ...reading.linked,
    ];
    for (const end of ends) this.deltas.push({ ...end, gate: tickGate, capped: true });
  }

  /**
   * ゲートの宣言を読み下す。**この型では成り立ちようのない条件で縛られているならundefined**
   * （TickGate.possibleFor）。
   */
  private tickGateOf(gate: GateReading): TickGate | undefined {
    const tickGate = new TickGate(gate);
    return tickGate.possibleFor(this.def) ? tickGate : undefined;
  }
}

/** 型の指定（4.1節）が、その型自身に当てはまるか。 */
function matchesType(def: ObjectDef, match: TypeMatchReading): boolean {
  switch (match.kind) {
    case 'tag':
      return def.hasTag(match.tagGlobalId);
    case 'object':
      return def.globalId === match.objectGlobalId;
    case 'not':
      return !matchesType(def, match.inner);
  }
}

/**
 * 条件の木から、増減がいつ効くかの手掛かりを集める——宣言元自身（self）の見られているプロパティ
 * （出血は `bleeding` が尽きるまでしか効かない）、名指された自身の段（膿んだ傷が宿主の菌を
 * 押し上げ始めるのは `infection` が `festering` へ届いてから）、祖先に課された比較（雨は降っている
 * 間だけ効く）、
 * そして宣言元自身の型に課された指定（口径ごとに分かれた蒸発・雨の宣言）。
 *
 * selfのプロパティは比較の相手（valueRef）を数えない——尽きて条件が外れるのは、見ている側の値が
 * 動いたときだから。自身の段・祖先・型の指定は**論理積の枝にあるものだけ**を採る（下のreadAlternative）。
 *
 * **ここが集めるのは上の問いへの答えだけで、条件そのものではない。** 枠を見る葉
 * （`{in_slot}`・`{slot, matches}`）はどれにも答えない——枠に入っているかは、尽きる値でも
 * 祖先の状態でも型でもない——ので空のまま。何が書かれているかは `TickGate.conditions` が
 * 宣言のまま持つ。
 */
class GateConditionCollector implements ConditionReader {
  readonly selfProperties: number[] = [];
  readonly requiredSelfStages: SelfStageRequirement[] = [];
  readonly ancestorConditions: AncestorCondition[] = [];
  readonly selfTypeMatches: TypeMatchReading[] = [];

  /** 型の指定以外の葉を1つでも読んだか（TickGate.conditional）。 */
  hasRuntimeConditions = false;

  /** 今読んでいる枝の比較が、成立していなければ増減が効かないものか。 */
  private required = true;

  /** 今読んでいる枝が否定の下にあるか。型の指定はここで裏返して集める。 */
  private negated = false;

  property(reading: PropertyConditionReading): void {
    this.hasRuntimeConditions = true;
    if (reading.root === 'self') this.selfProperties.push(reading.propertyGlobalId);
    if (reading.root !== 'ancestor' || !this.required || this.negated || reading.values === undefined) return;
    this.ancestorConditions.push({
      propertyGlobalId: reading.propertyGlobalId,
      op: reading.op,
      values: reading.values,
    });
  }

  propertyStage(root: ReferenceRoot, propertyGlobalId: number, stageName: string): void {
    this.hasRuntimeConditions = true;
    if (root !== 'self') return;
    this.selfProperties.push(propertyGlobalId);
    if (this.required && !this.negated) this.requiredSelfStages.push({ propertyGlobalId, stageName });
  }

  slotPosition(): void {
    this.hasRuntimeConditions = true;
  }

  slotContent(): void {
    this.hasRuntimeConditions = true;
  }

  objectMatches(root: ReferenceRoot, match: TypeMatchReading): void {
    if (root !== 'self' || !this.required) {
      this.hasRuntimeConditions = true;
      return;
    }
    this.selfTypeMatches.push(this.negated ? { kind: 'not', inner: match } : match);
  }

  /** **否定の下の論理積は論理和**（「aかつbでない」＝「aでない、またはbでない」）。 */
  all(children: readonly ConditionDeclaration[]): void {
    if (this.negated) {
      this.any(children);
      return;
    }
    for (const child of children) child.read(this);
  }

  /**
   * 論理和の下の枝。**自身の段も祖先の比較も型の指定も集めない**——「どれかが成り立てばよい」は、
   * その比較が成立していることそのものではない。集めてしまうと、効き始めまでの時間も外の状態が
   * 続く時間も数え違え、効く型を取り違える。どれが成り立って増減が効いたのかも、定義だけでは
   * 決まらない。
   */
  any(children: readonly ConditionDeclaration[]): void {
    this.hasRuntimeConditions = true;

    const outer = this.required;
    this.required = false;
    for (const child of children) child.read(this);
    this.required = outer;
  }

  /**
   * 否定の下の枝。**型の指定だけは裏返して集める**——「`cured`でないこと」はその型を見れば決まる
   * ので、成立するかどうかが分かれる条件ではない。自身の段と祖先の比較は集めない：「成り立たない
   * こと」は、その比較が成立していることそのものではなく、集めると効き始めまでの時間と外の状態が
   * 続く時間を数え違える。
   */
  not(child: ConditionDeclaration): void {
    const outer = this.negated;
    this.negated = !this.negated;
    child.read(this);
    this.negated = outer;
  }
}
