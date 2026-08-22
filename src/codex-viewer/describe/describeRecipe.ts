import type { RecipeDef, RecipeRequirementDef, RecipeStepDef } from '../../domain/RecipeDef';
import type { DefNames, DescriptionToken, DescriptionWriter } from './Description';
import { text } from './Description';
import { describeRequirements } from './describeRequirement';
import { typeMatchTokens } from './typeMatchTokens';

/** レシピ1つ（13節）を書き出す。 */
export function describeRecipe(recipe: RecipeDef, names: DefNames, out: DescriptionWriter): void {
  if (recipe.unlock !== undefined) {
    out.write(text('解放条件:'));
    out.indented(() => describeRequirements(recipe.unlock!.declarations, names, out));
  }
  for (const [index, step] of recipe.steps.entries()) describeRecipeStep(step, index + 1, names, out);
}

/** 工程1つ（13.1節）を書き出す。stepNumberは1始まりの見出し用の番号。 */
export function describeRecipeStep(
  step: RecipeStepDef,
  stepNumber: number,
  names: DefNames,
  out: DescriptionWriter,
): void {
  out.write(text(`工程${stepNumber}（${step.durationMinutes}分）:`));
  out.indented(() => {
    for (const requirement of step.requirements) out.write(...recipeRequirementTokens(requirement, names));
  });
}

/** 工程が要求する素材・道具1つを書き表す。 */
export function recipeRequirementTokens(
  requirement: RecipeRequirementDef,
  names: DefNames,
): readonly DescriptionToken[] {
  return [
    text(requirement.consume ? '素材: ' : '道具: '),
    ...typeMatchTokens(requirement.match.reading, names),
    text(` ×${requirement.count}`),
  ];
}
