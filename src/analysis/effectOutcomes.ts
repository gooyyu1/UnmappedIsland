import type { EffectReader, PickCandidateReading, TransferReading } from '../domain/defs/EffectReader';
import type { ObjectRef } from '../domain/defs/ObjectRef';
import type { ReferenceRoot } from '../domain/defs/ReferenceRoot';
import type { StepOutcome } from './CraftingStep';
import { UNCHANGED_OUTCOMES, combineOutcomes, scaleOutcomes } from './CraftingStep';
import type { StaticValueResolver } from './staticValue';
import { resolveWeight } from './staticValue';

/**
 * 効果の宣言（EffectReader）を、**起こりうる結果の一覧**へ開く（StepOutcome参照）。
 *
 * ここが置いている近似は2つ。**重みを確率に読み替えること**——実際の抽選は実行時の実効値で
 * 行われるので、宣言値から出す確率はその代用でしかない。そして**分岐を直積で畳むこと**——
 * 宣言順に並んだ効果は順に起こるので、pickが2つ並べば枝は掛け算になる。
 */
export function outcomesOf(declaration: Readable, resolve: StaticValueResolver): readonly StepOutcome[] {
  const reader = new OutcomeReader(resolve);
  declaration.read(reader);
  return reader.outcomes;
}

/** 自分が何を宣言しているかを読み上げられるもの（効果そのものと、それを抱える操作）。 */
export interface Readable {
  read(reader: EffectReader): void;
}

/**
 * 読み上げを受け取りながら分岐を畳んでいく読み手。宣言順に受け取るので、受け取るたびに今までの枝と
 * 直積を取れば「順に起こる」がそのまま表せる。
 */
class OutcomeReader implements EffectReader {
  outcomes: readonly StepOutcome[] = UNCHANGED_OUTCOMES;

  private readonly resolve: StaticValueResolver;

  constructor(resolve: StaticValueResolver) {
    this.resolve = resolve;
  }

  set(target: ReferenceRoot, propertyGlobalId: number, value: number): void {
    this.combine([
      { probability: 1, spawns: [], deltas: [], assignments: [{ target, propertyGlobalId, value }] },
    ]);
  }

  add(target: ReferenceRoot, propertyGlobalId: number, amount: number): void {
    this.combine([
      { probability: 1, spawns: [], deltas: [{ target, propertyGlobalId, amount }], assignments: [] },
    ]);
  }

  spawn(objectGlobalId: number, count: number): void {
    this.combine([{ probability: 1, spawns: [{ objectGlobalId, count }], deltas: [], assignments: [] }]);
  }

  /** オブジェクトごと消すだけで、値も産出も動かない（消えたかどうかは工程の側がdestroysで問う）。 */
  destroy(_target: ObjectRef): void {}

  transfer(reading: TransferReading): void {
    this.combine([
      {
        probability: 1,
        spawns: [],
        deltas: [
          { target: reading.from, propertyGlobalId: reading.fromPropertyGlobalId, amount: -reading.amount },
          { target: reading.to, propertyGlobalId: reading.toPropertyGlobalId, amount: reading.toAmount },
          ...reading.linked,
        ],
        assignments: [],
      },
    ]);
  }

  /** 居場所が変わるだけで、値も産出も動かない。 */
  move(): void {}

  /** 出来事を告げるだけで、世界の形は変わらない。 */
  signal(_name: string): void {}

  /**
   * 候補ごとに枝分かれさせ、重みを確率へ直す。**抽選の規約に合わせる**——負の重みは0として扱い、
   * 全候補の重みが0なら先頭の候補だけが起こる（PickEffect.selectWeighted）。
   *
   * 解けない重みは0として数える。そのぶん配分は歪むので、読み手が気付けるように、工程を組む側が
   * 「確定しない」印を立てる（craftingStepsのtrack）。
   */
  pick(candidates: readonly PickCandidateReading[]): void {
    if (candidates.length === 0) return;

    const weights = candidates.map((candidate) =>
      Math.max(0, resolveWeight(candidate.weight, this.resolve) ?? 0),
    );
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (total <= 0) {
      this.combine(outcomesOf(candidates[0].effect, this.resolve));
      return;
    }

    this.combine(
      candidates.flatMap((candidate, index) =>
        scaleOutcomes(outcomesOf(candidate.effect, this.resolve), weights[index] / total),
      ),
    );
  }

  private combine(outcomes: readonly StepOutcome[]): void {
    this.outcomes = combineOutcomes(this.outcomes, outcomes);
  }
}
