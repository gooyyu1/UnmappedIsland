import type { ConditionOp, ConditionReader } from './ConditionReader';
import type { PropertyPath, ReferenceContext, ReferenceRoot } from './ReferenceRoot';
import type { TypeMatchRule } from './TypeMatchRule';

type ConditionNodeKind =
  /** {subject, prop, <比較演算子>: value}形式のプロパティ比較。 */
  | 'property'
  /** {subject, prop, in_stage}形式。propの実効値が、その名前の段（6.4節）に該当しているか。 */
  | 'property_stage'
  /**
   * {subject, in_slot}形式。subjectが今まさに親のin_slotに入っているか（等価判定のみ。
   * 否定はnotで包む）。「subjectが外から見てどこに位置するか」を見る。
   */
  | 'slot_position'
  /**
   * {subject, slot, matches}形式。subjectが持つslotの中に、matchesに当てはまる子が1つでもあるか
   * （存在判定）。slot_positionとは向きが逆で「subjectの内側、そのスロットの中身」を見る。
   */
  | 'slot_content'
  /** {subject, matches}形式。subject自身がmatchesに当てはまるか。 */
  | 'object_matches'
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
  readonly containerSlotGlobalId?: number;
  readonly ownedSlotGlobalId?: number;
  readonly matchRule?: TypeMatchRule;
  readonly children?: readonly ConditionNode[];
}

/**
 * conditions（14節）の1ノード。actions/combinationsの一度きりの判定と、passivesの持続的なゲートが
 * 同じ木を共用する。葉はproperty・property_stage・slot_position・slot_content・object_matchesの5種、
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

  /** property葉のみ有効。設定されていれば、リテラルvalue（values）の代わりに{subject, prop}参照先の
   * 現在の実効値と比較する（10.2節と同じ「リテラルか参照か」の二択）。in/not_inでは意味を持たない
   * （ロード時エラー）。 */
  private readonly valueRef: PropertyPath | undefined;

  /** property_stage葉のみ有効。段は宣言したPropertyDefごとの名前なので、internせず文字列で持つ。 */
  private readonly stageName: string | undefined;

  /** slot_position葉のみ有効。subjectがその枠に入っているかを見る、subjectの親の側のスロット。 */
  private readonly containerSlotGlobalId: number | undefined;

  /** slot_content葉のみ有効。中身を見る、subject自身が持つスロット。 */
  private readonly ownedSlotGlobalId: number | undefined;

  /** slot_content/object_matches葉のみ有効。 */
  private readonly matchRule: TypeMatchRule | undefined;

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
    this.containerSlotGlobalId = fields.containerSlotGlobalId;
    this.ownedSlotGlobalId = fields.ownedSlotGlobalId;
    this.matchRule = fields.matchRule;
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

  static slotPosition(root: ReferenceRoot, containerSlotGlobalId: number): ConditionNode {
    return new ConditionNode('slot_position', { root, containerSlotGlobalId });
  }

  static slotContent(
    root: ReferenceRoot,
    ownedSlotGlobalId: number,
    matchRule: TypeMatchRule,
  ): ConditionNode {
    return new ConditionNode('slot_content', { root, ownedSlotGlobalId, matchRule });
  }

  static objectMatches(root: ReferenceRoot, matchRule: TypeMatchRule): ConditionNode {
    return new ConditionNode('object_matches', { root, matchRule });
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
   * この条件が何を書いているかを読み上げる（ConditionReader参照）。**kindごとに使うフィールドだけを
   * 引数で渡す**ので、読み手はこのクラスの持ち方（単一クラス+kind）を知らなくてよい。
   */
  read(reader: ConditionReader): void {
    switch (this.kind) {
      case 'property':
        return reader.property({
          root: this.root!,
          propertyGlobalId: this.propertyGlobalId!,
          op: this.op!,
          values: this.values,
          valueRef: this.valueRef,
        });
      case 'property_stage':
        return reader.propertyStage(this.root!, this.propertyGlobalId!, this.stageName!);
      case 'slot_position':
        return reader.slotPosition(this.root!, this.containerSlotGlobalId!);
      case 'slot_content':
        return reader.slotContent(this.root!, this.ownedSlotGlobalId!, this.matchRule!.reading);
      case 'object_matches':
        return reader.objectMatches(this.root!, this.matchRule!.reading);
      case 'all':
        return reader.all(this.children!);
      case 'any':
        return reader.any(this.children!);
      default:
        return reader.not(this.children![0]);
    }
  }

  evaluate(context: ReferenceContext): boolean {
    switch (this.kind) {
      case 'property':
        return this.evaluateProperty(context);
      case 'property_stage':
        return this.evaluatePropertyStage(context);
      case 'slot_position':
        return this.evaluateSlotPosition(context);
      case 'slot_content':
        return this.evaluateSlotContent(context);
      case 'object_matches':
        return this.evaluateObjectMatches(context);
      case 'all':
        return this.children!.every((child) => child.evaluate(context));
      case 'any':
        return this.children!.some((child) => child.evaluate(context));
      case 'not':
        return !this.children![0].evaluate(context);
      default:
        return false;
    }
  }

  private evaluateProperty(context: ReferenceContext): boolean {
    const currentValue = this.effectiveValueAt(this.root!, this.propertyGlobalId!, context);
    if (currentValue === undefined) return false;
    const current = currentValue;

    if (this.op === 'in') return this.values!.some((v) => current === v);
    if (this.op === 'not_in') return !this.values!.some((v) => current === v);

    let compare: number;
    if (this.valueRef !== undefined) {
      const resolved = this.valueRef.effectiveNumber(context);
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
  private evaluatePropertyStage(context: ReferenceContext): boolean {
    const owner = context.ownerOfProperty(this.root!, this.propertyGlobalId!);
    return (
      owner !== undefined &&
      (owner.tryGetProperty(this.propertyGlobalId!)?.isInStage(this.stageName!) ?? false)
    );
  }

  /** rootが指す相手のpropertyGlobalIdの実効値。相手が解決できない・持たない場合はundefined。 */
  private effectiveValueAt(
    root: ReferenceRoot,
    propertyGlobalId: number,
    context: ReferenceContext,
  ): number | undefined {
    return context
      .ownerOfProperty(root, propertyGlobalId)
      ?.tryGetProperty(propertyGlobalId)
      ?.getEffectiveValue();
  }

  private evaluateSlotPosition(context: ReferenceContext): boolean {
    const target = context.objectAt(this.root!);
    return target?.parent !== undefined && target.parentSlot?.def.globalId === this.containerSlotGlobalId;
  }

  private evaluateSlotContent(context: ReferenceContext): boolean {
    const target = context.objectAt(this.root!);
    const slot = target?.tryGetSlot(this.ownedSlotGlobalId!);
    return slot !== undefined && slot.contents.some((child) => this.matchRule!.matches(child.def));
  }

  private evaluateObjectMatches(context: ReferenceContext): boolean {
    const target = context.objectAt(this.root!);
    return target !== undefined && this.matchRule!.matches(target.def);
  }
}
