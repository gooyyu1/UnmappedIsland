import type { YAMLMap } from 'yaml';
import { asMap, entriesInOrder, tryGetMap, tryGetScalar, tryGetSeq } from './yamlMapping';
import { YamlLoadError } from './YamlLoadError';
import { parseTypeMatchRule, tryGetNode } from './parseCommon';
import { parseActiveEffectBody, parseWeight } from './parseActiveEffects';
import {
  ACTION_CONDITION_ROOTS,
  COMBINATION_CONDITION_ROOTS,
  parseRequirementsField,
} from './parseConditions';
import type { WorldCodexYamlLoader } from './WorldCodexYamlLoader';
import type { ActiveEffect } from '../domain/defs/ActiveEffect';
import type { Requirements } from '../domain/defs/Requirement';
import type { WeightSpec } from '../domain/defs/PickEffect';
import { ActionDef } from '../domain/defs/ActionDef';
import { CombinationDef } from '../domain/defs/CombinationDef';

/** actionエントリが持つ、効果以外の兄弟キー。 */
const ACTION_RESERVED_KEYS = ['showMenu', 'conditions', 'duration'] as const;

/** combinationエントリが持つ、効果以外の兄弟キー。 */
const COMBINATION_RESERVED_KEYS = ['with', 'conditions', 'duration'] as const;

/** actions・combinationsに共通する中身（InteractionDefが持つもの）。 */
interface InteractionBody {
  readonly requirements: Requirements | undefined;
  readonly effect: ActiveEffect;
  readonly duration: WeightSpec | undefined;
}

/**
 * 操作1つの中身を読む。actionsとcombinationsで違うのは、draggedを指せるか（＝条件・効果・durationの
 * 起点にdraggedを許すか）と、効果の兄弟キーとして無視する予約キーだけ。
 */
function parseInteractionBody(
  loader: WorldCodexYamlLoader,
  context: string,
  map: YAMLMap,
  allowDragged: boolean,
  reservedKeys: readonly string[],
): InteractionBody {
  const requirements = parseRequirementsField(
    loader,
    context,
    tryGetSeq(map, 'conditions', context),
    allowDragged ? COMBINATION_CONDITION_ROOTS : ACTION_CONDITION_ROOTS,
  );
  const effect = parseActiveEffectBody(loader, context, map, allowDragged, false, reservedKeys);

  // duration: 実行にかかるゲーム内時間（分）。省略時は時間を消費しない。
  const durationNode = tryGetNode(map, 'duration');
  const duration =
    durationNode !== undefined
      ? parseWeight(loader, `${context}.duration`, durationNode, allowDragged, 'duration')
      : undefined;

  return { requirements, effect, duration };
}

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

    const body = parseInteractionBody(loader, context, map, false, ACTION_RESERVED_KEYS);
    result.push(new ActionDef(name, 'always', body.requirements, body.effect, body.duration));
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

    const withNode = tryGetMap(map, 'with', context);
    if (withNode === undefined)
      throw new YamlLoadError(
        `${context}: 必須フィールド 'with' がありません（{tag: ...}か{object: ...}）。`,
      );

    const withRule = parseTypeMatchRule(loader, withNode, `${context}.with`);
    const body = parseInteractionBody(loader, context, map, true, COMBINATION_RESERVED_KEYS);
    result.push(new CombinationDef(name, withRule, body.requirements, body.effect, body.duration));
  }

  return result;
}
