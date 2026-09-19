import type {
  AddReading,
  ConditionalReading,
  EffectDeclaration,
  EffectReader,
  PickReading,
  SetValueReading,
  TransferReading,
} from '../domain/EffectReader';
import type { ObjectRefReading } from '../domain/ObjectRef';
import type { ReferenceRoot } from '../domain/ReferenceRoot';
import type { PropertyDelta, StepOutcome } from './CraftingStep';
import { UNCHANGED_OUTCOMES, combineOutcomes, scaleOutcomes } from './CraftingStep';
import type { ReferenceValueResolver } from '../domain/ReferenceRoot';
import { resolveDeclaredNumber } from '../domain/DeclaredNumber';
import type { ObjectGlobalId, PropertyGlobalId } from '../domain/GlobalId';

/**
 * `become`（9.9節）の行き先の型を、定義だけから解く手立て。行き先を解けない——対象の型が定義から
 * 決まらない、あるいはその座標に型が居ない——ときはundefined。
 */
export type BecomeDestinationResolver = (
  subject: ObjectRefReading,
  axisValues: ReadonlyMap<string, string>,
) => ObjectGlobalId | undefined;

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
 * ここが置いている近似は次のもの。**重みを確率に読み替えること**——実際の抽選は実行時の実効値で
 * 行われるので、宣言値から出す確率はその代用でしかない。**分岐を直積で畳むこと**——
 * 宣言順に並んだ効果は順に起こるので、pickが2つ並べば枝は掛け算になる。そして**条件つきの効果を、
 * 著者が書いた枝で代表すること**——どちらが著者の枝かはドメインが名乗る（ConditionalBranch.authored）が、
 * それを全体の答えとして採るのはここの近似。
 *
 * resolveBecomeDestinationを省くと、`become`の行き先は産出として数えられない。変わる前の型として
 * 残らないことは、行き先を解けなくても言えるので、省いても控える。
 */
export function readEffect(
  declaration: EffectDeclaration,
  resolve: ReferenceValueResolver,
  resolveBecomeDestination?: BecomeDestinationResolver,
): EffectReading {
  const reader = new OutcomeReader(resolve, resolveBecomeDestination);
  declaration.readBy(reader);
  return reader;
}

/**
 * その候補が**自分の重みに使っている値を、自分で減らしている**なら、その値は設備のつまみではなく
 * **プレイヤーが仕込む在庫**（塩田の張った海水、畑の撒いた株）。在庫の宣言値は「まだ何も仕込んで
 * いない状態」なので、そのまま重みにすると、設備が何を返すかを一度も数えないことになる
 * ——**1回ぶん仕込んである**として読む。
 *
 * 減らさない重み（罠の掛かりやすさ、器に残った水、食べ物の傷み）は宣言値のまま。それらは仕込む物
 * ではなく、宣言された値そのものが答えになるつまみで、初期値の外に読むべき状態を持たない。
 */
function stockedResolverOf(resolve: ReferenceValueResolver, reading: EffectReading): ReferenceValueResolver {
  const stocks = spentAmountsOf(reading.outcomes);
  if (stocks.size === 0) return resolve;

  return (root, propertyGlobalId) => {
    const value = resolve(root, propertyGlobalId);
    const spent = stocks.get(root)?.get(propertyGlobalId);
    return value === undefined || spent === undefined ? value : Math.max(value, spent);
  };
}

/**
 * 分岐が減らす量を、対象のプロパティごとに1回の実行ぶんで集めたもの（増える側は持たない）。
 * 分岐が複数あるときは最も多く減らす分岐の量——どの分岐が来ても足りる在庫が、1回ぶんの在庫。
 */
function spentAmountsOf(
  outcomes: readonly StepOutcome[],
): ReadonlyMap<ReferenceRoot, ReadonlyMap<PropertyGlobalId, number>> {
  const spent = new Map<ReferenceRoot, Map<PropertyGlobalId, number>>();
  for (const outcome of outcomes)
    for (const [root, inOutcome] of spentInOutcome(outcome, () => true)) {
      const known = spent.get(root) ?? new Map<PropertyGlobalId, number>();
      for (const [propertyGlobalId, amount] of inOutcome)
        known.set(propertyGlobalId, Math.max(known.get(propertyGlobalId) ?? 0, amount));
      spent.set(root, known);
    }
  return spent;
}

/**
 * 1つの分岐が、どの起点の値からいくつ減らしたか（減った側だけを、正の量で持つ）。`counts`が選んだ
 * 減りだけを数える。同じ値への減りは足し合わせる——1つの分岐の中で2度引かれたなら、減るのはその和。
 */
function spentInOutcome(
  outcome: StepOutcome,
  counts: (delta: PropertyDelta) => boolean,
): ReadonlyMap<ReferenceRoot, ReadonlyMap<PropertyGlobalId, number>> {
  const spent = new Map<ReferenceRoot, Map<PropertyGlobalId, number>>();
  for (const delta of outcome.deltas) {
    if (delta.amount >= 0 || !counts(delta)) continue;
    const inRoot = spent.get(delta.target) ?? new Map<PropertyGlobalId, number>();
    inRoot.set(delta.propertyGlobalId, (inRoot.get(delta.propertyGlobalId) ?? 0) - delta.amount);
    spent.set(delta.target, inRoot);
  }
  return spent;
}

/**
 * rootが指すオブジェクトから、この工程が1回で**外へ移す**量が、1つぶんの何割か（0〜1）。
 * **その型が残っても、抱えていた量を持ち出せばその分だけ使い切っている**——水入りの甕は
 * `transfer`で中身が減るだけで`destroy`も`become`もしないので、型が残るかだけを問うと、
 * 1杯ごとに減る中身が値段を一度も払わないことになる（`consumesRoot`と対で読む）。
 *
 * **数えるのは外へ出た分だけ**（PropertyDelta.movedOut）。使って傷むだけの値（道具の刃こぼれ）は
 * 物が出たわけではないので、ここでは数えない——それを1回あたりの個数へ直すかは別の決めごとで、
 * 今は「何回使えるか」として別に出している（durations、DurabilitySystem.md）。
 *
 * `stockOf`は「その入力1つがそのプロパティに抱えている量」で、答えられなければundefined——量が
 * 分からなければ何杯ぶんかも言えないので、その値は持ち出しに数えない。
 *
 * 1つの分岐が複数の値を持ち出すなら、**最も深く食う1つ**が1回ぶんを決める（先に尽きる値が
 * 繰り返しを止める）。分岐をまたぐぶんは確率で重み付けする——消える確率と同じ数え方
 * （CraftingInput.count）。
 */
export function movedOutStockOf(
  reading: EffectReading,
  root: ReferenceRoot,
  stockOf: (propertyGlobalId: PropertyGlobalId) => number | undefined,
): MovedOutStock {
  let share = 0;
  let emptied: PropertyGlobalId | undefined;
  for (const outcome of reading.outcomes) {
    let deepest = 0;
    for (const [propertyGlobalId, amount] of spentInOutcome(outcome, (delta) => delta.movedOut === true).get(
      root,
    ) ?? []) {
      const stock = stockOf(propertyGlobalId);
      if (stock === undefined || stock <= 0) continue;
      const eaten = Math.min(1, amount / stock);
      if (eaten <= deepest) continue;
      deepest = eaten;
      emptied = propertyGlobalId;
    }
    share += outcome.probability * deepest;
  }
  return { share, emptiedPropertyGlobalId: emptied };
}

/** 1回の実行で、その入力から外へ出ていく在庫（movedOutStockOf）。 */
export interface MovedOutStock {
  /** 入力1つぶんの何割が出ていくか（0〜1）。 */
  readonly share: number;

  /**
   * その割合を決めた値——**最も深く食われ、先に尽きる1つ**。何も出ていかないならundefined。
   * 尽きた先で入力が何になるか（空の器）を問えるのはこの値の端だけ（craftingSteps.emptiedIntoOf）。
   */
  readonly emptiedPropertyGlobalId: PropertyGlobalId | undefined;
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

  private readonly resolve: ReferenceValueResolver;

  private readonly resolveBecomeDestination: BecomeDestinationResolver | undefined;

  constructor(resolve: ReferenceValueResolver, resolveBecomeDestination?: BecomeDestinationResolver) {
    this.resolve = resolve;
    this.resolveBecomeDestination = resolveBecomeDestination;
  }

  /**
   * 個体を指す代入（9.2節）は書き込む値が実行時にしか決まらないので、値を持たない代入として載せる
   * ——静的に言えるのは「そのプロパティが書き換わる」までで、いくつになるかは言えない。
   * **書き換わること自体は載せる**ので、それより前の増減が残らないことは数え方に効く。
   */
  set(target: ReferenceRoot, propertyGlobalId: PropertyGlobalId, value: SetValueReading): void {
    const assignment = { target, propertyGlobalId, value: typeof value === 'number' ? value : undefined };
    this.combine([{ probability: 1, spawns: [], deltas: [], assignments: [assignment] }]);
  }

  add(reading: AddReading): void {
    this.combine([{ probability: 1, spawns: [], deltas: [reading], assignments: [] }]);
  }

  spawn(objectGlobalId: ObjectGlobalId, count: number): void {
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
          {
            target: reading.from,
            propertyGlobalId: reading.fromPropertyGlobalId,
            amount: -reading.amount,
            // 出ていく分だとその場で名乗る（PropertyDelta.movedOut）。
            movedOut: true,
          },
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
  pick(reading: PickReading): void {
    const weighted: { readonly nested: EffectReading; readonly weight: number }[] = [];
    reading.forEachCandidate((candidate) => {
      const nested = this.readNested(candidate.effect);
      weighted.push({
        nested,
        weight: Math.max(
          0,
          resolveDeclaredNumber(candidate.weight, stockedResolverOf(this.resolve, nested)) ?? 0,
        ),
      });
    });
    if (weighted.length === 0) return;

    // 消える物・変わる物は分岐をまたいで集める——「どれか1つの分岐でそうなるか」を問うものなので。
    for (const { nested } of weighted) {
      this.destroyed.push(...nested.destroyed);
      this.transformed.push(...nested.transformed);
    }

    const total = weighted.reduce((sum, candidate) => sum + candidate.weight, 0);
    if (total <= 0) {
      this.combine(weighted[0].nested.outcomes);
    } else {
      this.combine(
        weighted.flatMap((candidate) => scaleOutcomes(candidate.nested.outcomes, candidate.weight / total)),
      );
    }
  }

  /**
   * 条件つきの効果（6.3節）は、量と、消える物・変わる物とで**問いが違う**ので、枝ごとに扱いを分ける。
   *
   * 量は「何がどれだけ起こるか」なので著者が書いた枝で代表し（ConditionalBranch.authored）、消える物・
   * 変わる物は`pick`と同じく「どれか1つの分岐でそうなるか」を問うものなので両方の枝から集める。
   */
  conditional(reading: ConditionalReading): void {
    reading.forEachBranch((branch) => {
      const nested = this.readNested(branch.effect);
      this.destroyed.push(...nested.destroyed);
      this.transformed.push(...nested.transformed);
      if (branch.authored) this.combine(nested.outcomes);
    });
  }

  private readNested(declaration: EffectDeclaration): EffectReading {
    return readEffect(declaration, this.resolve, this.resolveBecomeDestination);
  }

  private combine(outcomes: readonly StepOutcome[]): void {
    this.outcomes = combineOutcomes(this.outcomes, outcomes, 'declared');
  }
}
