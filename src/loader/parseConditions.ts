import type { YAMLMap, YAMLSeq } from 'yaml';
import { isMap, isSeq } from 'yaml';
import { asMap, asScalarText, entriesInOrder, requireScalar, tryGetScalar, tryGetSeq } from './yamlMapping';
import type { YamlNode } from './yamlMapping';
import { YamlLoadError } from './YamlLoadError';
import { tryGetNode, parseScalarNumber } from './parseCommon';
import type { WorldCodexYamlLoader } from './WorldCodexYamlLoader';
import type { ReferenceRoot } from '../domain/defs/ReferenceRoot';
import { PropertyPath } from '../domain/defs/ReferenceRoot';
import { ConditionNode } from '../domain/defs/ConditionNode';
import type { ConditionOp } from '../domain/defs/ConditionNode';

/**
 * conditions（14節）・passivesのゲート（8節）が共通で使うobject参照キー。
 * worldはシングルトンインスタンスの実行時追跡が無いため未対応（ancestorで代替できる）。
 */
export function parseConditionObject(
  context: string,
  raw: string,
  allowedRoots: ReadonlySet<ReferenceRoot>,
): ReferenceRoot {
  let root: ReferenceRoot;
  switch (raw) {
    case 'self':
      root = 'self';
      break;
    case 'parent':
      root = 'parent';
      break;
    case 'ancestor':
      root = 'ancestor';
      break;
    case 'actor':
      root = 'actor';
      break;
    case 'dragged':
      root = 'dragged';
      break;
    case 'world':
      throw new YamlLoadError(
        `${context}: object 'world' は未対応です（worldシングルトンインスタンスの実行時追跡が未実装のため）。`,
      );
    default:
      throw new YamlLoadError(`${context}: 未知のobject '${raw}' です。`);
  }

  if (!allowedRoots.has(root))
    throw new YamlLoadError(`${context}: この文脈でobject '${raw}' は使えません。`);

  return root;
}

export const ACTION_CONDITION_ROOTS: ReadonlySet<ReferenceRoot> = new Set([
  'self',
  'parent',
  'ancestor',
  'actor',
]);

export const COMBINATION_CONDITION_ROOTS: ReadonlySet<ReferenceRoot> = new Set([
  'self',
  'parent',
  'ancestor',
  'actor',
  'dragged',
]);

/** passivesのゲートで使えるobject。selfはSlotBearer、parentはその1つ上
 * （RegisteredPassiveEffect参照）、ancestorは祖先探索（WorldObject.FindAncestorWithProperty参照）。
 * actor/draggedは持続的な関係に紐づかないため未対応。 */
export const PASSIVE_CONDITION_ROOTS: ReadonlySet<ReferenceRoot> = new Set(['self', 'parent', 'ancestor']);

/**
 * conditions（14節）の値。常にYAML配列（暗黙のall）。要素は葉（{object, prop, op, value}か
 * {object, slot}）か、入れ子のall/any/notのいずれか。conditionsNodeがundefinedなら省略（常に真）。
 */
export function parseConditionsField(
  loader: WorldCodexYamlLoader,
  context: string,
  conditionsNode: YAMLSeq | undefined,
  allowedRoots: ReadonlySet<ReferenceRoot>,
): ConditionNode | undefined {
  if (conditionsNode === undefined) return undefined;

  const children: ConditionNode[] = [];
  for (const node of conditionsNode.items as YamlNode[])
    children.push(
      parseConditionNode(loader, `${context}.conditions[${children.length}]`, node, allowedRoots),
    );

  return ConditionNode.all(children);
}

/** 条件木の1ノードを読む。all/any/notのいずれかのキーを持てば複合ノード、それ以外は
 * 葉（プロパティ比較・スロット位置判定・スロット中身判定のいずれか）として読む。 */
function parseConditionNode(
  loader: WorldCodexYamlLoader,
  context: string,
  node: YamlNode,
  allowedRoots: ReadonlySet<ReferenceRoot>,
): ConditionNode {
  const map = asMap(node, context);

  const allNode = tryGetSeq(map, 'all', context);
  const anyNode = tryGetSeq(map, 'any', context);
  const notNode = tryGetNode(map, 'not');

  const combinatorCount =
    (allNode !== undefined ? 1 : 0) + (anyNode !== undefined ? 1 : 0) + (notNode !== undefined ? 1 : 0);
  if (combinatorCount > 1) throw new YamlLoadError(`${context}: all/any/notは同時に指定できません。`);

  if (allNode !== undefined)
    return ConditionNode.all(parseCombinatorChildren(loader, context, 'all', allNode, allowedRoots));
  if (anyNode !== undefined)
    return ConditionNode.any(parseCombinatorChildren(loader, context, 'any', anyNode, allowedRoots));

  if (notNode !== undefined) {
    const unknown = entriesInOrder(map)
      .map(([key]) => key)
      .filter((key) => key !== 'not');
    if (unknown.length > 0)
      throw new YamlLoadError(`${context}: 'not'は他のキーと同居できません（値: '${unknown.join(', ')}'）。`);

    return ConditionNode.not(parseConditionNode(loader, `${context}.not`, notNode, allowedRoots));
  }

  return parseConditionLeaf(loader, context, map, allowedRoots);
}

function parseCombinatorChildren(
  loader: WorldCodexYamlLoader,
  context: string,
  key: string,
  seq: YAMLSeq,
  allowedRoots: ReadonlySet<ReferenceRoot>,
): ConditionNode[] {
  const children: ConditionNode[] = [];
  for (const node of seq.items as YamlNode[])
    children.push(parseConditionNode(loader, `${context}.${key}[${children.length}]`, node, allowedRoots));
  return children;
}

/**
 * 条件木の葉。objectは省略時self。{object, prop, op(省略時eq), value}のプロパティ比較、
 * {object, in_slot}のスロット位置判定、{object, slot, tag}のスロット中身判定、
 * {object, tag}のタグ判定のいずれかで、同時には指定できない。プロパティ比較のvalueは
 * リテラルか{object, prop}参照（10.2節と同じ二択）。参照はlt/lte/gt/gte/eq/neqのみで使える
 * （in/not_inは複数値との比較のため噛み合わない）。
 */
function parseConditionLeaf(
  loader: WorldCodexYamlLoader,
  context: string,
  map: YAMLMap,
  allowedRoots: ReadonlySet<ReferenceRoot>,
): ConditionNode {
  const objectName = tryGetScalar(map, 'object', context);
  const root = objectName !== undefined ? parseConditionObject(context, objectName, allowedRoots) : 'self';

  const inSlotName = tryGetScalar(map, 'in_slot', context);
  const slotName = tryGetScalar(map, 'slot', context);
  const tagName = tryGetScalar(map, 'tag', context);
  const propName = tryGetScalar(map, 'prop', context);

  const leafKeyCount =
    (inSlotName !== undefined ? 1 : 0) +
    (slotName !== undefined ? 1 : 0) +
    (propName !== undefined ? 1 : 0) +
    (tagName !== undefined && slotName === undefined ? 1 : 0);
  if (leafKeyCount > 1)
    throw new YamlLoadError(`${context}: 'in_slot'/'slot'/'prop'/'tag'は同時に指定できません。`);

  if (inSlotName !== undefined) {
    if (root === 'ancestor')
      throw new YamlLoadError(
        `${context}: in_slot判定でobject 'ancestor'は未対応です（ancestorはプロパティ名で祖先を探すため、探すプロパティを持たないin_slot判定とは噛み合いません）。`,
      );

    const unknownInSlotKeys = entriesInOrder(map)
      .map(([key]) => key)
      .filter((key) => key !== 'object' && key !== 'in_slot');
    if (unknownInSlotKeys.length > 0)
      throw new YamlLoadError(
        `${context}: 未知のキー '${unknownInSlotKeys.join(', ')}' です（in_slot判定はobject/in_slotのみ持てます）。`,
      );

    return ConditionNode.slotPosition(root, loader.slotNames.intern(inSlotName));
  }

  if (slotName !== undefined) {
    if (tagName === undefined)
      throw new YamlLoadError(`${context}: 'slot'を使うスロット中身判定には'tag'が必須です。`);

    const unknownSlotKeys = entriesInOrder(map)
      .map(([key]) => key)
      .filter((key) => key !== 'object' && key !== 'slot' && key !== 'tag');
    if (unknownSlotKeys.length > 0)
      throw new YamlLoadError(
        `${context}: 未知のキー '${unknownSlotKeys.join(', ')}' です（スロット中身判定はobject/slot/tagのみ持てます）。`,
      );

    return ConditionNode.slotContent(
      root,
      loader.slotNames.intern(slotName),
      loader.tagNames.intern(tagName),
    );
  }

  if (tagName !== undefined) {
    const unknownTagKeys = entriesInOrder(map)
      .map(([key]) => key)
      .filter((key) => key !== 'object' && key !== 'tag');
    if (unknownTagKeys.length > 0)
      throw new YamlLoadError(
        `${context}: 未知のキー '${unknownTagKeys.join(', ')}' です（tag判定はobject/tagのみ持てます）。`,
      );

    return ConditionNode.objectTag(root, loader.tagNames.intern(tagName));
  }

  if (propName === undefined)
    throw new YamlLoadError(`${context}: 'prop'・'in_slot'・'slot'・'tag'のいずれかが必要です。`);

  let op: ConditionOp = 'eq';
  const rawOp = tryGetScalar(map, 'op', context);
  if (rawOp !== undefined) op = parseConditionOp(context, rawOp);

  const valueNode = tryGetNode(map, 'value');
  if (valueNode === undefined) throw new YamlLoadError(`${context}: 必須フィールド 'value' がありません。`);

  const unknownKeys = entriesInOrder(map)
    .map(([key]) => key)
    .filter((key) => key !== 'object' && key !== 'prop' && key !== 'op' && key !== 'value');
  if (unknownKeys.length > 0)
    throw new YamlLoadError(`${context}: 未知のキー '${unknownKeys.join(', ')}' です。`);

  if (isMap(valueNode)) {
    if (op === 'in' || op === 'not_in')
      throw new YamlLoadError(
        `${context}: op '${op}' は{object, prop}参照のvalueと組み合わせられません（複数値との比較のため）。`,
      );

    const refObjectName = tryGetScalar(valueNode, 'object', context);
    const refRoot =
      refObjectName !== undefined ? parseConditionObject(context, refObjectName, allowedRoots) : 'self';
    const refPropName = requireScalar(valueNode, 'prop', context);

    const unknownRefKeys = entriesInOrder(valueNode)
      .map(([key]) => key)
      .filter((key) => key !== 'object' && key !== 'prop');
    if (unknownRefKeys.length > 0)
      throw new YamlLoadError(`${context}.value: 未知のキー '${unknownRefKeys.join(', ')}' です。`);

    const valueRef = new PropertyPath(refRoot, loader.propertyNames.intern(refPropName));
    return ConditionNode.property(root, loader.propertyNames.intern(propName), op, undefined, valueRef);
  }

  const values = parseConditionValues(loader, context, op, valueNode);
  return ConditionNode.property(root, loader.propertyNames.intern(propName), op, values);
}

function parseConditionOp(context: string, raw: string): ConditionOp {
  switch (raw) {
    case 'lt':
      return 'lt';
    case 'lte':
      return 'lte';
    case 'gt':
      return 'gt';
    case 'gte':
      return 'gte';
    case 'eq':
      return 'eq';
    case 'neq':
      return 'neq';
    case 'in':
      return 'in';
    case 'not_in':
      return 'not_in';
    default:
      throw new YamlLoadError(`${context}: 未知のop '${raw}' です。`);
  }
}

function parseConditionValues(
  loader: WorldCodexYamlLoader,
  context: string,
  op: ConditionOp,
  valueNode: YamlNode,
): number[] {
  const isList = op === 'in' || op === 'not_in';

  if (isList) {
    if (!isSeq(valueNode))
      throw new YamlLoadError(`${context}: op '${op}' のvalueは配列である必要があります。`);
    return (valueNode.items as YamlNode[]).map((n) =>
      parseConditionScalar(loader, context, asScalarText(n, context)),
    );
  }

  if (isSeq(valueNode) || isMap(valueNode))
    throw new YamlLoadError(`${context}: valueはスカラー値である必要があります。`);

  return [parseConditionScalar(loader, context, asScalarText(valueNode, context))];
}

function parseConditionScalar(loader: WorldCodexYamlLoader, context: string, raw: string): number {
  if (raw === 'max' || raw === 'min')
    throw new YamlLoadError(
      `${context}: value '${raw}' は未対応です（参照先プロパティのrangeの${raw}を指す規約がまだ確定していないため）。`,
    );

  const [value] = parseScalarNumber(loader, context, raw);
  return value;
}
