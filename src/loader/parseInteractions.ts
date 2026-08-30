import type { YAMLMap } from 'yaml';
import { isMap, isScalar } from 'yaml';
import { asMap, entriesInOrder, keysOf, tryGetBool, tryGetMap, tryGetNode, tryGetSeq } from './yamlMapping';
import { YamlLoadError } from './YamlLoadError';
import { parseTypeMatchRule } from './parseCommon';
import { parseActiveEffectBody, parseWeight } from './parseActiveEffects';
import { parseRequirementsField } from './parseConditions';
import type { WorldCodexYamlLoader } from './WorldCodexYamlLoader';
import { InteractionDef } from '../domain/InteractionDef';
import type { InteractionTrigger } from '../domain/InteractionTrigger';
import { DragTrigger, MenuTrigger, TickTrigger } from '../domain/InteractionTrigger';
import { ReferenceScope } from '../domain/ReferenceRoot';

/** 操作のエントリが持つ、効果以外の兄弟キー。 */
const RESERVED_KEYS = ['trigger', 'conditions', 'duration'] as const;

/** `trigger`のマップ形（ドラッグ）が持てるキー。 */
const DRAG_KEYS = ['drag', 'allow_multiple'] as const;

/**
 * interactions_map（11節・12節）を読む。trait合成済みのノードを渡すこと。
 *
 * **きっかけ（`trigger`）が操作の種類を決める。** 相手を重ねて起こす操作（`drag`）だけがinstrumentを
 * 指せるので、条件・効果・durationの起点に何を許すかもきっかけから決まる。
 */
export function parseInteractions(
  loader: WorldCodexYamlLoader,
  objectDefName: string,
  interactionsNode: YAMLMap | undefined,
): InteractionTrigger[] {
  const result: InteractionTrigger[] = [];
  if (interactionsNode === undefined) return result;

  for (const [name, node] of entriesInOrder(interactionsNode)) {
    const context = `'${objectDefName}'.interactions.'${name}'`;
    const map = asMap(node, context);
    result.push(parseInteraction(loader, context, name, map));
  }

  return result;
}

function parseInteraction(
  loader: WorldCodexYamlLoader,
  context: string,
  name: string,
  map: YAMLMap,
): InteractionTrigger {
  const triggerNode = tryGetNode(map, 'trigger');
  if (triggerNode === undefined)
    throw new YamlLoadError(`${context}: 必須フィールド 'trigger' がありません（menu・tick・{drag: ...}）。`);

  const drag = isMap(triggerNode) ? parseDragTrigger(loader, context, triggerNode) : undefined;
  const scope = drag !== undefined ? ReferenceScope.acting.withInstrument : ReferenceScope.acting;

  const requirements = parseRequirementsField(
    loader,
    context,
    tryGetSeq(map, 'conditions', context),
    scope,
    'conditions',
  );
  const effect = parseActiveEffectBody(loader, context, map, scope, RESERVED_KEYS);

  // duration: 実行にかかるゲーム内時間（分）。省略時は時間を消費しない。
  const durationNode = tryGetNode(map, 'duration');
  const duration =
    durationNode !== undefined
      ? parseWeight(loader, `${context}.duration`, durationNode, scope, 'duration')
      : undefined;

  const interaction = new InteractionDef(name, requirements, effect, duration);

  if (drag !== undefined) {
    // 何個受け取れるかを答えられる形かは、宣言だけで決まる。許可したのに答えられない宣言は、
    // 黙って1枚ずつになるとプレイヤーには理由が分からないので、ここで弾く（12.4節）。
    if (drag.allowMultiple && effect.repeatLimitingVesselCount() !== 1)
      throw new YamlLoadError(
        `${context}: allow_multipleを宣言できるのは、まとめた枚数の上限を決める器を1つだけ持つ効果です` +
          '（値域を持つプロパティへのtransferが1つ。pickを含むもの・器が複数あるものは数えられません）。',
      );

    return new DragTrigger(interaction, drag.with, drag.allowMultiple);
  }

  const raw = isScalar(triggerNode) ? String(triggerNode.value) : undefined;
  if (raw === 'menu') return new MenuTrigger(interaction);
  if (raw === 'tick') return new TickTrigger(interaction);
  throw new YamlLoadError(
    `${context}: triggerは'menu'・'tick'か、{drag: ...}のみ対応しています（値: '${raw ?? '?'}'）。`,
  );
}

/**
 * `trigger: {drag: {tag: ...}, allow_multiple: true}`。**相手の型もまとめて重ねてよいかも、
 * きっかけの中に置く**——ドラッグ以外の操作では意味を持たないので、外に出すと「書けてしまうが
 * 効かないキー」ができる。
 */
function parseDragTrigger(
  loader: WorldCodexYamlLoader,
  context: string,
  triggerNode: YAMLMap,
): { readonly with: ReturnType<typeof parseTypeMatchRule>; readonly allowMultiple: boolean } | undefined {
  const triggerContext = `${context}.trigger`;
  const withNode = tryGetMap(triggerNode, 'drag', triggerContext);
  if (withNode === undefined)
    throw new YamlLoadError(
      `${triggerContext}: マップで書くきっかけは{drag: ...}だけです（相手は{tag: ...}か{object: ...}）。`,
    );

  const unknown = keysOf(triggerNode).filter((key) => !DRAG_KEYS.includes(key as (typeof DRAG_KEYS)[number]));
  if (unknown.length > 0)
    throw new YamlLoadError(`${triggerContext}: 未知のキーがあります（'${unknown.join(', ')}'）。`);

  return {
    with: parseTypeMatchRule(loader, `${triggerContext}.drag`, withNode),
    allowMultiple: tryGetBool(triggerNode, 'allow_multiple', triggerContext) ?? false,
  };
}
