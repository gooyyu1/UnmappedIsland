import type {
  ConditionDeclaration,
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
export interface TickGate {
  /** 段で縛られているならその段（8.2節）。常時効くならundefined。 */
  readonly stage: { readonly propertyGlobalId: number; readonly name: string } | undefined;

  /** 段以外の条件（conditions）でも縛られているか。真なら、その条件が成立している間だけ効く。 */
  readonly conditional: boolean;

  /**
   * 条件が見ている、宣言元自身のプロパティ。**その増減がいつまで効くか**の手掛かりで、出血なら
   * `bleeding`——それが尽きた時点で血を奪うのが止まる。
   */
  readonly watchedSelfProperties: readonly number[];
}

/**
 * その型が宣言している、tick毎に実体値を動かす分を宣言順に挙げる。「1日に何がどれだけ要るか」は
 * これを96倍すれば出る。
 */
export function tickDeltasOf(def: ObjectDef): readonly TickDelta[] {
  const collector = new TickDeltaCollector();
  for (const declaration of def.passives.declarations) (declaration as PassiveDeclaration).read(collector);
  return collector.deltas;
}

class TickDeltaCollector implements PassiveReader {
  readonly deltas: TickDelta[] = [];

  /** 可逆な寄与は実体値を動かさない（8.3節）ので数えない。 */
  modify(): void {}

  accumulate(reading: PassivePropertyReading): void {
    // 導出される量（PassiveAmount）を持つのは中身の重さの伝播だけで、それは可逆な寄与
    // （modify）なのでここへは来ない。1 tickの増減として数えられるのは定数だけ。
    if (reading.amount.kind !== 'fixed') return;

    this.deltas.push({
      target: reading.target,
      propertyGlobalId: reading.propertyGlobalId,
      amount: reading.amount.value,
      gate: tickGateOf(reading.gate),
      capped: false,
    });
  }

  /** 輸送の両端を、在庫の続く間だけ動く増減（capped）として並べる。量は輸送自身が名乗る。 */
  transfer(reading: TransferReading, gate: GateReading): void {
    const tickGate = tickGateOf(gate);
    const ends = [
      { target: reading.from, propertyGlobalId: reading.fromPropertyGlobalId, amount: -reading.amount },
      { target: reading.to, propertyGlobalId: reading.toPropertyGlobalId, amount: reading.toAmount },
      ...reading.linked,
    ];
    for (const end of ends) this.deltas.push({ ...end, gate: tickGate, capped: true });
  }
}

/** ゲートの宣言を、増減がいつまで効くかを見積もれる形へ読み下す。 */
function tickGateOf(gate: GateReading): TickGate {
  const watched = new WatchedSelfProperties();
  gate.conditions?.read(watched);
  return {
    stage: gate.stage,
    conditional: gate.conditions !== undefined,
    watchedSelfProperties: watched.properties,
  };
}

/**
 * 条件が見ている、宣言元自身（self）のプロパティを集める。**その条件がいつまで成り立つか**を
 * 見積もる手掛かりで、出血は `bleeding` が尽きるまでしか効かない。
 *
 * 比較の相手側（valueRef）は数えない——尽きて条件が外れるのは、見ている側の値が動いたときだから。
 */
class WatchedSelfProperties implements ConditionReader {
  readonly properties: number[] = [];

  property(reading: PropertyConditionReading): void {
    if (reading.root === 'self') this.properties.push(reading.propertyGlobalId);
  }

  propertyStage(root: ReferenceRoot, propertyGlobalId: number): void {
    if (root === 'self') this.properties.push(propertyGlobalId);
  }

  slotPosition(): void {}

  slotContent(): void {}

  objectMatches(): void {}

  all(children: readonly ConditionDeclaration[]): void {
    for (const child of children) child.read(this);
  }

  any(children: readonly ConditionDeclaration[]): void {
    for (const child of children) child.read(this);
  }

  not(child: ConditionDeclaration): void {
    child.read(this);
  }
}
