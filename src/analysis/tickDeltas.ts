import type { ObjectDef } from '../domain/defs/ObjectDef';
import type { TransferReading } from '../domain/defs/EffectReader';
import type {
  GateReading,
  PassiveDeclaration,
  PassivePropertyReading,
  PassiveReader,
} from '../domain/defs/PassiveReader';
import type { ReferenceRoot } from '../domain/defs/ReferenceRoot';

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
    this.deltas.push({
      target: reading.target,
      propertyGlobalId: reading.propertyGlobalId,
      amount: reading.amount,
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
  const watched: number[] = [];
  gate.conditions?.collectWatchedProperties('self', (propertyGlobalId) => watched.push(propertyGlobalId));
  return { stage: gate.stage, conditional: gate.conditions !== undefined, watchedSelfProperties: watched };
}
