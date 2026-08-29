import type {
  ConditionDeclaration,
  ConditionOp,
  ConditionReader,
  PropertyConditionReading,
} from '../domain/ConditionReader';
import type { DeclaredNumberReading } from '../domain/EffectReader';
import { multipliedRefs } from '../domain/EffectReader';
import type { ObjectDef } from '../domain/ObjectDef';
import type { RollEnd } from '../domain/PropertyDef';
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
 * 解けないものはundefinedを返す——祖先が土台に入れる値（base）も、重ねる相手の値も、「どの文脈に
 * 置いた場合の数字か」を決めた側にしか答えられない。0を返すと「そう宣言されている」と区別が付かない。
 *
 * **生成時のロール（6.2節）のどちらの端かは、問いのほうが持つ**（endを受け取る）。ここで端を
 * 固定すると、上端の問い合わせへ下端の答えが混ざったまま返る——PropertyDef.initialValueAtが
 * 両端を答えるようになっても、この境界で片方へ畳めば同じことになる。
 */
export type StaticValueResolver = (
  root: ReferenceRoot,
  propertyGlobalId: number,
  end: RollEnd,
) => number | undefined;

/**
 * 端を1つに決めたStaticValueResolver（staticResolverOf）。効果や条件の宣言を読む側は、自分が
 * どちらの端の話をしているかを知らないまま値を引ける。**端を選べるのは、問いを立てた側だけ。**
 */
export type EndBoundValueResolver = (root: ReferenceRoot, propertyGlobalId: number) => number | undefined;

/**
 * defを起点として、定義だけから値を解く手立て。selfは自分のプロパティ宣言が答え、それ以外の起点は
 * outerへ委ねる。生成時のロール（6.2節）はendの端に出たものとして読む——**委ねる先にも同じ端を
 * 渡す**ので、どの起点を辿っても答えは1つの端で揃う。
 */
export function staticResolverOf(
  def: ObjectDef,
  end: RollEnd,
  outer: StaticValueResolver | undefined,
): EndBoundValueResolver {
  return (root, propertyGlobalId) => {
    return root === 'self'
      ? staticValueOf(def, propertyGlobalId, end, outer)
      : outer?.(root, propertyGlobalId, end);
  };
}

/**
 * defが宣言しているプロパティの、定義だけから読める値。宣言していなければundefined。
 *
 * **生成時のロール（`value: {min, max}`、6.2節）はendの端に出たものとして読む**
 * （PropertyDef.initialValueAt）。どちらの端の話かは問いによって変わる——端へ届くまでの長さは
 * 遠い側が要り、尽きるまでの総量は多い側が要る——ので、**片方へ畳んで返さない。**
 * `base`（6.5節）があれば土台の値も足す。土台を辿れない文脈ではundefined。
 */
export function staticValueOf(
  def: ObjectDef,
  propertyGlobalId: number,
  end: RollEnd,
  outer?: StaticValueResolver,
): number | undefined {
  const propertyDef = def.tryGetPropertyDef(propertyGlobalId);
  if (propertyDef === undefined) return undefined;

  const initialValue = propertyDef.initialValueAt(end);
  const base = propertyDef.base;
  if (base === undefined) return initialValue;

  const baseValue = staticResolverOf(def, end, outer)(base.root, base.propertyGlobalId);
  return baseValue === undefined ? undefined : initialValue + baseValue;
}

/**
 * 解けなかったことを覚える解決器。**印の有効範囲は呼ぶ側が決める**——1つの工程・1つの周期ごとに
 * 作り直さないと、先に読んだものには付かず後に読んだものだけに付く印になる。
 *
 * 印が意味するのは「その工程の所要時間・確率は、定義だけからは確定しない参照を含む」
 * （CraftingStep.hasUnresolvedReferences）。
 */
export function trackingResolverOf(
  def: ObjectDef,
  end: RollEnd,
  outer: StaticValueResolver | undefined,
): TrackingResolver {
  const inner = staticResolverOf(def, end, outer);
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
  readonly resolve: EndBoundValueResolver;
  readonly hitUnresolvedReference: boolean;
}

/** 宣言に書かれた1つの数値（重み・所要時間）を数値へ解く。参照が1つでも解けなければundefined。 */
export function resolveDeclaredNumber(
  reading: DeclaredNumberReading,
  resolve: EndBoundValueResolver,
): number | undefined {
  if (reading.kind === 'literal') return reading.value;

  let product = 1;
  for (const ref of multipliedRefs(reading)) {
    const value = resolve(ref.subject, ref.propertyGlobalId);
    if (value === undefined) return undefined;
    product *= value;
  }
  return product;
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
 * ReferenceRootが指すプロパティの、取りうる値の範囲（StaticValueRange）。**型が定まらない起点では
 * undefined**——祖先も、実行時にしか決まらない相手も、どの型が来るかを定義の側は知らない。
 */
export type StaticValueRangeResolver = (
  root: ReferenceRoot,
  propertyGlobalId: number,
) => StaticValueRange | undefined;

/**
 * 条件（14節）が、定義だけから真と分かるか・偽と分かるか。**どちらとも言えなければundefined。**
 *
 * 読めるのは**型が定まっている起点**のプロパティ比較だけで、他の葉——祖先の天候・相手の持ち物・
 * スロットの中身・段の刻み——は判定せずに素通しにする。解析の側にゲームの実行を作り込むと、同じ
 * 規則の実装が2つになって食い違い始めるため。どの起点の型が定まるかはrangeOfが答える。
 */
export function staticConditionTruth(
  condition: ConditionDeclaration,
  rangeOf: StaticValueRangeResolver,
): boolean | undefined {
  const reader = new ConditionTruthReader(rangeOf);
  condition.read(reader);
  return reader.truth;
}

/** 条件の木を読み下しながら、定義だけから決まる真偽を組み立てる読み手。 */
class ConditionTruthReader implements ConditionReader {
  /** 定義だけから決まった真偽。決まらなければundefined。 */
  truth: boolean | undefined;

  private readonly rangeOf: StaticValueRangeResolver;

  constructor(rangeOf: StaticValueRangeResolver) {
    this.rangeOf = rangeOf;
  }

  property(reading: PropertyConditionReading): void {
    if (reading.values === undefined || reading.valueRef !== undefined) return;
    const range = this.rangeOf(reading.root, reading.propertyGlobalId);
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
    const inner = staticConditionTruth(child, this.rangeOf);
    this.truth = inner === undefined ? undefined : !inner;
  }

  private truthsOf(children: readonly ConditionDeclaration[]): readonly (boolean | undefined)[] {
    return children.map((child) => staticConditionTruth(child, this.rangeOf));
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
