import type {
  AddReading,
  EffectDeclaration,
  EffectReader,
  PickCandidateReading,
  TransferReading,
} from '../domain/EffectReader';
import type { ObjectRefReading } from '../domain/ObjectRef';
import type { ReferenceRoot } from '../domain/ReferenceRoot';
import type { StepOutcome } from './CraftingStep';
import { UNCHANGED_OUTCOMES, combineOutcomes, scaleOutcomes } from './CraftingStep';
import type { StaticValueResolver } from './staticValue';
import { resolveDeclaredNumber } from './staticValue';

/**
 * `become`（9.9節）の行き先の型を、定義だけから解く手立て。行き先を解けない——対象の型が定義から
 * 決まらない、あるいはその座標に型が居ない——ときはundefined。
 */
export type BecomeDestinationResolver = (
  subject: ObjectRefReading,
  axisValues: ReadonlyMap<string, string>,
) => number | undefined;

/** 効果の宣言を1度読み下した結果。 */
export interface EffectReading {
  /** 起こりうる結果の一覧（StepOutcome参照）。 */
  readonly outcomes: readonly StepOutcome[];

  /**
   * 消えるオブジェクトの指し先（`destroy`、9.3節）。**分岐をまたいで集めたもの**なので、
   * 「どれか1つの分岐で消えるか」しか言えない——どの確率で消えるかは分岐の側にある。
   */
  readonly destroyed: readonly ObjectRefReading[];

  /**
   * 別の型へ変わるオブジェクトの指し先（`become`、9.9節）。集め方は`destroyed`と同じ。
   *
   * **消えることとは別に持つ。** 工程の入力として使い切られる点は同じだが、個体は続いているので、
   * 値が端へ届いて自分が消える＝寿命（rangeEvents）とは読みが違う。
   */
  readonly transformed: readonly ObjectRefReading[];
}

/**
 * 効果の宣言（EffectReader）を読み下す。
 *
 * ここが置いている近似は2つ。**重みを確率に読み替えること**——実際の抽選は実行時の実効値で
 * 行われるので、宣言値から出す確率はその代用でしかない。そして**分岐を直積で畳むこと**——
 * 宣言順に並んだ効果は順に起こるので、pickが2つ並べば枝は掛け算になる。
 *
 * resolveBecomeDestinationを省くと、`become`の行き先は産出として数えられない。変わる前の型として
 * 残らないことは、行き先を解けなくても言えるので、省いても控える。
 */
export function readEffect(
  declaration: EffectDeclaration,
  resolve: StaticValueResolver,
  resolveBecomeDestination?: BecomeDestinationResolver,
): EffectReading {
  const reader = new OutcomeReader(resolve, resolveBecomeDestination);
  declaration.read(reader);
  return reader;
}

/** rootが指すオブジェクトを消す分岐があるか（`destroy`、9.3節）。 */
export function destroysRoot(reading: EffectReading, root: ReferenceRoot): boolean {
  return reading.destroyed.some((ref) => ref.kind === 'root' && ref.root === root);
}

/**
 * rootが指すオブジェクトが、その型のままでは残らない分岐があるか——消える（`destroy`）か、別の型に
 * 変わる（`become`）か。**工程がその入力を使い切るのはこの両方**で、消滅だけを問うと、中身入りへ
 * 変わったあとの空の容器が手元に残り続けることになる。
 */
export function consumesRoot(reading: EffectReading, root: ReferenceRoot): boolean {
  return (
    destroysRoot(reading, root) || reading.transformed.some((ref) => ref.kind === 'root' && ref.root === root)
  );
}

/**
 * 読み上げを受け取りながら分岐を畳んでいく読み手。宣言順に受け取るので、受け取るたびに今までの枝と
 * 直積を取れば「順に起こる」がそのまま表せる。
 */
class OutcomeReader implements EffectReader {
  outcomes: readonly StepOutcome[] = UNCHANGED_OUTCOMES;

  readonly destroyed: ObjectRefReading[] = [];

  readonly transformed: ObjectRefReading[] = [];

  private readonly resolve: StaticValueResolver;

  private readonly resolveBecomeDestination: BecomeDestinationResolver | undefined;

  constructor(resolve: StaticValueResolver, resolveBecomeDestination?: BecomeDestinationResolver) {
    this.resolve = resolve;
    this.resolveBecomeDestination = resolveBecomeDestination;
  }

  set(target: ReferenceRoot, propertyGlobalId: number, value: number): void {
    this.combine([
      { probability: 1, spawns: [], deltas: [], assignments: [{ target, propertyGlobalId, value }] },
    ]);
  }

  add(reading: AddReading): void {
    this.combine([{ probability: 1, spawns: [], deltas: [reading], assignments: [] }]);
  }

  spawn(objectGlobalId: number, count: number): void {
    this.combine([{ probability: 1, spawns: [{ objectGlobalId, count }], deltas: [], assignments: [] }]);
  }

  /** 消えたことは分岐に出ない（値も産出も動かない）ので、別に控える。 */
  destroy(target: ObjectRefReading): void {
    this.destroyed.push(target);
  }

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

  /**
   * 行き先の型が生まれたものとして数える（9.9節）。同じ個体が続くという意味では何も生まれていないが、
   * **「その型はどこから手に入るか」を問う側にとっては、変わった先が現れることが答えそのもの**
   * ——雨を受け始めた空の容器は、そこで水入りの容器になる。
   *
   * 変わる前の型として残らないことは`transformed`が控える（消えることとは別、EffectReading参照）。
   * 行き先を解けなければ、産出は数えられない。
   */
  become(subject: ObjectRefReading, axisValues: ReadonlyMap<string, string>): void {
    this.transformed.push(subject);
    const destination = this.resolveBecomeDestination?.(subject, axisValues);
    if (destination !== undefined) this.spawn(destination, 1);
  }

  /** 出来事を告げるだけで、世界の形は変わらない。 */
  signal(_name: string): void {}

  /**
   * 候補ごとに枝分かれさせ、重みを確率へ直す。**抽選の規約に合わせる**——負の重みは0として扱い、
   * 全候補の重みが0なら先頭の候補だけが起こる（PickEffect.selectWeighted）。
   *
   * 解けない重みは0として数える。そのぶん配分は歪むので、読み手が気付けるように、工程を組む側が
   * 「確定しない」印を立てる（craftingSteps、CraftingStep.hasUnresolvedReferences）。
   */
  pick(candidates: readonly PickCandidateReading[]): void {
    if (candidates.length === 0) return;

    const weights = candidates.map((candidate) =>
      Math.max(0, resolveDeclaredNumber(candidate.weight, this.resolve) ?? 0),
    );
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const readings = candidates.map((candidate) =>
      readEffect(candidate.effect, this.resolve, this.resolveBecomeDestination),
    );
    // 消える物・変わる物は分岐をまたいで集める——「どれか1つの分岐でそうなるか」を問うものなので。
    for (const reading of readings) {
      this.destroyed.push(...reading.destroyed);
      this.transformed.push(...reading.transformed);
    }

    if (total <= 0) {
      this.combine(readings[0].outcomes);
    } else {
      this.combine(
        readings.flatMap((reading, index) => scaleOutcomes(reading.outcomes, weights[index] / total)),
      );
    }
  }

  private combine(outcomes: readonly StepOutcome[]): void {
    this.outcomes = combineOutcomes(this.outcomes, outcomes);
  }
}
