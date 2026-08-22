import type { YAMLMap } from 'yaml';
import {
  asMap,
  entriesInOrder,
  tryGetBool,
  tryGetMap,
  tryGetNode,
  tryGetScalar,
  tryGetSeq,
} from './yamlMapping';
import { YamlLoadError } from './YamlLoadError';
import { parseTypeMatchRule } from './parseCommon';
import { parseActiveEffectBody, parseWeight } from './parseActiveEffects';
import {
  ACTION_CONDITION_ROOTS,
  COMBINATION_CONDITION_ROOTS,
  parseRequirementsField,
} from './parseConditions';
import type { WorldCodexYamlLoader } from './WorldCodexYamlLoader';
import type { ActiveEffect } from '../domain/ActiveEffect';
import type { Requirements } from '../domain/Requirement';
import type { WeightSpec } from '../domain/WeightSpec';
import { ActionDef } from '../domain/ActionDef';
import { CombinationDef } from '../domain/CombinationDef';

/** actionエントリが持つ、効果以外の兄弟キー。 */
const ACTION_RESERVED_KEYS = ['showMenu', 'conditions', 'duration'] as const;

/** combinationエントリが持つ、効果以外の兄弟キー。 */
const COMBINATION_RESERVED_KEYS = ['with', 'conditions', 'duration', 'allow_multiple'] as const;

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

    const showMenuRaw = tryGetScalar(map, 'showMenu', context) ?? 'always';
    if (showMenuRaw !== 'always' && showMenuRaw !== 'never')
      throw new YamlLoadError(
        `${context}: showMenuは'always'か'never'のみ対応しています（値: '${showMenuRaw}'）。`,
      );

    const body = parseInteractionBody(loader, context, map, false, ACTION_RESERVED_KEYS);
    result.push(new ActionDef(name, showMenuRaw, body.requirements, body.effect, body.duration));
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

    const withRule = parseTypeMatchRule(loader, `${context}.with`, withNode);
    const body = parseInteractionBody(loader, context, map, true, COMBINATION_RESERVED_KEYS);
    const allowMultiple = tryGetBool(map, 'allow_multiple', context) ?? false;

    // 何個受け取れるかを答えられる形かは、宣言だけで決まる。許可したのに答えられない宣言は、
    // 黙って1枚ずつになるとプレイヤーには理由が分からないので、ここで弾く（GameElementDefinition.md 12.4節）。
    if (allowMultiple && body.effect.countableVessels() !== 1)
      throw new YamlLoadError(
        `${context}: allow_multipleを宣言できるのは、まとめた枚数の上限を決める器を1つだけ持つ効果です` +
          '（値域を持つプロパティへのtransferが1つ。pickを含むもの・器が複数あるものは数えられません）。',
      );

    result.push(
      new CombinationDef(name, withRule, body.requirements, body.effect, body.duration, allowMultiple),
    );
  }

  return result;
}
