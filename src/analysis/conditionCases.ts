import type {
  ConditionDeclaration,
  ConditionOp,
  ConditionReader,
  PropertyConditionReading,
} from '../domain/ConditionReader';
import type { ReferenceRoot } from '../domain/ReferenceRoot';

/**
 * 2つの条件（14節）が**同時には成立しない**と、宣言だけから言い切れるか。
 *
 * tick毎の増減をいくつ重ねられるかは、条件がどう組み合わさるかで決まる（rangeCycles.tickAmountsOf）。
 * 同じ気温を`lt`と`gte`で見ている寒さと暖かさのように、**書かれた条件そのものが重なりを禁じている**
 * ことは多く、そこを重なりうる1つの場合として数えると打ち消し合って周期が消える。
 *
 * **言い切れるときだけ真を返す。** 枠の中身・段・型の合致のように値の重なりで表せない葉は制約を
 * 生まないので、それらしか書かれていない条件どうしは常に「重なりうる」に倒れる。
 */
export function mutuallyExclusive(
  a: ConditionDeclaration | undefined,
  b: ConditionDeclaration | undefined,
): boolean {
  if (a === undefined || b === undefined) return false;

  const left = casesOf(a, false);
  const right = casesOf(b, false);
  return left.every((mine) => right.every((theirs) => contradict(mine, theirs)));
}

/**
 * 条件が成立する場合を、**論理和の下に論理積**（選言標準形）へ均したもの。1つの場合は、同時に
 * 成り立っていなければならない比較の並び。
 *
 * 均しておく理由は、`any`の下の比較も排他の根拠になるため——「屋根の下か、降っていない」と
 * 「屋根が無く、降っている」は、どちらの枝を採っても衝突する。論理積の枝だけを見ていると
 * この対が読めない。
 */
type ConditionCase = readonly Comparison[];

/** 比較1つを、**同時に成立しうるか**だけの目で見たもの。 */
interface Comparison {
  readonly root: ReferenceRoot;
  readonly propertyGlobalId: number;
  readonly op: ConditionOp;

  /** リテラルとの比較なら、その値の並び。参照との比較ではundefined。 */
  readonly values: readonly number[] | undefined;

  /** 参照との比較なら、その参照を表す鍵。同じ鍵どうしは同じ値を見ている。 */
  readonly refKey: string | undefined;
}

/** 否定の下で、比較がそのまま裏返る先（14.1節の演算子は対で揃っている）。 */
const NEGATED: Readonly<Record<ConditionOp, ConditionOp>> = {
  lt: 'gte',
  lte: 'gt',
  gt: 'lte',
  gte: 'lt',
  eq: 'neq',
  neq: 'eq',
  in: 'not_in',
  not_in: 'in',
};

function casesOf(declaration: ConditionDeclaration, negated: boolean): readonly ConditionCase[] {
  const collector = new ConditionCaseCollector(negated);
  declaration.read(collector);
  return collector.cases;
}

/**
 * 条件の木を選言標準形（{@link ConditionCase}）へ読み下す読み手。**否定は葉まで押し下げる**
 * ——比較は演算子を裏返せばよく、論理積と論理和は互いへ入れ替わる。
 */
class ConditionCaseCollector implements ConditionReader {
  /** 読み終えた時点の場合分け。既定の「制約が1つも無い1通り」は、何も読み取れない葉の答えでもある。 */
  cases: readonly ConditionCase[] = [[]];

  private readonly negated: boolean;

  constructor(negated: boolean) {
    this.negated = negated;
  }

  property(reading: PropertyConditionReading): void {
    this.cases = [
      [
        {
          root: reading.root,
          propertyGlobalId: reading.propertyGlobalId,
          op: this.negated ? NEGATED[reading.op] : reading.op,
          values: reading.values,
          refKey:
            reading.valueRef === undefined
              ? undefined
              : `${reading.valueRef.root}:${reading.valueRef.propertyGlobalId}`,
        },
      ],
    ];
  }

  /**
   * ここから下の葉は制約を生まない——段の刻み・枠の中の位置・枠の中身・型の合致は、いずれも
   * 「どの値なら成り立つか」では表せないので、重ならないことの根拠にできない。
   */
  propertyStage(): void {}

  slotPosition(): void {}

  slotContent(): void {}

  objectMatches(): void {}

  all(children: readonly ConditionDeclaration[]): void {
    this.cases = this.negated ? this.eitherOf(children) : this.bothOf(children);
  }

  any(children: readonly ConditionDeclaration[]): void {
    this.cases = this.negated ? this.bothOf(children) : this.eitherOf(children);
  }

  not(child: ConditionDeclaration): void {
    this.cases = casesOf(child, !this.negated);
  }

  /** 論理積は、子の場合分けの直積——どの子からも1通りずつ選んで並べたものが1つの場合になる。 */
  private bothOf(children: readonly ConditionDeclaration[]): readonly ConditionCase[] {
    let cases: readonly ConditionCase[] = [[]];
    for (const child of children) {
      const theirs = casesOf(child, this.negated);
      cases = cases.flatMap((mine) => theirs.map((added) => [...mine, ...added]));
    }
    return cases;
  }

  /** 論理和は、子の場合分けをそのまま並べたもの。 */
  private eitherOf(children: readonly ConditionDeclaration[]): readonly ConditionCase[] {
    return children.flatMap((child) => casesOf(child, this.negated));
  }
}

/** 2つの場合が同時には成り立たないか。**衝突する比較が1対でもあれば成り立たない。** */
function contradict(a: ConditionCase, b: ConditionCase): boolean {
  return a.some((mine) => b.some((theirs) => conflicts(mine, theirs)));
}

/** 同じ物の同じプロパティを見ている2つの比較が、どの値でも同時には成り立たないか。 */
function conflicts(a: Comparison, b: Comparison): boolean {
  if (a.root !== b.root || a.propertyGlobalId !== b.propertyGlobalId) return false;

  // 参照との比較は、**同じ参照を見ているときだけ**比べられる。同じ値なので、代表の1つを両方へ
  // 置けばリテラルとの比較と同じ計算になる。
  const values =
    a.values !== undefined && b.values !== undefined
      ? ([a.values, b.values] as const)
      : a.refKey !== undefined && a.refKey === b.refKey
        ? ([[0], [0]] as const)
        : undefined;
  if (values === undefined) return false;

  return !satisfiableTogether(a.op, values[0], b.op, values[1]);
}

/** 2つの比較を同時に満たす値があるか。 */
function satisfiableTogether(
  opA: ConditionOp,
  valuesA: readonly number[],
  opB: ConditionOp,
  valuesB: readonly number[],
): boolean {
  // 挙げられた値しか満たせない比較（eq・in）が絡むなら、その値を当たれば尽きる。
  const listed = [...(listedValues(opA, valuesA) ?? []), ...(listedValues(opB, valuesB) ?? [])];
  if (listed.length > 0)
    return listed.some((value) => holds(opA, valuesA, value) && holds(opB, valuesB, value));

  // 残りは半直線（lt・lte・gt・gte）か補集合（neq・not_in）。補集合は無限に値を残すので、
  // 相手が何であれ必ず重なる。
  const spanA = spanOf(opA, valuesA);
  const spanB = spanOf(opB, valuesB);
  return spanA === undefined || spanB === undefined ? true : overlap(spanA, spanB);
}

/** その比較を満たしうる値が有限個なら、その並び。 */
function listedValues(op: ConditionOp, values: readonly number[]): readonly number[] | undefined {
  return op === 'eq' || op === 'in' ? values : undefined;
}

/** 比較1つが、その値で成り立つか。 */
function holds(op: ConditionOp, values: readonly number[], value: number): boolean {
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

/** 順序の比較が残す区間。順序の比較でなければundefined。 */
interface Span {
  readonly min: number;
  readonly max: number;
  readonly minOpen: boolean;
  readonly maxOpen: boolean;
}

function spanOf(op: ConditionOp, values: readonly number[]): Span | undefined {
  switch (op) {
    case 'lt':
      return { min: -Infinity, max: values[0], minOpen: false, maxOpen: true };
    case 'lte':
      return { min: -Infinity, max: values[0], minOpen: false, maxOpen: false };
    case 'gt':
      return { min: values[0], max: Infinity, minOpen: true, maxOpen: false };
    case 'gte':
      return { min: values[0], max: Infinity, minOpen: false, maxOpen: false };
    default:
      return undefined;
  }
}

function overlap(a: Span, b: Span): boolean {
  const min = Math.max(a.min, b.min);
  const max = Math.min(a.max, b.max);
  if (min < max) return true;
  if (min > max) return false;

  const minOpen = (a.min === min && a.minOpen) || (b.min === min && b.minOpen);
  const maxOpen = (a.max === max && a.maxOpen) || (b.max === max && b.maxOpen);
  return !minOpen && !maxOpen;
}
