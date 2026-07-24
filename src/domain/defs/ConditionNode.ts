import type { WorldObject } from '../runtime/WorldObject';
import { LocalIndexMap } from './LocalIndexMap';
import type { PropertyPath, ReferenceRoot } from './ReferenceRoot';

/** GameElementDefinition.md 14.1節の比較演算子。 */
export type ConditionOp = 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'neq' | 'in' | 'not_in';

type ConditionNodeKind =
  /** {object, prop, op, value}形式のプロパティ比較。 */
  | 'property'
  /**
   * {object, in_slot}形式。objectが今まさに親のin_slotに入っているか（常に等価判定でopは持たない。
   * 否定はnotで包む）。「objectが外から見てどこに位置するか」を見る。
   */
  | 'slot_position'
  /**
   * {object, slot, tag}形式。object自身が持つslotの中に、tagを持つ子が1つでもあるか（存在判定でopは
   * 持たない）。slot_positionとは向きが逆で「objectの内側、自分のスロットの中身」を見る。
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

/**
 * conditions（14節）の1ノード。actions/combinationsの一度きりの判定と、passivesの持続的なゲートが
 * 同じ木を共用する。葉はproperty・slot_position・slot_content・object_tagの4種、複合はall/any/notの3種で、
 * kindに応じて使うフィールドが変わる（単一クラス+kindで判別）。
 */
export class ConditionNode {
  private readonly kind: ConditionNodeKind;

  /** property/slot_position/slot_content/object_tag葉のみ有効。 */
  private readonly root: ReferenceRoot | undefined;

  /** property葉のみ有効。 */
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

  /** slot_position/slot_content葉のみ有効。slot_positionではobjectの親の中の位置、
   * slot_contentではobject自身が持つスロットを指す（向きが異なる）。 */
  private readonly slotGlobalId: number | undefined;

  /** slot_content/object_tag葉のみ有効。 */
  private readonly tagGlobalId: number | undefined;

  /** all/any/notのみ有効。notは常に1要素。 */
  private readonly children: readonly ConditionNode[] | undefined;

  private constructor(
    kind: ConditionNodeKind,
    root: ReferenceRoot | undefined,
    propertyGlobalId: number | undefined,
    op: ConditionOp | undefined,
    values: readonly number[] | undefined,
    valueRef: PropertyPath | undefined,
    slotGlobalId: number | undefined,
    tagGlobalId: number | undefined,
    children: readonly ConditionNode[] | undefined,
  ) {
    this.kind = kind;
    this.root = root;
    this.propertyGlobalId = propertyGlobalId;
    this.op = op;
    this.values = values;
    this.valueRef = valueRef;
    this.slotGlobalId = slotGlobalId;
    this.tagGlobalId = tagGlobalId;
    this.children = children;
  }

  static property(
    root: ReferenceRoot,
    propertyGlobalId: number,
    op: ConditionOp,
    values: readonly number[] | undefined,
    valueRef?: PropertyPath,
  ): ConditionNode {
    return new ConditionNode(
      'property',
      root,
      propertyGlobalId,
      op,
      values,
      valueRef,
      undefined,
      undefined,
      undefined,
    );
  }

  static slotPosition(root: ReferenceRoot, slotGlobalId: number): ConditionNode {
    return new ConditionNode(
      'slot_position',
      root,
      undefined,
      undefined,
      undefined,
      undefined,
      slotGlobalId,
      undefined,
      undefined,
    );
  }

  static slotContent(root: ReferenceRoot, slotGlobalId: number, tagGlobalId: number): ConditionNode {
    return new ConditionNode(
      'slot_content',
      root,
      undefined,
      undefined,
      undefined,
      undefined,
      slotGlobalId,
      tagGlobalId,
      undefined,
    );
  }

  static objectTag(root: ReferenceRoot, tagGlobalId: number): ConditionNode {
    return new ConditionNode(
      'object_tag',
      root,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      tagGlobalId,
      undefined,
    );
  }

  static all(children: readonly ConditionNode[]): ConditionNode {
    return new ConditionNode(
      'all',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      children,
    );
  }

  static any(children: readonly ConditionNode[]): ConditionNode {
    return new ConditionNode(
      'any',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      children,
    );
  }

  static not(inner: ConditionNode): ConditionNode {
    return new ConditionNode(
      'not',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [inner],
    );
  }

  evaluate(resolveRoot: (root: ReferenceRoot) => WorldObject | undefined): boolean {
    switch (this.kind) {
      case 'property':
        return this.evaluateProperty(resolveRoot);
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

  private resolvePropertyEffectiveValue(
    root: ReferenceRoot,
    propertyGlobalId: number,
    resolveRoot: (root: ReferenceRoot) => WorldObject | undefined,
  ): number | undefined {
    const target =
      root === 'ancestor'
        ? resolveRoot('self')?.findAncestorWithProperty(propertyGlobalId)
        : resolveRoot(root);
    if (target === undefined) return undefined;
    const value = target.tryGetProperty(propertyGlobalId);
    return value !== undefined ? value.getEffectiveValue() : undefined;
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
