import type { YAMLMap } from 'yaml';
import type { YamlNode } from './yamlMapping';
import {
  asMap,
  entriesInOrder,
  requireKnownKeys,
  tryGetBool,
  tryGetInt,
  tryGetNumber,
  tryGetScalar,
  tryGetSeq,
} from './yamlMapping';
import { YamlLoadError } from './YamlLoadError';
import { RECIPE_CONDITION_ROOTS, parseRequirementsField } from './parseConditions';
import { parseTypeMatchRule } from './parseCommon';
import type { WorldCodexYamlLoader } from './WorldCodexYamlLoader';
import { RecipeDef, RecipeRequirementDef, RecipeStepDef } from '../domain/RecipeDef';

const RECIPE_KEYS = ['icon', 'steps', 'conditions'];
const STEP_KEYS = ['requires', 'duration'];
const REQUIREMENT_KEYS = ['object', 'tag', 'count', 'consume'];

function parseRequirement(
  loader: WorldCodexYamlLoader,
  context: string,
  node: YamlNode,
): RecipeRequirementDef {
  const map = asMap(node, context);
  requireKnownKeys(context, map, REQUIREMENT_KEYS);

  const count = tryGetInt(map, 'count', context) ?? 1;
  if (count < 1) throw new YamlLoadError(`${context}: countは1以上である必要があります（値: ${count}）。`);

  if (tryGetScalar(map, 'consume', context) === undefined)
    throw new YamlLoadError(`${context}: consumeは省略できません（素材か道具かは既定値を置けないため）。`);

  return new RecipeRequirementDef(
    parseTypeMatchRule(loader, context, map),
    count,
    tryGetBool(map, 'consume', context, true),
  );
}

function parseStep(loader: WorldCodexYamlLoader, context: string, node: YamlNode): RecipeStepDef {
  const map = asMap(node, context);
  requireKnownKeys(context, map, STEP_KEYS);

  const requiresNode = tryGetSeq(map, 'requires', context);
  if (requiresNode === undefined || requiresNode.items.length === 0)
    throw new YamlLoadError(`${context}: requiresは1件以上必要です。`);

  const requirements = (requiresNode.items as YamlNode[]).map((item, index) =>
    parseRequirement(loader, `${context}.requires[${index}]`, item),
  );

  const duration = tryGetNumber(map, 'duration', context);
  if (duration === undefined || duration <= 0)
    throw new YamlLoadError(`${context}: durationは正の数である必要があります。`);

  return new RecipeStepDef(requirements, duration);
}

/**
 * recipes_map（13節）を読む。trait合成の対象ではないため、object_def自身の宣言だけを渡す。
 *
 * `conditions`（SkillSystem.md 4節）は**このレシピを知っているか**の判定で、素材の充足を見る
 * `steps.requires`とは別物。actorしか参照できない（RECIPE_CONDITION_ROOTS参照）。
 */
export function parseRecipes(
  loader: WorldCodexYamlLoader,
  objectDefName: string,
  recipesNode: YAMLMap | undefined,
): RecipeDef[] {
  const result: RecipeDef[] = [];
  if (recipesNode === undefined) return result;

  for (const [name, node] of entriesInOrder(recipesNode)) {
    const context = `'${objectDefName}'.recipes.'${name}'`;
    const map = asMap(node, context);
    requireKnownKeys(context, map, RECIPE_KEYS);

    const stepsNode = tryGetSeq(map, 'steps', context);
    if (stepsNode === undefined || stepsNode.items.length === 0)
      throw new YamlLoadError(`${context}: stepsは1件以上必要です。`);

    const steps = (stepsNode.items as YamlNode[]).map((item, index) =>
      parseStep(loader, `${context}.steps[${index}]`, item),
    );

    const unlock = parseRequirementsField(
      loader,
      context,
      tryGetSeq(map, 'conditions', context),
      RECIPE_CONDITION_ROOTS,
    );

    result.push(new RecipeDef(name, steps, tryGetScalar(map, 'icon', context), unlock));
  }

  return result;
}
