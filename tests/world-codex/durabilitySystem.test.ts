import { beforeAll, describe, expect, it } from 'vitest';
import { toolWearsOf } from '../../src/analysis/durations';
import type {
  ConditionDeclaration,
  ConditionReader,
  PropertyConditionReading,
} from '../../src/domain/ConditionReader';
import type { PropertyGlobalId } from '../../src/domain/GlobalId';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { bundledCodex } from '../support/worldCodexFiles';

/**
 * `docs/engine/DurabilitySystem.md` が置いている耐久の規約を、同梱の定義全体に当てる。
 *
 * 1節（上限960）も2.1節（余力を見る線の引き方）も、**物ごとの宣言が守って初めて本当になる**決めごと
 * で、破っても個別の試験は緑のまま通る——落とし穴が2,880を名乗ったまま気付かれなかったのが
 * issue #2164。ここは型を1つも名指しせず、`durability` を持つもの・道具として減るものを全部
 * 引いて当てるので、**新しく足した物も同じ線で見張られる。**
 */
describe('耐久の規約（同梱の定義すべて）', () => {
  /** 1節のスケール。寿命は上限ではなくレートが作る。 */
  const SCALE = 960;

  let codex: WorldCodex;
  let durabilityId: PropertyGlobalId;

  beforeAll(() => {
    codex = bundledCodex();
    durabilityId = codex.propertyNames.getId('durability');
  });

  it('durabilityの上限は、素材・アイテムの種類によらず960', () => {
    // 1節。長持ちを上限で作ると、同じレートが物ごとに違う日数を意味することになり、
    // 「tickあたりの減少量 = 10 ÷ 寿命の日数」が読めなくなる。
    const offenders = [...codex.objects]
      .map((def) => ({ name: def.name, max: def.tryGetPropertyDef(durabilityId)?.range?.max }))
      .filter((row) => row.max !== undefined && row.max !== SCALE);

    expect(offenders, `上限が${SCALE}でない宣言が在る`).toEqual([]);
  });

  it('道具のいちばん安い使い道には線が無く、それより高い工程には食う量ちょうどの線が在る', () => {
    // 2.1節。線が守るのは工程の成果ではなく、その道具に残っていた安い使い道なので、いちばん安い
    // 使い道に引くと「何にも使えないのに消えもしない札」が残る。
    //
    // **食う量は宣言から読む**（timberYaml.test.tsと同じ理由）。直値で書くと線の側しか見ないことに
    // なり、`add` を動かしても緑のままになる。
    const lines = wearLines();
    expect(lines.length, '道具として減る宣言が1つも拾えていない').toBeGreaterThan(0);

    const cheapest = new Map<string, number>();
    for (const line of lines)
      cheapest.set(line.toolName, Math.min(cheapest.get(line.toolName) ?? Infinity, line.cost));

    expect(lines.map(describeLine)).toEqual(
      lines.map((line) =>
        describeLine({
          ...line,
          threshold: line.cost === cheapest.get(line.toolName) ? undefined : line.cost,
        }),
      ),
    );
  });

  /** その道具の使い道1つ。costはその工程1回が削る量、thresholdは引かれている線（無ければundefined）。 */
  interface WearLine {
    readonly toolName: string;
    readonly stepName: string;
    readonly ownerName: string;
    readonly cost: number;
    readonly threshold: number | undefined;
  }

  /** ずれた行がどの宣言のものか名前で引けるように、1行を文へ均す。 */
  function describeLine(line: WearLine): string {
    const drawn = line.threshold === undefined ? '線なし' : `gte: ${line.threshold}`;
    return `${line.toolName} を ${line.ownerName}.${line.stepName} で使う（${line.cost}）: ${drawn}`;
  }

  /** 同梱の定義が持つ「使うたびに減る」宣言すべてに、その工程が引いている線を添えたもの。 */
  function wearLines(): readonly WearLine[] {
    return toolWearsOf(codex)
      .filter((wear) => wear.propertyName === 'durability')
      .map((wear) => ({
        toolName: wear.objectName,
        stepName: wear.stepName,
        ownerName: wear.stepOwnerName,
        cost: capacityOf(wear.objectName) / wear.uses,
        threshold: lineDrawnOn(wear.stepOwnerName, wear.stepName),
      }));
  }

  /** その道具が満タンから使い切るまでの量（上の規約により960）。 */
  function capacityOf(toolName: string): number {
    const range = codex.objects.get(codex.objectNames.getId(toolName)).tryGetPropertyDef(durabilityId)?.range;
    expect(range, `${toolName} が durability を持たない`).toBeDefined();
    return range!.max;
  }

  /**
   * その工程が、使う物（instrument）の余力へ引いている線。引いていなければundefined。
   *
   * **複数引かれていれば最も高いものを返す**——線を1本足して緩められないように、当てる側は最も
   * 厳しい1つを見る。
   */
  function lineDrawnOn(ownerName: string, stepName: string): number | undefined {
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
});

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
