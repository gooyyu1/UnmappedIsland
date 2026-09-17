import type {
  ConditionDeclaration,
  ConditionReader,
  PropertyConditionReading,
} from '../../src/domain/ConditionReader';
import type { PropertyGlobalId } from '../../src/domain/GlobalId';
import type { WorldCodex } from '../../src/domain/WorldCodex';

/**
 * その工程が、使う物（instrument）の余力（`durability`）へ引いている線
 * （[`docs/engine/DurabilitySystem.md`](../../docs/engine/DurabilitySystem.md) 2.1節）。引いていなければ
 * undefined。
 *
 * **複数引かれていれば最も高いものを返す**——線を1本足して緩められないように、当てる側は最も厳しい
 * 1つを見る。
 *
 * **同梱の定義全体に当てる側（durabilitySystem.test.ts）と、伐採の線を当てる側
 * （timberYaml.test.ts）が同じ口を使う**——読み方が2つに割れると、片方だけが緩む。
 */
export function instrumentDurabilityLineOf(
  codex: WorldCodex,
  ownerName: string,
  stepName: string,
): number | undefined {
  const durabilityId = codex.propertyNames.getId('durability');
  const owner = codex.objects.get(codex.objectNames.getId(ownerName));
  const thresholds: number[] = [];
  for (const trigger of owner.triggers) {
    if (trigger.interaction.name !== stepName) continue;
    for (const requirement of trigger.interaction.requirementDeclarations) {
      const reader = new InstrumentDurabilityLines(durabilityId);
      requirement.condition.readBy(reader);
      thresholds.push(...reader.thresholds);
    }
  }
  return thresholds.length === 0 ? undefined : Math.max(...thresholds);
}

/**
 * 条件の木から「使う物の余力がこれ以上」だけを拾う読み手（ConditionReader参照）。
 *
 * **否定の下へは降りない。** `not` の下の `gte` は「余力が足りないときだけ成立する」で、始めさせない
 * 線とは逆を言っている。
 */
class InstrumentDurabilityLines implements ConditionReader {
  readonly thresholds: number[] = [];

  constructor(private readonly durabilityId: PropertyGlobalId) {}

  property(reading: PropertyConditionReading): void {
    if (reading.root !== 'instrument') return;
    if (reading.propertyGlobalId !== this.durabilityId) return;
    if (reading.op !== 'gte') return;

    // gteが比べる相手は常に1つ（ConditionReader）。別のプロパティを見ている比較には値が無い。
    const values = reading.values ?? [];
    if (values.length > 0) this.thresholds.push(values[0]);
  }

  propertyStage(): void {}

  slotPosition(): void {}

  slotContent(): void {}

  objectMatches(): void {}

  all(children: readonly ConditionDeclaration[]): void {
    for (const child of children) child.readBy(this);
  }

  any(children: readonly ConditionDeclaration[]): void {
    for (const child of children) child.readBy(this);
  }

  not(): void {}
}
