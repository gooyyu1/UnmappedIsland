import type { YAMLMap } from 'yaml';
import type { YamlNode } from './yamlMapping';
import {
  asMap,
  entriesInOrder,
  requireKnownKeys,
  requireNumber,
  tryGetBool,
  tryGetInt,
  tryGetScalar,
  tryGetSeq,
} from './yamlMapping';
import { YamlLoadError } from './YamlLoadError';
import { parseRequirementsField } from './parseConditions';
import { withYamlContext, parseTypeMatchRule } from './parseCommon';
import type { WorldCodexYamlLoader } from './WorldCodexYamlLoader';
import { RecipeDef, RecipeRequirementDef, RecipeStepDef } from '../domain/RecipeDef';
import { ReferenceScope } from '../domain/ReferenceRoot';

const RECIPE_KEYS = ['icon', 'steps', 'conditions'];
const STEP_KEYS = ['requires', 'duration'];
const REQUIREMENT_KEYS = ['object', 'tag', 'count', 'consume'];

function parseRequirement(
  loader: WorldCodexYamlLoader,
  context: string,
  node: YamlNode,
): RecipeRequirementDef {
  const map = asMap(node, context);
  requireKnownKeys(map, REQUIREMENT_KEYS, context);

  if (tryGetScalar(map, 'consume', context) === undefined)
    throw new YamlLoadError(`${context}: consumeは省略できません（素材か道具かは既定値を置けないため）。`);

  return withYamlContext(
    context,
    () =>
      new RecipeRequirementDef(
        parseTypeMatchRule(loader, context, map),
        tryGetInt(map, 'count', context) ?? 1,
        tryGetBool(map, 'consume', context) ?? true,
      ),
  );
}

function parseStep(loader: WorldCodexYamlLoader, context: string, node: YamlNode): RecipeStepDef {
  const map = asMap(node, context);
  requireKnownKeys(map, STEP_KEYS, context);

  const requirements = ((tryGetSeq(map, 'requires', context)?.items ?? []) as YamlNode[]).map((item, index) =>
    parseRequirement(loader, `${context}.requires[${index}]`, item),
  );

  return withYamlContext(
    context,
    () => new RecipeStepDef(requirements, requireNumber(map, 'duration', context)),
  );
}

/**
 * recipes_map（13節）を読む。trait合成の対象ではないため、object_def自身の宣言だけを渡す。
 *
 * `conditions`（SkillSystem.md 4節）は**このレシピを知っているか**の判定で、素材の充足を見る
 * `steps.requires`とは別物。agentしか参照できない（ReferenceScope.recipeUnlock参照）。
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
    requireKnownKeys(map, RECIPE_KEYS, context);

    const steps = ((tryGetSeq(map, 'steps', context)?.items ?? []) as YamlNode[]).map((item, index) =>
      parseStep(loader, `${context}.steps[${index}]`, item),
    );

    const unlock = parseRequirementsField(
      loader,
      context,
      tryGetSeq(map, 'conditions', context),
      ReferenceScope.recipeUnlock,
    );

    result.push(new RecipeDef(name, steps, tryGetScalar(map, 'icon', context), unlock));
  }

  return result;
}
