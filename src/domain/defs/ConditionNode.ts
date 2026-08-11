import type { WorldObject } from '../runtime/WorldObject';
import type { DefNames, DescriptionToken } from './Description';
import { propertyRef, slotRef, stageRef, tagRef, text } from './Description';
import { LocalIndexMap } from './LocalIndexMap';
import type { PropertyPath, ReferenceRoot } from './ReferenceRoot';

/** GameElementDefinition.md 14.1節の比較演算子。 */
export type ConditionOp = 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'neq' | 'in' | 'not_in';

/** 比較演算子の書き表し方（describe用）。 */
const OP_SYMBOLS: Readonly<Record<ConditionOp, string>> = {
  lt: '<',
  lte: '<=',
  gt: '>',
  gte: '>=',
  eq: '==',
  neq: '!=',
  in: 'in',
  not_in: 'not in',
};

type ConditionNodeKind =
  /** {object, prop, <比較演算子>: value}形式のプロパティ比較。 */
  | 'property'
  /** {object, prop, in_stage}形式。propの実効値が、その名前の段（6.4節）に該当しているか。 */
  | 'property_stage'
  /**
   * {object, in_slot}形式。objectが今まさに親のin_slotに入っているか（等価判定のみ。
   * 否定はnotで包む）。「objectが外から見てどこに位置するか」を見る。
   */
  | 'slot_position'
  /**
   * {object, slot, tag}形式。object自身が持つslotの中に、tagを持つ子が1つでもあるか（存在判定）。
   * slot_positionとは向きが逆で「objectの内側、自分のスロットの中身」を見る。
   */
  | 'slot_content'
  /** {object, tag}形式。object自身がtagを持つか（存在判定）。 */
  | 'object_tag'
  /** 子ノードすべての論理積。 */
  | 'all'
  /** 子ノードのいずれかの論理和。 */
  | 'any'
  /** 子ノード（常に1つ）の否定。 */
  | 'not';

/** kindごとに使うフィールドだけを渡すための、生成時の入力（ConditionNodeの各staticが組み立てる）。 */
interface ConditionNodeFields {
  readonly root?: ReferenceRoot;
  readonly propertyGlobalId?: number;
  readonly op?: ConditionOp;
  readonly values?: readonly number[];
  readonly valueRef?: PropertyPath;
  readonly stageName?: string;
  readonly slotGlobalId?: number;
  readonly tagGlobalId?: number;
  readonly children?: readonly ConditionNode[];
}

/**
 * conditions（14節）の1ノード。actions/combinationsの一度きりの判定と、passivesの持続的なゲートが
 * 同じ木を共用する。葉はproperty・property_stage・slot_position・slot_content・object_tagの5種、
 * 複合はall/any/notの3種で、kindに応じて使うフィールドが変わる（単一クラス+kindで判別）。
 */
export class ConditionNode {
  private readonly kind: ConditionNodeKind;

  /** 葉（all/any/not以外）のみ有効。 */
  private readonly root: ReferenceRoot | undefined;

  /** property/property_stage葉のみ有効。 */
  private readonly propertyGlobalId: number | undefined;

  /** property葉のみ有効。 */
  private readonly op: ConditionOp | undefined;

  /** property葉のみ有効かつvalueRefがundefinedの場合のみ使う。lt/lte/gt/gte/eq/neqは常に1要素。
   * in/not_inは複数要素になりうる。 */
  private readonly values: readonly number[] | undefined;

  /** property葉のみ有効。設定されていれば、リテラルvalue（values）の代わりに{object, prop}参照先の
   * 現在の実効値と比較する（10.2節と同じ「リテラルか参照か」の二択）。in/not_inでは意味を持たない
   * （ロード時エラー）。 */
  private readonly valueRef: PropertyPath | undefined;

  /** property_stage葉のみ有効。段は宣言したPropertyDefごとの名前なので、internせず文字列で持つ。 */
  private readonly stageName: string | undefined;

  /** slot_position/slot_content葉のみ有効。slot_positionではobjectの親の中の位置、
   * slot_contentではobject自身が持つスロットを指す（向きが異なる）。 */
  private readonly slotGlobalId: number | undefined;

  /** slot_content/object_tag葉のみ有効。 */
  private readonly tagGlobalId: number | undefined;

  /** all/any/notのみ有効。notは常に1要素。 */
  private readonly children: readonly ConditionNode[] | undefined;

  private constructor(kind: ConditionNodeKind, fields: ConditionNodeFields) {
    this.kind = kind;
    this.root = fields.root;
    this.propertyGlobalId = fields.propertyGlobalId;
    this.op = fields.op;
    this.values = fields.values;
    this.valueRef = fields.valueRef;
    this.stageName = fields.stageName;
    this.slotGlobalId = fields.slotGlobalId;
    this.tagGlobalId = fields.tagGlobalId;
    this.children = fields.children;
  }

  static property(
    root: ReferenceRoot,
    propertyGlobalId: number,
    op: ConditionOp,
    values: readonly number[] | undefined,
    valueRef?: PropertyPath,
  ): ConditionNode {
    return new ConditionNode('property', { root, propertyGlobalId, op, values, valueRef });
  }

  static propertyStage(root: ReferenceRoot, propertyGlobalId: number, stageName: string): ConditionNode {
    return new ConditionNode('property_stage', { root, propertyGlobalId, stageName });
  }

  static slotPosition(root: ReferenceRoot, slotGlobalId: number): ConditionNode {
    return new ConditionNode('slot_position', { root, slotGlobalId });
  }

  static slotContent(root: ReferenceRoot, slotGlobalId: number, tagGlobalId: number): ConditionNode {
    return new ConditionNode('slot_content', { root, slotGlobalId, tagGlobalId });
  }

  static objectTag(root: ReferenceRoot, tagGlobalId: number): ConditionNode {
    return new ConditionNode('object_tag', { root, tagGlobalId });
  }

  static all(children: readonly ConditionNode[]): ConditionNode {
    return new ConditionNode('all', { children });
  }

  static any(children: readonly ConditionNode[]): ConditionNode {
    return new ConditionNode('any', { children });
  }

  static not(inner: ConditionNode): ConditionNode {
    return new ConditionNode('not', { children: [inner] });
  }

  /**
   * この条件を読める形に書き表す（Description参照）。1つの式なので行に分けず、断片の並びを返す。
   * 複合ノード（all/any/not）は括弧で包み、入れ子の切れ目が読み取れるようにする。
   */
  describe(names: DefNames): readonly DescriptionToken[] {
    switch (this.kind) {
      case 'property':
        return this.describeProperty(names);
      case 'property_stage':
        return [
          propertyRef(names.propertyName(this.propertyGlobalId!), this.root),
          text('が段'),
          stageRef(this.stageName!),
          text('にある'),
        ];
      case 'slot_position':
        return [
          text(`${this.root}が`),
          slotRef(names.slotName(this.slotGlobalId!)),
          text('スロットに入っている'),
        ];
      case 'slot_content':
        return [
          text(`${this.root}の`),
          slotRef(names.slotName(this.slotGlobalId!)),
          text('スロットに'),
          tagRef(names.tagName(this.tagGlobalId!)),
          text('が入っている'),
        ];
      case 'object_tag':
        return [text(`${this.root}が`), tagRef(names.tagName(this.tagGlobalId!)), text('を持つ')];
      case 'all':
        return this.describeChildren(names, 'かつ');
      case 'any':
        return this.describeChildren(names, 'または');
      default:
        return [text('not '), ...this.children![0].describe(names)];
    }
  }

  private describeProperty(names: DefNames): readonly DescriptionToken[] {
    const tokens: DescriptionToken[] = [
      propertyRef(names.propertyName(this.propertyGlobalId!), this.root),
      text(` ${OP_SYMBOLS[this.op!]} `),
    ];

    if (this.valueRef !== undefined) {
      tokens.push(propertyRef(names.propertyName(this.valueRef.propertyGlobalId), this.valueRef.root));
      return tokens;
    }

    const values = (this.values ?? []).map((value) => names.propertyValue(this.propertyGlobalId!, value));
    const isList = this.op === 'in' || this.op === 'not_in';
    if (isList) tokens.push(text('['));
    for (const [index, value] of values.entries()) {
      if (index > 0) tokens.push(text(', '));
      tokens.push(value);
    }
    if (isList) tokens.push(text(']'));
    return tokens;
  }

  private describeChildren(names: DefNames, conjunction: string): readonly DescriptionToken[] {
    const tokens: DescriptionToken[] = [text('(')];
    for (const [index, child] of this.children!.entries()) {
      if (index > 0) tokens.push(text(` ${conjunction} `));
      tokens.push(...child.describe(names));
    }
    tokens.push(text(')'));
    return tokens;
  }

  evaluate(resolveRoot: (root: ReferenceRoot) => WorldObject | undefined): boolean {
    switch (this.kind) {
      case 'property':
        return this.evaluateProperty(resolveRoot);
      case 'property_stage':
        return this.evaluatePropertyStage(resolveRoot);
      case 'slot_position':
        return this.evaluateSlotPosition(resolveRoot);
      case 'slot_content':
        return this.evaluateSlotContent(resolveRoot);
      case 'object_tag':
        return this.evaluateObjectTag(resolveRoot);
      case 'all':
        return this.children!.every((child) => child.evaluate(resolveRoot));
      case 'any':
        return this.children!.some((child) => child.evaluate(resolveRoot));
      case 'not':
        return !this.children![0].evaluate(resolveRoot);
      default:
        return false;
    }
  }

  private evaluateProperty(resolveRoot: (root: ReferenceRoot) => WorldObject | undefined): boolean {
    const currentValue = this.resolvePropertyEffectiveValue(this.root!, this.propertyGlobalId!, resolveRoot);
    if (currentValue === undefined) return false;
    const current = currentValue;

    if (this.op === 'in') return this.values!.some((v) => current === v);
    if (this.op === 'not_in') return !this.values!.some((v) => current === v);

    let compare: number;
    if (this.valueRef !== undefined) {
      const resolved = this.resolvePropertyEffectiveValue(
        this.valueRef.root,
        this.valueRef.propertyGlobalId,
        resolveRoot,
      );
      if (resolved === undefined) return false;
      compare = resolved;
    } else {
      compare = this.values![0];
    }

    switch (this.op) {
      case 'lt':
        return current < compare;
      case 'lte':
        return current <= compare;
      case 'gt':
        return current > compare;
      case 'gte':
        return current >= compare;
      case 'eq':
        return current === compare;
      case 'neq':
        return current !== compare;
      default:
        return false;
    }
  }

  /**
   * 段（6.4節）に該当しているか。プロパティを持たない・解決できない場合は偽で、他の葉と揃える
   * （解決できない葉は偽、否定したければnotで包む）。
   */
  private evaluatePropertyStage(resolveRoot: (root: ReferenceRoot) => WorldObject | undefined): boolean {
    const owner = this.resolvePropertyOwner(this.root!, this.propertyGlobalId!, resolveRoot);
    return owner !== undefined && owner.isInStage(this.propertyGlobalId!, this.stageName!);
  }

  private resolvePropertyEffectiveValue(
    root: ReferenceRoot,
    propertyGlobalId: number,
    resolveRoot: (root: ReferenceRoot) => WorldObject | undefined,
  ): number | undefined {
    const target = this.resolvePropertyOwner(root, propertyGlobalId, resolveRoot);
    const value = target?.tryGetProperty(propertyGlobalId);
    return value !== undefined ? value.getEffectiveValue() : undefined;
  }

  /** そのプロパティを読む相手。ancestorだけは「そのプロパティを定義している最初の祖先」を探す（8.6節）。 */
  private resolvePropertyOwner(
    root: ReferenceRoot,
    propertyGlobalId: number,
    resolveRoot: (root: ReferenceRoot) => WorldObject | undefined,
  ): WorldObject | undefined {
    return root === 'ancestor'
      ? resolveRoot('self')?.findAncestorWithProperty(propertyGlobalId)
      : resolveRoot(root);
  }

  private evaluateSlotPosition(resolveRoot: (root: ReferenceRoot) => WorldObject | undefined): boolean {
    const target = resolveRoot(this.root!);
    if (target?.parent === undefined) return false;

    const slotLocal = target.parent.def.slotLayout.toLocal(this.slotGlobalId!);
    return slotLocal !== LocalIndexMap.missing && target.parentSlotLocalId === slotLocal;
  }

  private evaluateSlotContent(resolveRoot: (root: ReferenceRoot) => WorldObject | undefined): boolean {
    const target = resolveRoot(this.root!);
    const slot = target?.tryGetSlot(this.slotGlobalId!);
    if (slot === undefined) return false;
    return slot.contents.some((child) => child.def.tags.includes(this.tagGlobalId!));
  }

  private evaluateObjectTag(resolveRoot: (root: ReferenceRoot) => WorldObject | undefined): boolean {
    const target = resolveRoot(this.root!);
    return target !== undefined && target.def.tags.includes(this.tagGlobalId!);
  }
}
