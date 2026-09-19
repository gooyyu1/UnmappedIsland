import type {
  ConditionDeclaration,
  ConditionOp,
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
 * 相手自身の進みをその値に固定したとき、その工程が成立するか
 * （[`DurabilitySystem.md`](../../docs/engine/DurabilitySystem.md) 2.1節）。
 *
 * **余力の線がいつ効くのかを問うための口。** 同じ進みの値で、使う物の余力が線に届いている場合
 * （`instrumentAboveLine` が真）と届いていない場合とを引き比べれば、**その値のときに線が断る側へ
 * 回るか**が分かる——線をどう書いたか（平らに並べたか、`any` で包んだか）に依らずに問える。
 *
 * **進みと余力の他は、どの葉も「不明」として読む。** 明るさも天候も、進みの値とは関わりなく同じに
 * 掛かるので、ここで真偽を決めつけると「線が断った」と区別が付かなくなる。**真として読まないのは
 * `not` があるから**——否定の下の真は偽になり、その手を丸ごと「立たない」側へ倒してしまう。同じ理由で、
 * 余力の葉として読むのは始めさせない向きの比較（`gte`）だけ。
 */
export function stepStandsAt(
  codex: WorldCodex,
  ownerName: string,
  stepName: string,
  progress: ReadonlyMap<PropertyGlobalId, number>,
  instrumentAboveLine: boolean,
): boolean {
  const owner = codex.objects.get(codex.objectNames.getId(ownerName));
  const context: TruthContext = {
    progress,
    durabilityGlobalId: codex.propertyNames.getId('durability'),
    instrumentAboveLine,
  };
  for (const trigger of owner.triggers) {
    if (trigger.interaction.name !== stepName) continue;
    for (const requirement of trigger.interaction.requirementDeclarations)
      // 断ると言い切れるものだけが、手を立たなくする（不明は掛からない）。
      if (truthOf(requirement.condition, context) === false) return false;
  }
  return true;
}

/** `stepStandsAt` が条件を読み下すときに固定しているもの。 */
interface TruthContext {
  readonly progress: ReadonlyMap<PropertyGlobalId, number>;
  readonly durabilityGlobalId: PropertyGlobalId;
  readonly instrumentAboveLine: boolean;
}

function truthOf(condition: ConditionDeclaration, context: TruthContext): boolean | undefined {
  const reader = new ConditionTruthUnderProgress(context);
  condition.readBy(reader);
  return reader.truth;
}

/** 固定した進みと余力のもとで条件の木を読み下す読み手（ConditionReader参照）。 */
class ConditionTruthUnderProgress implements ConditionReader {
  /** 読み下した真偽。**固定していない葉はundefined**——真偽どちらへも倒さない（上の注記）。 */
  truth: boolean | undefined;

  constructor(private readonly context: TruthContext) {}

  property(reading: PropertyConditionReading): void {
    if (
      reading.root === 'instrument' &&
      reading.propertyGlobalId === this.context.durabilityGlobalId &&
      reading.op === 'gte'
    ) {
      this.truth = this.context.instrumentAboveLine;
      return;
    }
    if (reading.root !== 'self' || reading.valueRef !== undefined || reading.values === undefined) return;
    const value = this.context.progress.get(reading.propertyGlobalId);
    if (value !== undefined) this.truth = comparisonTruth(reading.op, value, reading.values);
  }

  propertyStage(): void {}

  slotPosition(): void {}

  slotContent(): void {}

  objectMatches(): void {}

  all(children: readonly ConditionDeclaration[]): void {
    const truths = children.map((child) => truthOf(child, this.context));
    // 1つでも断れば断る。残りが不明なら、真とは言い切れない。
    this.truth = truths.includes(false) ? false : truths.includes(undefined) ? undefined : true;
  }

  any(children: readonly ConditionDeclaration[]): void {
    const truths = children.map((child) => truthOf(child, this.context));
    // 1つでも通れば通る。残りが不明なら、偽とは言い切れない。
    this.truth = truths.includes(true) ? true : truths.includes(undefined) ? undefined : false;
  }

  not(child: ConditionDeclaration): void {
    const inner = truthOf(child, this.context);
    this.truth = inner === undefined ? undefined : !inner;
  }
}

function comparisonTruth(op: ConditionOp, value: number, values: readonly number[]): boolean {
  switch (op) {
    case 'lt':
      return value < values[0];
    case 'lte':
      return value <= values[0];
    case 'gt':
      return value > values[0];
    case 'gte':
      return value >= values[0];
    case 'eq':
      return value === values[0];
    case 'neq':
      return value !== values[0];
    case 'in':
      return values.includes(value);
    case 'not_in':
      return !values.includes(value);
  }
}

/**
 * 条件の木から「使う物の余力がこれ以上」だけを拾う読み手（ConditionReader参照）。
 *
 * **否定の下へは降りない。** `not` の下の `gte` は「余力が足りないときだけ成立する」で、始めさせない
 * 線とは逆を言っている。
 *
 * **`any` の下へは降りる。** どちらか一方で足りる枝に在る閾値は常に効くわけではないが、**引かれて
 * いること自体は同じ**なので、ここで落とすと「包めば見張りから消える」道ができる。**いつ効くのかを
 * 問うのは `stepStandsAt` の側**（[`DurabilitySystem.md`](../../docs/engine/DurabilitySystem.md) 2.1節）。
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
