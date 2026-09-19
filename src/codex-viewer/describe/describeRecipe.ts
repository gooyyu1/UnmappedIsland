import type { RecipeDef, RecipeRequirementDef, RecipeStepDef } from '../../domain/RecipeDef';
import type { DefNames, DescriptionToken, DescriptionWriter } from './Description';
import { propertyPathRef, stageRef, text } from './Description';
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
    // **符号を裏返して「短くなる」と書く。** 宣言が持つのは負の分数（docs/world/Skills.md 7節）なので、
    // そのまま出すと読み手は「-15分かかる」と読む——向きが逆になる。
    //
    // 腕と段は語ではなく参照として出す（他の書き手と同じ形）。作り手が持つものなので起点はagent。
    out.write(
      text('手際: '),
      propertyPathRef(names.propertyName(deftness.skillGlobalId), 'agent'),
      text(' が '),
      stageRef(deftness.fromStage),
      text(` 以上なら各工程が${-deftness.minutes}分短くなる`),
    );

  for (const [index, step] of recipe.steps.entries()) describeRecipeStep(step, index + 1, names, out);
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
