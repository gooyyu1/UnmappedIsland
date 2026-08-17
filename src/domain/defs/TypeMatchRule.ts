import type { DefNames, DescriptionToken } from './Description';
import { objectRef, tagRef, text } from './Description';
import type { ObjectDef } from './ObjectDef';

/** マッチングの基準（TypeMatchRule参照）。 */
type TypeMatchTargetKind =
  /** targetはタグのグローバルID（4.1節）。候補がそのタグを持っていれば真。 */
  | 'tag'
  /** targetはobject_defのグローバルID。候補がまさにその型そのものであれば真。 */
  | 'object';

/** 「どの型を指しているか」の読み上げ（TypeMatchRule.reading参照）。 */
export type TypeMatchReading =
  | { readonly kind: 'tag'; readonly tagGlobalId: number }
  | { readonly kind: 'object'; readonly objectGlobalId: number };

/**
 * 「どの型が当てはまるか」の指定（GameElementDefinition.md 4.1節）。枠のaccept（7.2節）と
 * combinationsのwith（12.1節）が共通で使う。
 *
 * タグで指せば、そのタグを持つあらゆる型（MOD追加分も含む）が当てはまる。object_defのidで指せば
 * まさにその型だけが当てはまり、そのためだけの単発タグを新設せずに済む。trait名では直接
 * マッチングしない（traitはmixin合成後に消えるため、外部から参照すべきではない）。
 */
export class TypeMatchRule {
  private readonly kind: TypeMatchTargetKind;
  private readonly target: number;

  private constructor(kind: TypeMatchTargetKind, target: number) {
    this.kind = kind;
    this.target = target;
  }

  static tag(tagGlobalId: number): TypeMatchRule {
    return new TypeMatchRule('tag', tagGlobalId);
  }

  static object(objectGlobalId: number): TypeMatchRule {
    return new TypeMatchRule('object', objectGlobalId);
  }

  /** タグならcandidateがそのタグを持てば真、object_defならまさにその型であれば真。 */
  matches(candidateDef: ObjectDef): boolean {
    return this.kind === 'tag'
      ? candidateDef.tags.includes(this.target)
      : candidateDef.globalId === this.target;
  }

  /** この指定を書き表す（Description参照）。 */
  describe(names: DefNames): readonly DescriptionToken[] {
    return this.kind === 'tag'
      ? [tagRef(names.tagName(this.target)), text('を持つ型')]
      : [objectRef(names.objectName(this.target)), text('そのもの')];
  }

  /**
   * 同じ指定どうしをまとめるための鍵。タグとobject_defはIDの空間が別なので、種類を混ぜて比べない
   * ようにここで前置きを付ける（レシピの要求を型ごとに畳むのに使う、crafting.remainingRequirements）。
   */
  get key(): string {
    return `${this.kind}:${this.target}`;
  }

  /** この指定に当てはまる型を全部挙げる。1つに定まらない指定（タグ）を絵で見せるのに使う。 */
  candidates(defs: Iterable<ObjectDef>): readonly ObjectDef[] {
    return [...defs].filter((def) => this.matches(def));
  }

  /**
   * 枠の`accept`（7.2節）として書き出した形。レシピの要求から製作中オブジェクトの枠を組み立てる
   * （inProgressObjects）ときに、宣言をYAMLへ戻すために使う。
   */
  acceptSpec(names: {
    objectName(globalId: number): string;
    tagName(globalId: number): string;
  }): Record<string, string> {
    return this.kind === 'tag'
      ? { tag: names.tagName(this.target) }
      : { object: names.objectName(this.target) };
  }

  /** この指定の宣言そのもの（TypeMatchReading参照）。 */
  get reading(): TypeMatchReading {
    return this.kind === 'tag'
      ? { kind: 'tag', tagGlobalId: this.target }
      : { kind: 'object', objectGlobalId: this.target };
  }
}
