import type { RecipeDef, RecipeRequirementDef, RecipeStepDef } from '../../domain/RecipeDef';
import type { DefNames, DescriptionToken, DescriptionWriter } from './Description';
import { propertyPathRef, text } from './Description';
import { describeEffect } from './describeEffect';
import { describeRequirements } from './describeRequirement';
import { typeMatchTokens } from './typeMatchTokens';

/** レシピ1つ（13節）を書き出す。 */
export function describeRecipe(recipe: RecipeDef, names: DefNames, out: DescriptionWriter): void {
  if (recipe.unlock !== undefined) {
    out.write(text('解放条件:'));
    out.indented(() => describeRequirements(recipe.unlock!.declarations, names, out));
  }

  const deftness = recipe.deftness;
  if (deftness !== undefined)
    out.write(
      text('手際（工程から引く）: '),
      propertyPathRef(names.propertyName(deftness.propertyGlobalId), deftness.root),
    );

  for (const [index, step] of recipe.steps.entries()) describeRecipeStep(step, index + 1, names, out);

  if (recipe.surplus !== undefined) {
    // 引くのは完成した瞬間の1回だけなので、工程の後ろへ置いて、効果の行と同じ形で出す（13.6節）。
    out.write(text('余分の卓（完成時に1回）:'));
    out.indented(() => describeEffect(recipe.surplus!, names, out));
  }
}

/**
 * 工程1つ（13.1節）を書き出す。stepNumberは1始まりの見出し用の番号。
 *
 * **出すのは工程が宣言した仕事の量**で、誰かが実際に費やす時間ではない（手際のぶん短くなる）。
 * 図鑑は誰が作るかを決めないので、ここで出せるのは腕によらない側だけ。
 */
function describeRecipeStep(
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
function recipeRequirementTokens(
  requirement: RecipeRequirementDef,
  names: DefNames,
): readonly DescriptionToken[] {
  return [
    text(requirement.consume ? '素材: ' : '道具: '),
    ...typeMatchTokens(requirement.match.reading, names),
    text(` ×${requirement.count}`),
  ];
}
