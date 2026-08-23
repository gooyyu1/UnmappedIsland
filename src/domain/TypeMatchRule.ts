import type { ObjectDef } from './ObjectDef';

/** マッチングの基準（TypeMatchRule参照）。 */
type TypeMatchTargetKind =
  /** targetはタグのグローバルID（4.1節）。候補がそのタグを持っていれば真。 */
  | 'tag'
  /** targetはobject_defのグローバルID。候補がまさにその型そのものであれば真。 */
  | 'object'
  /** innerが当てはまらない型（4.1節）。targetは使わない。 */
  | 'not';

/** 「どの型を指しているか」の読み上げ（TypeMatchRule.reading参照）。 */
export type TypeMatchReading =
  | { readonly kind: 'tag'; readonly tagGlobalId: number }
  | { readonly kind: 'object'; readonly objectGlobalId: number }
  | { readonly kind: 'not'; readonly inner: TypeMatchReading };

/** 枠の`accept`（7.2節）として書き出した形（TypeMatchRule.toAcceptSpec参照）。 */
export type AcceptSpec =
  { readonly tag: string } | { readonly object: string } | { readonly not: AcceptSpec };

/**
 * 「どの型が当てはまるか」の指定（GameElementDefinition.md 4.1節）。枠のaccept（7.2節）と
 * 重ねる操作の相手（12.1節）が共通で使う。
 *
 * タグで指せば、そのタグを持つあらゆる型（MOD追加分も含む）が当てはまる。object_defのidで指せば
 * まさにその型だけが当てはまり、そのためだけの単発タグを新設せずに済む。trait名では直接
 * マッチングしない（traitはmixin合成後に消えるため、外部から参照すべきではない）。
 *
 * **否定（`not`）は、この指定そのものを裏返す。** 条件（conditions、14節）の`not`が真偽を裏返すのとは
 * 掛かる先が違い、`{slot: items, matches: {not: {tag: quarry}}}`は「quarryでない物が1つはある」、
 * `not: {slot: items, matches: {tag: quarry}}`は「quarryが1つも無い」になる。
 */
export class TypeMatchRule {
  private readonly kind: TypeMatchTargetKind;

  private readonly target: number;

  /** 否定のみ有効。 */
  private readonly inner: TypeMatchRule | undefined;

  private constructor(kind: TypeMatchTargetKind, target: number, inner?: TypeMatchRule) {
    this.kind = kind;
    this.target = target;
    this.inner = inner;
  }

  static ofTag(tagGlobalId: number): TypeMatchRule {
    return new TypeMatchRule('tag', tagGlobalId);
  }

  static ofObjectDef(objectGlobalId: number): TypeMatchRule {
    return new TypeMatchRule('object', objectGlobalId);
  }

  static not(inner: TypeMatchRule): TypeMatchRule {
    return new TypeMatchRule('not', 0, inner);
  }

  /** タグならcandidateがそのタグを持てば真、object_defならまさにその型であれば真。 */
  matches(candidateDef: ObjectDef): boolean {
    if (this.kind === 'not') return !this.inner!.matches(candidateDef);
    return this.kind === 'tag' ? candidateDef.hasTag(this.target) : candidateDef.globalId === this.target;
  }

  /**
   * 同じ指定どうしをまとめるための鍵。タグとobject_defはIDの空間が別なので、種類を混ぜて比べない
   * ようにここで前置きを付ける（レシピの要求を型ごとに畳むのに使う、crafting.remainingRequirements）。
   */
  get key(): string {
    return this.kind === 'not' ? `not:${this.inner!.key}` : `${this.kind}:${this.target}`;
  }

  /**
   * この指定に当てはまる型を全部挙げる。1つに定まらない指定（タグ）を絵で見せるのに使う。
   *
   * **否定形では絵にならない**（「そのタグを持たない型すべて」になる）。呼んでいるのはレシピの要求と
   * 変種の軸で、どちらも否定を書ける場所ではない。
   */
  candidates(defs: Iterable<ObjectDef>): readonly ObjectDef[] {
    return [...defs].filter((def) => this.matches(def));
  }

  /**
   * 枠の`accept`（7.2節）として書き出した形。レシピの要求から製作中オブジェクトの枠を組み立てる
   * （inProgressObjects）ときに、宣言をYAMLへ戻すために使う。
   */
  toAcceptSpec(names: {
    objectName(globalId: number): string;
    tagName(globalId: number): string;
  }): AcceptSpec {
    if (this.kind === 'not') return { not: this.inner!.toAcceptSpec(names) };
    return this.kind === 'tag'
      ? { tag: names.tagName(this.target) }
      : { object: names.objectName(this.target) };
  }

  /** この指定の宣言そのもの（TypeMatchReading参照）。 */
  get reading(): TypeMatchReading {
    if (this.kind === 'not') return { kind: 'not', inner: this.inner!.reading };
    return this.kind === 'tag'
      ? { kind: 'tag', tagGlobalId: this.target }
      : { kind: 'object', objectGlobalId: this.target };
  }
}
