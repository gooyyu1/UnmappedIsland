import type { YAMLMap } from 'yaml';
import type { YamlNode } from './yamlMapping';
import {
  asMap,
  entriesInOrder,
  requireKnownKeys,
  requireNumber,
  requireScalar,
  tryGetBool,
  tryGetInt,
  tryGetMap,
  tryGetScalar,
  tryGetSeq,
} from './yamlMapping';
import { YamlLoadError } from './YamlLoadError';
import { parseRequirementList } from './parseConditions';
import { withYamlContext, parseTypeMatchRule } from './parseCommon';
import type { WorldCodexYamlLoader } from './WorldCodexYamlLoader';
import { RecipeDef, RecipeDeftnessDef, RecipeRequirementDef, RecipeStepDef } from '../domain/RecipeDef';
import { ReferenceScope } from '../domain/ReferenceRoot';

const RECIPE_KEYS = ['steps', 'conditions', 'deftness'];
const STEP_KEYS = ['requires', 'duration'];
const DEFTNESS_KEYS = ['skill', 'from_stage', 'minutes'];
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
 * `steps.requires`とは別物。判定する時点では成果物のインスタンスがまだ無いので、そこを起点に辿る
 * 参照は解決先を持たない（何を書けるかは下のReferenceScope.acting.withoutSelfが決める）。
 *
 * **`deftness`（手際）は参照を持たない**——見るのは作り手の腕の段だけで、そこを読むのは工程を進める
 * 最中だから（RecipeDeftnessDef）。
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

    const unlock = parseRequirementList(
      loader,
      context,
      tryGetSeq(map, 'conditions', context),
      ReferenceScope.acting.withoutSelf,
      'conditions',
    );

    const deftnessNode = tryGetMap(map, 'deftness', context);
    const deftness =
      deftnessNode === undefined
        ? undefined
        : withYamlContext(`${context}.deftness`, () => {
            const deftnessContext = `${context}.deftness`;
            requireKnownKeys(deftnessNode, DEFTNESS_KEYS, deftnessContext);
            return new RecipeDeftnessDef(
              loader.propertyNames.intern(requireScalar(deftnessNode, 'skill', deftnessContext)),
              requireScalar(deftnessNode, 'from_stage', deftnessContext),
              requireNumber(deftnessNode, 'minutes', deftnessContext),
            );
          });

    result.push(new RecipeDef(name, steps, unlock, deftness));
  }

  return result;
}
