import type { InteractionDef } from '../../domain/InteractionDef';
import type { DefNames, DescriptionWriter } from './Description';
import { text } from './Description';
import { describeEffect, weightTokens } from './describeEffect';
import { describeRequirement } from './describeRequirement';
import { describeTypeMatch } from './describeTypeMatch';

/**
 * 操作1つ（11節・12節）を書き出す。きっかけ（メニュー/相手のタグ）→要件→所要時間→効果の順で、
 * プレイヤーがカードを触ってから起こることの順番に並べる。
 */
export function describeInteraction(
  interaction: InteractionDef,
  names: DefNames,
  out: DescriptionWriter,
): void {
  const trigger = interaction.triggerReading;
  if (trigger.kind === 'menu') out.write(text(`show_menu: ${trigger.showMenu}`));
  else out.write(text('with: '), ...describeTypeMatch(trigger.with, names), text('のカードのドロップ'));

  const requirements = interaction.requirementDeclarations;
  if (requirements.length > 0) {
    out.write(text('conditions:'));
    out.indented(() => {
      for (const entry of requirements) out.write(...describeRequirement(entry, names));
    });
  }

  const duration = interaction.durationReading;
  if (duration !== undefined) out.write(text('所要時間: '), ...weightTokens(duration, names), text('分'));

  describeEffect(interaction, names, out);
}
