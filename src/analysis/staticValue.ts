import type {
  ConditionDeclaration,
  ConditionOp,
  ConditionReader,
  PropertyConditionReading,
} from '../domain/ConditionReader';
import type { DeclaredNumberReading } from '../domain/EffectReader';
import type { ObjectDef } from '../domain/ObjectDef';
import type { ReferenceRoot } from '../domain/ReferenceRoot';

/**
 * 定義だけから値を解く手立てと、その周りの近似。
 *
 * 実行時のオブジェクトが1つも無い文脈で「この宣言はいくつになるか」を答えるには、**居ない相手の
 * ぶんを何かで埋める**しかない——祖先（置かれている土地）も、重ねる相手（武器）も、生成時の抽選も、
 * 定義の側は答えを持っていない。その埋め方はレポートの都合なので、ここから先はドメインには置かない。
 *
 * 同じ理由で、条件（14節）の真偽も**言い切れるものだけ**を返す（staticConditionTruth）。
 */

/**
 * ReferenceRootが指すプロパティの値を、**定義だけから**解く手立て。
 *
 * 解けないものはundefinedを返す——祖先が入れる値（inherit）も、重ねる相手の値も、「どの文脈に
 * 置いた場合の数字か」を決めた側にしか答えられない。0を返すと「そう宣言されている」と区別が付かない。
 */
export type StaticValueResolver = (root: ReferenceRoot, propertyGlobalId: number) => number | undefined;

/**
 * defを起点として、定義だけから値を解く手立て。selfは自分のプロパティ宣言が答え、それ以外の起点は
 * outerへ委ねる。
 */
export function staticResolverOf(
  def: ObjectDef,
  outer: StaticValueResolver | undefined,
): StaticValueResolver {
  return (root, propertyGlobalId) => {
    return root === 'self' ? staticValueOf(def, propertyGlobalId, outer) : outer?.(root, propertyGlobalId);
  };
}

/**
 * defが宣言しているプロパティの、定義だけから読める値。宣言していなければundefined。
 *
 * **抽選つきの初期値（`value: {min, max}`）はRNGを使わない生成と同じ扱い**で、下限がそのまま
 * 答えになる（PropertyDef.initialValueWithoutRoll）。inheritなら祖先の値も足す（6.5節）。祖先を辿れない
 * 文脈ではundefined。
 */
export function staticValueOf(
  def: ObjectDef,
  propertyGlobalId: number,
  outer?: StaticValueResolver,
): number | undefined {
  const propertyDef = def.tryGetPropertyDef(propertyGlobalId);
  if (propertyDef === undefined) return undefined;
  if (!propertyDef.inherit) return propertyDef.initialValueWithoutRoll;

  const inherited = outer?.('ancestor', propertyGlobalId);
  return inherited === undefined ? undefined : propertyDef.initialValueWithoutRoll + inherited;
}

/**
 * 解けなかったことを覚える解決器。**印の有効範囲は呼ぶ側が決める**——1つの工程・1つの周期ごとに
 * 作り直さないと、先に読んだものには付かず後に読んだものだけに付く印になる。
 *
 * 印が意味するのは「その工程の所要時間・確率は、定義だけからは確定しない参照を含む」
 * （CraftingStep.hasUnresolvedReferences）。
 */
export function trackingResolverOf(def: ObjectDef, outer: StaticValueResolver | undefined): TrackingResolver {
  const inner = staticResolverOf(def, outer);
  let hit = false;
  return {
    resolve: (root, propertyGlobalId) => {
      const value = inner(root, propertyGlobalId);
      if (value === undefined) hit = true;
      return value;
    },
    get hitUnresolvedReference() {
      return hit;
    },
  };
}

/** 解決器と、そこまでに解けない参照へ当たったかどうか（trackingResolverOf）。 */
export interface TrackingResolver {
  readonly resolve: StaticValueResolver;
  readonly hitUnresolvedReference: boolean;
}

/** 宣言に書かれた1つの数値（重み・所要時間）を数値へ解く。参照が解けなければundefined。 */
export function resolveDeclaredNumber(
  reading: DeclaredNumberReading,
  resolve: StaticValueResolver,
): number | undefined {
  return reading.kind === 'literal' ? reading.value : resolve(reading.subject, reading.propertyGlobalId);
}

/**
 * ある型がそのプロパティに取りうる値の範囲。両端は宣言されたrange（6.3節）そのもの。
 *
 * ただし**端に達した瞬間にその型でなくなる**なら、その端の値はその型のままでは観測されない
 * ——中身入りの容器の`fill`は0にならない（0でその瞬間に空の容器へ戻る）。
 */
export interface StaticValueRange {
  readonly min: number;
  readonly max: number;

  /** その値になった瞬間に別の型へ変わる・消えるため、この型のままでは取れない端。 */
  readonly endsLeavingThisType: readonly number[];
}

/**
 * 条件（14節）が、定義だけから真と分かるか・偽と分かるか。**どちらとも言えなければundefined。**
 *
 * 読めるのは`subject: self`のプロパティ比較だけで、他の葉——祖先の天候・相手の持ち物・スロットの
 * 中身・段の刻み——は判定せずに素通しにする。解析の側にゲームの実行を作り込むと、同じ規則の実装が
 * 2つになって食い違い始めるため。
 */
export function staticConditionTruth(
  condition: ConditionDeclaration,
  rangeOfSelfProperty: (propertyGlobalId: number) => StaticValueRange | undefined,
): boolean | undefined {
  const reader = new ConditionTruthReader(rangeOfSelfProperty);
  condition.read(reader);
  return reader.truth;
}

/** 条件の木を読み下しながら、定義だけから決まる真偽を組み立てる読み手。 */
class ConditionTruthReader implements ConditionReader {
  /** 定義だけから決まった真偽。決まらなければundefined。 */
  truth: boolean | undefined;

  private readonly rangeOfSelfProperty: (propertyGlobalId: number) => StaticValueRange | undefined;

  constructor(rangeOfSelfProperty: (propertyGlobalId: number) => StaticValueRange | undefined) {
    this.rangeOfSelfProperty = rangeOfSelfProperty;
  }

  property(reading: PropertyConditionReading): void {
    if (reading.root !== 'self' || reading.values === undefined || reading.valueRef !== undefined) return;
    const range = this.rangeOfSelfProperty(reading.propertyGlobalId);
    if (range !== undefined) this.truth = comparisonTruth(range, reading.op, reading.values);
  }

  /**
   * ここから下の葉は判定しない——段の刻み・木の中の位置・スロットの中身・型の合致は、いずれも
   * 「どの値を取りうるか」では表せない。判定しない葉は決まらないまま（undefined）残る。
   */
  propertyStage(): void {}

  slotPosition(): void {}

  slotContent(): void {}

  objectMatches(): void {}

  all(children: readonly ConditionDeclaration[]): void {
    this.truth = combinedTruth(this.truthsOf(children), false);
  }

  any(children: readonly ConditionDeclaration[]): void {
    this.truth = combinedTruth(this.truthsOf(children), true);
  }

  not(child: ConditionDeclaration): void {
    const inner = staticConditionTruth(child, this.rangeOfSelfProperty);
    this.truth = inner === undefined ? undefined : !inner;
  }

  private truthsOf(children: readonly ConditionDeclaration[]): readonly (boolean | undefined)[] {
    return children.map((child) => staticConditionTruth(child, this.rangeOfSelfProperty));
  }
}

/**
 * all（decisiveが偽）とany（decisiveが真）の畳み方。**決め手が1つでもあればそこで決まり**、
 * 残り全部が逆なら逆に決まる。どちらでもなければ決まらない。
 */
function combinedTruth(truths: readonly (boolean | undefined)[], decisive: boolean): boolean | undefined {
  if (truths.includes(decisive)) return decisive;
  return truths.every((truth) => truth === !decisive) ? !decisive : undefined;
}

/** 比較1つが、取りうる値の範囲だけから真と言えるか・偽と言えるか。 */
function comparisonTruth(
  range: StaticValueRange,
  op: ConditionOp,
  values: readonly number[],
): boolean | undefined {
  switch (op) {
    // 一致は範囲との交わりだけで決まる。挙げた値をどれも取れないなら、成立しようがない。
    case 'eq':
    case 'in':
      return values.some((value) => canHold(range, value)) ? undefined : false;
    case 'neq':
    case 'not_in':
      return values.some((value) => canHold(range, value)) ? undefined : true;
    // 順序の比較は値について単調なので、両端が同じ答えなら間のどの値でも同じ答えになる。
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte':
      return endsAgreeOn(range, op, values[0]);
    default:
      return undefined;
  }
}

/** その型がその値を取りうるか（StaticValueRange参照）。 */
function canHold(range: StaticValueRange, value: number): boolean {
  return value >= range.min && value <= range.max && !range.endsLeavingThisType.includes(value);
}

/** 順序の比較が範囲の両端で同じ答えになるなら、その答え。分かれるならundefined。 */
function endsAgreeOn(
  range: StaticValueRange,
  op: 'lt' | 'lte' | 'gt' | 'gte',
  value: number,
): boolean | undefined {
  const atMin = satisfiesOrdering(op, range.min, value);
  return atMin === satisfiesOrdering(op, range.max, value) ? atMin : undefined;
}

function satisfiesOrdering(op: 'lt' | 'lte' | 'gt' | 'gte', current: number, value: number): boolean {
  if (op === 'lt') return current < value;
  if (op === 'lte') return current <= value;
  if (op === 'gt') return current > value;
  return current >= value;
}
