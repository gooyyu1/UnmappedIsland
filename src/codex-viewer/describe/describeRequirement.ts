import type { Requirement } from '../../domain/Requirement';
import type { DefNames, DescriptionToken, DescriptionWriter } from './Description';
import { reasonRef, text } from './Description';
import { conditionTokens } from './conditionTokens';

/** 要件1つを書き表す。理由（14.6節）を宣言していれば添える。 */
function requirementTokens(requirement: Requirement, names: DefNames): readonly DescriptionToken[] {
  const tokens = [...conditionTokens(requirement.node, names)];
  if (requirement.reasonName !== undefined)
    tokens.push(text('（理由: '), reasonRef(requirement.reasonName), text('）'));
  return tokens;
}

/** 要件を宣言順に1件1行で書き出す。 */
export function describeRequirements(
  requirements: readonly Requirement[],
  names: DefNames,
  out: DescriptionWriter,
): void {
  for (const entry of requirements) out.write(...requirementTokens(entry, names));
}
