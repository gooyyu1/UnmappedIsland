import type { StageBound } from './PropertyDef';
import type { PropertyPath, ReferenceRoot } from './ReferenceRoot';
import type { TypeMatchReading } from './TypeMatchRule';

/** GameElementDefinition.md 14.1節の比較演算子。 */
export type ConditionOp = 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'neq' | 'in' | 'not_in';

/**
 * conditions（14節）の木を**何が書かれているか**として読み上げる相手（ConditionNode.read）。
 *
 * 葉の種類ごとにメソッドを持つのは、種類を1つ足したときに読み手が黙って取りこぼさないようにするため
 * （効果の読み上げ口（EffectReader）と同じ理由）。**kindごとに使うフィールドが引数で決まる**ので、
 * 読み手の側に「このkindならこのフィールドがあるはず」という非nullの思い込みが要らない。
 *
 * 複合ノード（all/any/not）は子を読み下せる形（ConditionDeclaration）で渡す。入れ子をどう畳むかは
 * 読み手が決める。
 */
export interface ConditionReader {
  /** `{subject, prop, <比較演算子>: value}`。値はリテラルの並びか、別のプロパティへの参照。 */
  property(reading: PropertyConditionReading): void;

  /**
   * `{subject, prop, in_stage}`・`{subject, prop, in_stage_or_above}`。propの実効値がその名前の段
   * （6.4節）に該当しているか。boundはちょうどその段か、その段以上か（14.1節）。
   */
  propertyStage(root: ReferenceRoot, propertyGlobalId: number, stageName: string, bound: StageBound): void;

  /** `{subject, in_slot}`。subjectが今まさに親のそのスロットに入っているか。 */
  slotPosition(root: ReferenceRoot, slotGlobalId: number): void;

  /** `{subject, slot, matches}`。subjectが持つスロットの中に、当てはまる子が1つでもあるか。 */
  slotContent(root: ReferenceRoot, slotGlobalId: number, match: TypeMatchReading): void;

  /** `{subject, matches}`。subject自身が当てはまるか。 */
  objectMatches(root: ReferenceRoot, match: TypeMatchReading): void;

  /** 子すべての論理積。 */
  all(children: readonly ConditionDeclaration[]): void;

  /** 子のいずれかの論理和。 */
  any(children: readonly ConditionDeclaration[]): void;

  /** 子（常に1つ）の否定。 */
  not(child: ConditionDeclaration): void;
}

/**
 * 自分が何を宣言しているかを読み上げられる条件。入れ子の子もこの形で渡す
 * （docs/CodeStructure.md 5節「読み下せる宣言だけを外へ出す」）。
 */
export interface ConditionDeclaration {
  read(reader: ConditionReader): void;
}

/** プロパティ比較1つの宣言。valuesとvalueRefはどちらか一方だけを持つ。 */
export interface PropertyConditionReading {
  readonly root: ReferenceRoot;
  readonly propertyGlobalId: number;
  readonly op: ConditionOp;

  /** リテラルとの比較。lt/lte/gt/gte/eq/neqは常に1要素、in/not_inは複数になりうる。 */
  readonly values: readonly number[] | undefined;

  /** 別のプロパティの実効値との比較（10.2節と同じ「リテラルか参照か」の二択）。 */
  readonly valueRef: PropertyPath | undefined;
}
