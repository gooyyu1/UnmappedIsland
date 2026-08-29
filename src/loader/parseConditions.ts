import type { YAMLMap, YAMLSeq } from 'yaml';
import { isMap, isSeq } from 'yaml';
import {
  asMap,
  asScalarText,
  keysOf,
  requireKnownKeys,
  requireScalar,
  tryGetMap,
  tryGetNode,
  tryGetScalar,
  tryGetSeq,
} from './yamlMapping';
import type { YamlNode } from './yamlMapping';
import { YamlLoadError } from './YamlLoadError';
import { parseNumberOrSymbol, parseTypeMatchRule } from './parseCommon';
import type { WorldCodexYamlLoader } from './WorldCodexYamlLoader';
import type { ReferenceRoot, ReferenceScope } from '../domain/ReferenceRoot';
import { PropertyPath } from '../domain/ReferenceRoot';
import { ConditionNode } from '../domain/ConditionNode';
import type { ConditionOp } from '../domain/ConditionReader';
import { Requirement, Requirements } from '../domain/Requirement';

/**
 * conditions（14節）・passivesのゲート（8節）が共通で使う`subject`（主語）の参照キー。
 * worldはシングルトンインスタンスの実行時追跡が無いため未対応（ancestorで代替できる）。
 */
export function parseSubjectRoot(context: string, raw: string, scope: ReferenceScope): ReferenceRoot {
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
    case 'agent':
      root = 'agent';
      break;
    case 'instrument':
      root = 'instrument';
      break;
    case 'picked':
      root = 'picked';
      break;
    case 'child':
      root = 'child';
      break;
    case 'world':
      throw new YamlLoadError(
        `${context}: subject 'world' は未対応です（worldシングルトンインスタンスの実行時追跡が未実装のため）。`,
      );
    default:
      throw new YamlLoadError(`${context}: 未知のsubject '${raw}' です。`);
  }

  return requireResolvable(context, root, scope);
}

/** その場所で解決先を持たないrootを弾く。理由（何が無いか）は場所が答える。 */
export function requireResolvable(
  context: string,
  root: ReferenceRoot,
  scope: ReferenceScope,
): ReferenceRoot {
  const reason = scope.unresolvableReason(root);
  if (reason !== undefined)
    throw new YamlLoadError(`${context}: subject '${root}' は使えません（${reason}）。`);
  return root;
}

/** conditionsの要素にだけ書ける、満たさなかったときの理由の識別子（Requirement参照）。 */
const REASON_KEY = 'reason';

/**
 * 条件の並び（14節）。常にYAML配列（暗黙のall）。要素は葉か、入れ子のall/any/notのいずれか。
 * conditionsNodeがundefinedなら省略（常に真）。
 *
 * **contextはその配列自身を指す**（要素には添字だけを足す）。並びが書かれるキーは`conditions`とは
 * 限らない——`resists`（7.13節）も同じ形を共有するので、キー名は呼び出し側が答える。
 */
export function parseConditionsField(
  loader: WorldCodexYamlLoader,
  context: string,
  conditionsNode: YAMLSeq | undefined,
  scope: ReferenceScope,
): ConditionNode | undefined {
  if (conditionsNode === undefined) return undefined;

  const children: ConditionNode[] = [];
  for (const node of conditionsNode.items as YamlNode[])
    children.push(parseConditionNode(loader, `${context}[${children.length}]`, node, scope));

  return ConditionNode.all(children);
}

/**
 * actions/combinationsのconditions。要素ごとに`reason`（満たさなかったときにプレイヤーへ出す理由の
 * 識別子）を持てる点だけがparseConditionsFieldと違う。入れ子のall/any/notの中には書けない
 * （落ちた要件は配列の要素の単位で指すため、Requirement参照）。
 *
 * `fieldName`は、この並びが載っているキーの名前（エラーメッセージ用）。`conditions`以外の名前で
 * 同じ形を書ける場所（ルートキーの`crafting_conditions`、13.4節）のためだけに在る。
 */
export function parseRequirementsField(
  loader: WorldCodexYamlLoader,
  context: string,
  conditionsNode: YAMLSeq | undefined,
  scope: ReferenceScope,
  fieldName: string = 'conditions',
): Requirements | undefined {
  if (conditionsNode === undefined) return undefined;

  const entries: Requirement[] = [];
  for (const node of conditionsNode.items as YamlNode[]) {
    const entryContext = `${context}.${fieldName}[${entries.length}]`;
    const reasonName = tryGetScalar(asMap(node, entryContext), REASON_KEY, entryContext);
    entries.push(
      new Requirement(parseConditionNode(loader, entryContext, node, scope, REASON_KEY), reasonName),
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
  scope: ReferenceScope,
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
    return ConditionNode.all(parseCombinatorChildren(loader, context, 'all', allNode, scope));
  if (anyNode !== undefined)
    return ConditionNode.any(parseCombinatorChildren(loader, context, 'any', anyNode, scope));

  if (notNode !== undefined) {
    const unknown = keysOf(map).filter((key) => key !== 'not' && key !== extraKey);
    if (unknown.length > 0)
      throw new YamlLoadError(`${context}: 'not'は他のキーと同居できません（値: '${unknown.join(', ')}'）。`);

    return ConditionNode.not(parseConditionNode(loader, `${context}.not`, notNode, scope));
  }

  return parseConditionLeaf(loader, context, map, scope, extraKey);
}

function parseCombinatorChildren(
  loader: WorldCodexYamlLoader,
  context: string,
  key: string,
  seq: YAMLSeq,
  scope: ReferenceScope,
): ConditionNode[] {
  const children: ConditionNode[] = [];
  for (const node of seq.items as YamlNode[])
    children.push(parseConditionNode(loader, `${context}.${key}[${children.length}]`, node, scope));
  return children;
}

/** プロパティを主語にできる演算子キー。値が比較の相手になる。 */
const PROPERTY_OPS: readonly ConditionOp[] = ['lt', 'lte', 'gt', 'gte', 'eq', 'neq', 'in', 'not_in'];

/** 段の判定（6.4節）の演算子キー。値は段の名前。 */
const IN_STAGE_KEY = 'in_stage';

/** 型の判定（14.3節・14.4節）の演算子キー。値は`{tag}`か`{object}`（TypeMatchRule）。 */
const MATCHES_KEY = 'matches';

/**
 * 条件木の葉。**誰を見るかを決めるキー（subject）・主語を絞るキー（prop/slot）と、演算子キー
 * （値が比較の相手）**でできている。subjectは省略時self。
 *
 * | 主語 | 使える演算子キー |
 * | --- | --- |
 * | `prop`（subjectのそのプロパティの実効値） | `lt`/`lte`/`gt`/`gte`/`eq`/`neq`/`in`/`not_in`/`in_stage` |
 * | `slot`（subjectのそのスロットの中身） | `matches`（当てはまる中身が1つでもあるか） |
 * | 無し（subject自身） | `in_slot`（親の中での位置）/`matches`（subject自身が当てはまるか） |
 *
 * **量化は主語が決める。** 同じ`matches`でも、`slot`があれば中身に対する存在判定、無ければ
 * subject自身への判定になる（14.3節・14.4節）。
 *
 * **演算子キーは複数書ける（暗黙のAND）。** conditionsの配列と同じ規則で、範囲判定
 * （`{prop: x, gte: 100, lt: 200}`）のために同じ`prop`を2度書かなくて済む。
 *
 * 比較の相手はリテラルか{subject, prop}参照（10.2節と同じ二択）。参照はlt/lte/gt/gte/eq/neqのみで
 * 使える（in/not_inは複数値との比較のため噛み合わない）。
 */
function parseConditionLeaf(
  loader: WorldCodexYamlLoader,
  context: string,
  map: YAMLMap,
  scope: ReferenceScope,
  extraKey?: string,
): ConditionNode {
  const propName = tryGetScalar(map, 'prop', context);
  const slotName = tryGetScalar(map, 'slot', context);
  if (propName !== undefined && slotName !== undefined)
    throw new YamlLoadError(`${context}: 'prop'と'slot'は同時に指定できません（主語は1つです）。`);

  // propを伴わない葉（in_slot・slot・matches）は主語のオブジェクトそのものを見るので、
  // プロパティ名で祖先を探すancestorはそこでは解決先を持たない。
  const subjectName = tryGetScalar(map, 'subject', context);
  const leafScope = propName !== undefined ? scope : scope.withoutPropertyName;
  const root = subjectName !== undefined ? parseSubjectRoot(context, subjectName, leafScope) : 'self';

  /** 主語を絞るキーと、読み取った演算子キー。残ったキーは綴り間違いか、この主語では使えない演算子。 */
  const used = new Set<string>(['subject', 'prop', 'slot']);
  if (extraKey !== undefined) used.add(extraKey);
  const nodes: ConditionNode[] = [];

  if (propName !== undefined) {
    const propertyGlobalId = loader.propertyNames.intern(propName);

    for (const op of PROPERTY_OPS) {
      const valueNode = tryGetNode(map, op);
      if (valueNode === undefined) continue;
      used.add(op);
      nodes.push(parsePropertyComparison(loader, context, root, propertyGlobalId, op, valueNode, scope));
    }

    const stageName = tryGetScalar(map, IN_STAGE_KEY, context);
    if (stageName !== undefined) {
      used.add(IN_STAGE_KEY);
      nodes.push(ConditionNode.propertyStage(root, propertyGlobalId, stageName));
    }
  } else if (slotName !== undefined) {
    const matchNode = tryGetMap(map, MATCHES_KEY, context);
    if (matchNode === undefined)
      throw new YamlLoadError(`${context}: 'slot'を使うスロット中身判定には'${MATCHES_KEY}'が必須です。`);
    used.add(MATCHES_KEY);
    nodes.push(
      ConditionNode.slotContent(
        root,
        loader.slotNames.intern(slotName),
        parseTypeMatchRule(loader, `${context}.${MATCHES_KEY}`, matchNode),
      ),
    );
  } else {
    const inSlotName = tryGetScalar(map, 'in_slot', context);
    if (inSlotName !== undefined) {
      used.add('in_slot');
      nodes.push(ConditionNode.slotPosition(root, loader.slotNames.intern(inSlotName)));
    }

    const matchNode = tryGetMap(map, MATCHES_KEY, context);
    if (matchNode !== undefined) {
      used.add(MATCHES_KEY);
      nodes.push(
        ConditionNode.objectMatches(root, parseTypeMatchRule(loader, `${context}.${MATCHES_KEY}`, matchNode)),
      );
    }
  }

  requireKnownKeys(map, used, context, '（この主語では使えない演算子です）');

  if (nodes.length === 0)
    throw new YamlLoadError(`${context}: 演算子キーが1つもありません（比較する相手が決まりません）。`);

  return nodes.length === 1 ? nodes[0] : ConditionNode.all(nodes);
}

/** 演算子キー1つぶんのプロパティ比較。値はリテラル（in/not_inでは配列）か{subject, prop}参照。 */
function parsePropertyComparison(
  loader: WorldCodexYamlLoader,
  context: string,
  root: ReferenceRoot,
  propertyGlobalId: number,
  op: ConditionOp,
  valueNode: YamlNode,
  scope: ReferenceScope,
): ConditionNode {
  if (isMap(valueNode)) {
    if (op === 'in' || op === 'not_in')
      throw new YamlLoadError(
        `${context}: '${op}'は{subject, prop}参照と組み合わせられません（複数値との比較のため）。`,
      );

    const refSubjectName = tryGetScalar(valueNode, 'subject', context);
    const refRoot = refSubjectName !== undefined ? parseSubjectRoot(context, refSubjectName, scope) : 'self';
    const refPropName = requireScalar(valueNode, 'prop', context);

    requireKnownKeys(valueNode, ['subject', 'prop'], `${context}.${op}`);

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

  const [value] = parseNumberOrSymbol(loader, context, raw);
  return value;
}
