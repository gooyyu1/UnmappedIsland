import type { ObjectDef } from '../domain/ObjectDef';
import type { PassivePropertyReading, PassiveReader } from '../domain/PassiveReader';
import type { PropertyGlobalId } from '../domain/GlobalId';

/**
 * 段（6.4節）が自分の別のプロパティへ与える寄与を、段の名前ごとに読む手立て。
 *
 * **表の数値を書き写さず、段そのものを読むため**にある——時刻と天気が明るさへ与える寄与も
 * （`activityHours.ts`）、季節が風向きの重みへ与える寄与も（`voyageLegs.ts`）、宣言は同じ形
 * （`stages` の `passives` にある `modify`）なので、読み方も1つで足りる。
 */

/**
 * defが宣言している段のうち、propertyGlobalIdを対象にmodifyし、gateByPropertyGlobalIdの段で
 * ゲートされているものを、段名 → 加算量の合計として集める。実行時のオブジェクトを使わず、
 * ロード済みの持続効果宣言（passives）を読み下すだけ。
 */
export function stageModifyDeltasOf(
  def: ObjectDef,
  propertyGlobalId: PropertyGlobalId,
  gateByPropertyGlobalId: PropertyGlobalId,
): ReadonlyMap<string, number> {
  const collector = new StageModifyCollector(propertyGlobalId, gateByPropertyGlobalId);
  def.passives.read(collector);
  return collector.deltas;
}

class StageModifyCollector implements PassiveReader {
  readonly deltas = new Map<string, number>();

  constructor(
    private readonly propertyGlobalId: PropertyGlobalId,
    private readonly gateByPropertyGlobalId: PropertyGlobalId,
  ) {}

  modify(reading: PassivePropertyReading): void {
    if (reading.target !== 'self' || reading.propertyGlobalId !== this.propertyGlobalId) return;
    if (reading.amount.kind !== 'fixed') return;

    const stage = reading.gate.stage;
    if (stage === undefined || stage.propertyGlobalId !== this.gateByPropertyGlobalId) return;

    this.deltas.set(stage.name, (this.deltas.get(stage.name) ?? 0) + reading.amount.value);
  }

  accumulate(): void {}

  transfer(): void {}
}
