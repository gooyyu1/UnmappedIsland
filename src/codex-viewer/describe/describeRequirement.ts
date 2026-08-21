import type { Requirement, Requirements } from '../../domain/Requirement';
import type { DefNames, DescriptionToken, DescriptionWriter } from './Description';
import { reasonRef, text } from './Description';
import { describeCondition } from './describeCondition';

/** 要件1つを書き表す。理由（14.6節）を宣言していれば添える。 */
export function describeRequirement(requirement: Requirement, names: DefNames): readonly DescriptionToken[] {
  const tokens = [...describeCondition(requirement.node, names)];
  if (requirement.reasonName !== undefined)
    tokens.push(text('（理由: '), reasonRef(requirement.reasonName), text('）'));
  return tokens;
}

/** 要件一式を宣言順に1件1行で書き出す。 */
export function describeRequirements(
  requirements: Requirements,
  names: DefNames,
  out: DescriptionWriter,
): void {
  for (const entry of requirements.declarations) out.write(...describeRequirement(entry, names));
}
