import type { ObjectDef } from './ObjectDef';

/** 「どの型を指しているか」の読み上げ（TypeMatchRule.reading参照）。 */
export type TypeMatchReading =
  /** 候補がそのタグ（4.1節）を持っていれば真。 */
  | { readonly kind: 'tag'; readonly tagGlobalId: number }
  /** 候補がまさにその型そのものであれば真。 */
  | { readonly kind: 'object'; readonly objectGlobalId: number }
  /** innerが当てはまらない型（4.1節）。 */
  | { readonly kind: 'not'; readonly inner: TypeMatchReading };

/** 枠の`accept`（7.2節）として書き出した形（TypeMatchRule.toAcceptSpec参照）。 */
export type AcceptSpec =
  { readonly tag: string } | { readonly object: string } | { readonly not: AcceptSpec };

/**
 * 「どの型が当てはまるか」の指定（GameElementDefinition.md 4.1節）。
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
  /** この指定の宣言そのもの（TypeMatchReading参照）。**この規則が持つのはこれだけ。** */
  readonly reading: TypeMatchReading;

  private constructor(reading: TypeMatchReading) {
    this.reading = reading;
  }

  static ofTag(tagGlobalId: number): TypeMatchRule {
    return new TypeMatchRule({ kind: 'tag', tagGlobalId });
  }

  static ofObjectDef(objectGlobalId: number): TypeMatchRule {
    return new TypeMatchRule({ kind: 'object', objectGlobalId });
  }

  static not(inner: TypeMatchRule): TypeMatchRule {
    return new TypeMatchRule({ kind: 'not', inner: inner.reading });
  }

  /** タグならcandidateがそのタグを持てば真、object_defならまさにその型であれば真。 */
  matches(candidateDef: ObjectDef): boolean {
    return TypeMatchRule.readingMatches(this.reading, candidateDef);
  }

  /**
   * 読み上げた指定（TypeMatchReading）が、その型に当てはまるか。判定はmatchesそのもので、
   * **宣言を読み下す側**——条件の木（ConditionReader）のように、規則そのものではなく読み上げだけを
   * 受け取る読み手——から同じ問いを立てられるようにここへ置いてある。
   */
  static readingMatches(reading: TypeMatchReading, candidateDef: ObjectDef): boolean {
    switch (reading.kind) {
      case 'tag':
        return candidateDef.hasTag(reading.tagGlobalId);
      case 'object':
        return candidateDef.globalId === reading.objectGlobalId;
      case 'not':
        return !TypeMatchRule.readingMatches(reading.inner, candidateDef);
    }
  }

  /**
   * 同じ指定どうしをまとめるための鍵。タグとobject_defはIDの空間が別なので、種類を混ぜて比べない
   * ようにここで前置きを付ける（レシピの要求を型ごとに畳むのに使う、crafting.remainingRequirements）。
   */
  get key(): string {
    return keyOf(this.reading);
  }

  /**
   * この指定に当てはまる型を全部挙げる。1つに定まらない指定（タグ）を絵で見せるのに使う。
   *
   * **否定形では絵にならない**（「そのタグを持たない型すべて」になる）。呼んでいるのはレシピの要求と
   * 変種の軸で、どちらも否定を書ける場所ではない。
   */
  matchingDefs(defs: Iterable<ObjectDef>): readonly ObjectDef[] {
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
    return acceptSpecOf(this.reading, names);
  }
}

function keyOf(reading: TypeMatchReading): string {
  if (reading.kind === 'not') return `not:${keyOf(reading.inner)}`;
  return reading.kind === 'tag' ? `tag:${reading.tagGlobalId}` : `object:${reading.objectGlobalId}`;
}

function acceptSpecOf(
  reading: TypeMatchReading,
  names: { objectName(globalId: number): string; tagName(globalId: number): string },
): AcceptSpec {
  if (reading.kind === 'not') return { not: acceptSpecOf(reading.inner, names) };
  return reading.kind === 'tag'
    ? { tag: names.tagName(reading.tagGlobalId) }
    : { object: names.objectName(reading.objectGlobalId) };
}
