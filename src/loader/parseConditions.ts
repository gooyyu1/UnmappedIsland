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
import { Requirement, Requirements } from '../domain/defs/Requirement';

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

/** conditionsの要素にだけ書ける、満たさなかったときの理由の識別子（Requirement参照）。 */
const REASON_KEY = 'reason';

/**
 * conditions（14節）の値。常にYAML配列（暗黙のall）。要素は葉か、入れ子のall/any/notのいずれか。
 * conditionsNodeがundefinedなら省略（常に真）。
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

/**
 * actions/combinationsのconditions。要素ごとに`reason`（満たさなかったときにプレイヤーへ出す理由の
 * 識別子）を持てる点だけがparseConditionsFieldと違う。入れ子のall/any/notの中には書けない
 * （落ちた要件は配列の要素の単位で指すため、Requirement参照）。
 */
export function parseRequirementsField(
  loader: WorldCodexYamlLoader,
  context: string,
  conditionsNode: YAMLSeq | undefined,
  allowedRoots: ReadonlySet<ReferenceRoot>,
): Requirements | undefined {
  if (conditionsNode === undefined) return undefined;

  const entries: Requirement[] = [];
  for (const node of conditionsNode.items as YamlNode[]) {
    const entryContext = `${context}.conditions[${entries.length}]`;
    const reasonName = tryGetScalar(asMap(node, entryContext), REASON_KEY, entryContext);
    entries.push(
      new Requirement(parseConditionNode(loader, entryContext, node, allowedRoots, REASON_KEY), reasonName),
    );
  }

  return new Requirements(entries);
}

/** 条件木の1ノードを読む。all/any/notのいずれかのキーを持てば複合ノード、それ以外は葉として読む。
 * extraKeyは、そのノードでだけ条件式の一部ではないキー（conditionsの要素のreason）。 */
function parseConditionNode(
  loader: WorldCodexYamlLoader,
  context: string,
  node: YamlNode,
  allowedRoots: ReadonlySet<ReferenceRoot>,
  extraKey?: string,
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
      .filter((key) => key !== 'not' && key !== extraKey);
    if (unknown.length > 0)
      throw new YamlLoadError(`${context}: 'not'は他のキーと同居できません（値: '${unknown.join(', ')}'）。`);

    return ConditionNode.not(parseConditionNode(loader, `${context}.not`, notNode, allowedRoots));
  }

  return parseConditionLeaf(loader, context, map, allowedRoots, extraKey);
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

/** プロパティを主語にできる演算子キー。値が比較の相手になる。 */
const PROPERTY_OPS: readonly ConditionOp[] = ['lt', 'lte', 'gt', 'gte', 'eq', 'neq', 'in', 'not_in'];

/** 段の判定（6.4節）の演算子キー。値は段の名前。 */
const IN_STAGE_KEY = 'in_stage';

/**
 * 条件木の葉。**主語を絞るキー（object/prop/slot）と、演算子キー（値が比較の相手）**でできている。
 * objectは省略時self、主語を絞るキーを持たない葉の主語はオブジェクト自身。
 *
 * | 主語 | 使える演算子キー |
 * | --- | --- |
 * | `prop`（プロパティの実効値） | `lt`/`lte`/`gt`/`gte`/`eq`/`neq`/`in`/`not_in`/`in_stage` |
 * | `slot`（自分のそのスロットの中身） | `tag` |
 * | 無し（オブジェクト自身） | `in_slot`（親の中での位置）/`tag`（自分のタグ） |
 *
 * **演算子キーは複数書ける（暗黙のAND）。** conditionsの配列と同じ規則で、範囲判定
 * （`{prop: x, gte: 100, lt: 200}`）のために同じ`prop`を2度書かなくて済む。
 *
 * 比較の相手はリテラルか{object, prop}参照（10.2節と同じ二択）。参照はlt/lte/gt/gte/eq/neqのみで
 * 使える（in/not_inは複数値との比較のため噛み合わない）。
 */
function parseConditionLeaf(
  loader: WorldCodexYamlLoader,
  context: string,
  map: YAMLMap,
  allowedRoots: ReadonlySet<ReferenceRoot>,
  extraKey?: string,
): ConditionNode {
  const objectName = tryGetScalar(map, 'object', context);
  const root = objectName !== undefined ? parseConditionObject(context, objectName, allowedRoots) : 'self';

  const propName = tryGetScalar(map, 'prop', context);
  const slotName = tryGetScalar(map, 'slot', context);
  if (propName !== undefined && slotName !== undefined)
    throw new YamlLoadError(`${context}: 'prop'と'slot'は同時に指定できません（主語は1つです）。`);

  /** 主語を絞るキーと、読み取った演算子キー。残ったキーは綴り間違いか、この主語では使えない演算子。 */
  const used = new Set<string>(['object', 'prop', 'slot']);
  if (extraKey !== undefined) used.add(extraKey);
  const nodes: ConditionNode[] = [];

  if (propName !== undefined) {
    const propertyGlobalId = loader.propertyNames.intern(propName);

    for (const op of PROPERTY_OPS) {
      const valueNode = tryGetNode(map, op);
      if (valueNode === undefined) continue;
      used.add(op);
      nodes.push(
        parsePropertyComparison(loader, context, root, propertyGlobalId, op, valueNode, allowedRoots),
      );
    }

    const stageName = tryGetScalar(map, IN_STAGE_KEY, context);
    if (stageName !== undefined) {
      used.add(IN_STAGE_KEY);
      nodes.push(ConditionNode.propertyStage(root, propertyGlobalId, stageName));
    }
  } else if (slotName !== undefined) {
    const tagName = tryGetScalar(map, 'tag', context);
    if (tagName === undefined)
      throw new YamlLoadError(`${context}: 'slot'を使うスロット中身判定には'tag'が必須です。`);
    used.add('tag');
    nodes.push(
      ConditionNode.slotContent(root, loader.slotNames.intern(slotName), loader.tagNames.intern(tagName)),
    );
  } else {
    const inSlotName = tryGetScalar(map, 'in_slot', context);
    if (inSlotName !== undefined) {
      if (root === 'ancestor')
        throw new YamlLoadError(
          `${context}: in_slot判定でobject 'ancestor'は未対応です（ancestorはプロパティ名で祖先を探すため、探すプロパティを持たないin_slot判定とは噛み合いません）。`,
        );
      used.add('in_slot');
      nodes.push(ConditionNode.slotPosition(root, loader.slotNames.intern(inSlotName)));
    }

    const tagName = tryGetScalar(map, 'tag', context);
    if (tagName !== undefined) {
      used.add('tag');
      nodes.push(ConditionNode.objectTag(root, loader.tagNames.intern(tagName)));
    }
  }

  const unknownKeys = entriesInOrder(map)
    .map(([key]) => key)
    .filter((key) => !used.has(key));
  if (unknownKeys.length > 0)
    throw new YamlLoadError(
      `${context}: 未知のキー '${unknownKeys.join(', ')}' です（この主語では使えない演算子です）。`,
    );

  if (nodes.length === 0)
    throw new YamlLoadError(`${context}: 演算子キーが1つもありません（比較する相手が決まりません）。`);

  return nodes.length === 1 ? nodes[0] : ConditionNode.all(nodes);
}

/** 演算子キー1つぶんのプロパティ比較。値はリテラル（in/not_inでは配列）か{object, prop}参照。 */
function parsePropertyComparison(
  loader: WorldCodexYamlLoader,
  context: string,
  root: ReferenceRoot,
  propertyGlobalId: number,
  op: ConditionOp,
  valueNode: YamlNode,
  allowedRoots: ReadonlySet<ReferenceRoot>,
): ConditionNode {
  if (isMap(valueNode)) {
    if (op === 'in' || op === 'not_in')
      throw new YamlLoadError(
        `${context}: '${op}'は{object, prop}参照と組み合わせられません（複数値との比較のため）。`,
      );

    const refObjectName = tryGetScalar(valueNode, 'object', context);
    const refRoot =
      refObjectName !== undefined ? parseConditionObject(context, refObjectName, allowedRoots) : 'self';
    const refPropName = requireScalar(valueNode, 'prop', context);

    const unknownRefKeys = entriesInOrder(valueNode)
      .map(([key]) => key)
      .filter((key) => key !== 'object' && key !== 'prop');
    if (unknownRefKeys.length > 0)
      throw new YamlLoadError(`${context}.${op}: 未知のキー '${unknownRefKeys.join(', ')}' です。`);

    const valueRef = new PropertyPath(refRoot, loader.propertyNames.intern(refPropName));
    return ConditionNode.property(root, propertyGlobalId, op, undefined, valueRef);
  }

  return ConditionNode.property(
    root,
    propertyGlobalId,
    op,
    parseConditionValues(loader, context, op, valueNode),
  );
}

function parseConditionValues(
  loader: WorldCodexYamlLoader,
  context: string,
  op: ConditionOp,
  valueNode: YamlNode,
): number[] {
  const isList = op === 'in' || op === 'not_in';

  if (isList) {
    if (!isSeq(valueNode)) throw new YamlLoadError(`${context}: '${op}'の値は配列である必要があります。`);
    return (valueNode.items as YamlNode[]).map((n) =>
      parseConditionScalar(loader, context, asScalarText(n, context)),
    );
  }

  if (isSeq(valueNode) || isMap(valueNode))
    throw new YamlLoadError(`${context}: '${op}'の値はスカラー値である必要があります。`);

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
