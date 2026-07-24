import type { YAMLMap, YAMLSeq } from 'yaml';
import { isMap, isScalar } from 'yaml';
import { asMap, asScalarText, entriesInOrder, requireScalar, tryGetScalar, tryGetSeq } from './yamlMapping';
import type { YamlNode } from './yamlMapping';
import { YamlLoadError } from './YamlLoadError';
import { hasActiveContent, tryGetNode } from './parseCommon';
import { parseActiveEffectBody } from './parseActiveEffects';
import {
  ACTION_CONDITION_ROOTS,
  COMBINATION_CONDITION_ROOTS,
  parseConditionObject,
  parseConditionsField,
} from './parseConditions';
import type { WorldCodexYamlLoader } from './WorldCodexYamlLoader';
import { PropertyPath } from '../domain/defs/ReferenceRoot';
import type { ActiveEffect } from '../domain/defs/ActiveEffect';
import { PickCandidateDef, PickEffect, WeightSpec } from '../domain/defs/PickEffect';
import { ActionDef } from '../domain/defs/ActionDef';
import { CombinationDef } from '../domain/defs/CombinationDef';

function parseWeight(
  loader: WorldCodexYamlLoader,
  context: string,
  node: YamlNode,
  allowDragged: boolean,
  fieldName = 'weight',
): WeightSpec {
  if (isScalar(node)) {
    const raw = asScalarText(node, context);
    const literal = Number(raw);
    if (raw.trim() === '' || Number.isNaN(literal))
      throw new YamlLoadError(`${context}: ${fieldName}は数値である必要があります（値: '${raw}'）。`);
    return WeightSpec.fromLiteral(literal);
  }

  if (isMap(node)) {
    const allowedRoots = allowDragged ? COMBINATION_CONDITION_ROOTS : ACTION_CONDITION_ROOTS;
    const objectName = tryGetScalar(node, 'object', context);
    const root = objectName !== undefined ? parseConditionObject(context, objectName, allowedRoots) : 'self';
    const propName = requireScalar(node, 'prop', context);

    const unknownKeys = entriesInOrder(node)
      .map(([key]) => key)
      .filter((key) => key !== 'object' && key !== 'prop');
    if (unknownKeys.length > 0)
      throw new YamlLoadError(`${context}: 未知のキー '${unknownKeys.join(', ')}' です。`);

    return WeightSpec.fromPath(new PropertyPath(root, loader.propertyNames.intern(propName)));
  }

  throw new YamlLoadError(
    `${context}: ${fieldName}はリテラル数値か{object, prop}のいずれかである必要があります。`,
  );
}

/** pick候補が持つ、weight/pick以外の兄弟キー（set/add/destroy/spawn）。 */
const PICK_CANDIDATE_RESERVED_KEYS = ['weight', 'pick'] as const;

export function parsePickList(
  loader: WorldCodexYamlLoader,
  context: string,
  pickNode: YAMLSeq,
  allowDragged: boolean,
  selfOnly = false,
): PickCandidateDef[] {
  const result: PickCandidateDef[] = [];

  for (const node of pickNode.items as YamlNode[]) {
    const map = asMap(node, context);
    const candidateContext = `${context}.pick[${result.length}]`;

    const weightNode = tryGetNode(map, 'weight');
    if (weightNode === undefined) throw new YamlLoadError(`${candidateContext}: 'weight'は必須です。`);

    const weight = parseWeight(loader, candidateContext, weightNode, allowDragged);

    const hasActive = hasActiveContent(map);
    const nestedPick = tryGetSeq(map, 'pick', candidateContext);

    if (hasActive && nestedPick !== undefined)
      throw new YamlLoadError(`${candidateContext}: set/add/destroy/spawnとpickは同時に指定できません。`);
    if (!hasActive && nestedPick === undefined)
      throw new YamlLoadError(`${candidateContext}: set/add/destroy/spawnのいずれか、またはpickが必要です。`);

    // selfOnly（on_min等のrangeイベント内のpick）は、ネストした候補にもそのまま引き継ぐ。
    // nestedPickは、直前の2つのチェックにより、hasActiveがfalseの場合は必ず定義されている。
    const effect: ActiveEffect = hasActive
      ? parseActiveEffectBody(
          loader,
          candidateContext,
          map,
          allowDragged,
          selfOnly,
          PICK_CANDIDATE_RESERVED_KEYS,
        )
      : new PickEffect(parsePickList(loader, candidateContext, nestedPick!, allowDragged, selfOnly));

    result.push(new PickCandidateDef(weight, effect));
  }

  return result;
}

/** active（set/add/destroy/spawn）またはpickを単一のActiveEffectとして返す。
 * どちらも無ければundefined（条件成立時に何も起きない）。 */
function parseEffect(
  loader: WorldCodexYamlLoader,
  context: string,
  map: YAMLMap,
  allowDragged: boolean,
  reservedKeys: readonly string[],
): ActiveEffect | undefined {
  const hasActive = hasActiveContent(map);
  const pickList = tryGetSeq(map, 'pick', context);
  if (hasActive && pickList !== undefined)
    throw new YamlLoadError(`${context}: set/add/destroy/spawnとpickは同時に指定できません。`);

  if (hasActive) return parseActiveEffectBody(loader, context, map, allowDragged, false, reservedKeys);
  if (pickList !== undefined) return new PickEffect(parsePickList(loader, context, pickList, allowDragged));
  return undefined;
}

/** actionエントリが持つ、showMenu/conditions/duration/pick以外の兄弟キー（set/add/destroy/spawn）。 */
const ACTION_RESERVED_KEYS = ['showMenu', 'conditions', 'duration', 'pick'] as const;

/** combinationエントリが持つ、with/conditions/pick以外の兄弟キー（set/add/destroy/spawn）。 */
const COMBINATION_RESERVED_KEYS = ['with', 'conditions', 'pick'] as const;

/** actions_map（11節）を読む。trait合成済みのノードを渡すこと。
 * dragged対象はメニュー型操作では意味を持たないため不可。 */
export function parseActions(
  loader: WorldCodexYamlLoader,
  objectDefName: string,
  actionsNode: YAMLMap | undefined,
): ActionDef[] {
  const result: ActionDef[] = [];
  if (actionsNode === undefined) return result;

  for (const [name, node] of entriesInOrder(actionsNode)) {
    const context = `'${objectDefName}'.actions.'${name}'`;
    const map = asMap(node, context);

    const showMenuRaw = tryGetScalar(map, 'showMenu', context);
    if (showMenuRaw !== undefined && showMenuRaw !== 'always')
      throw new YamlLoadError(
        `${context}: showMenuは現時点で'always'のみ対応しています（値: '${showMenuRaw}'）。`,
      );

    const conditions = parseConditionsField(
      loader,
      context,
      tryGetSeq(map, 'conditions', context),
      ACTION_CONDITION_ROOTS,
    );
    const effect = parseEffect(loader, context, map, false, ACTION_RESERVED_KEYS);

    // duration: 実行にかかるゲーム内時間（分）。省略時は時間を消費しない。
    const durationNode = tryGetNode(map, 'duration');
    const duration =
      durationNode !== undefined
        ? parseWeight(loader, `${context}.duration`, durationNode, false, 'duration')
        : undefined;

    result.push(new ActionDef(name, 'always', conditions, effect, duration));
  }

  return result;
}

/** combinations_map（12節）を読む。trait合成済みのノードを渡すこと。dragged対象を使える。 */
export function parseCombinations(
  loader: WorldCodexYamlLoader,
  objectDefName: string,
  combinationsNode: YAMLMap | undefined,
): CombinationDef[] {
  const result: CombinationDef[] = [];
  if (combinationsNode === undefined) return result;

  for (const [name, node] of entriesInOrder(combinationsNode)) {
    const context = `'${objectDefName}'.combinations.'${name}'`;
    const map = asMap(node, context);

    const withId = loader.tagNames.intern(requireScalar(map, 'with', context));
    const conditions = parseConditionsField(
      loader,
      context,
      tryGetSeq(map, 'conditions', context),
      COMBINATION_CONDITION_ROOTS,
    );
    const effect = parseEffect(loader, context, map, true, COMBINATION_RESERVED_KEYS);

    result.push(new CombinationDef(name, withId, conditions, effect));
  }

  return result;
}
