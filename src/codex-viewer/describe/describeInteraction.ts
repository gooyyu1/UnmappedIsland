import type { InteractionTrigger } from '../../domain/InteractionTrigger';
import type { DefNames, DescriptionWriter } from './Description';
import { text } from './Description';
import { describeEffect, declaredNumberTokens } from './describeEffect';
import { describePassive } from './describePassive';
import { describeRequirements } from './describeRequirement';
import { typeMatchTokens } from './typeMatchTokens';

/**
 * 操作1つ（11節・12節）を書き出す。きっかけ（メニュー/相手のタグ）→要件→告知→所要時間→効果の順で、
 * プレイヤーがカードを触ってから起こることの順番に並べる。
 */
export function describeInteraction(
  trigger: InteractionTrigger,
  names: DefNames,
  out: DescriptionWriter,
): void {
  const interaction = trigger.interaction;
  const reading = trigger.reading;
  if (reading.kind === 'drag')
    out.write(
      text('trigger: '),
      ...typeMatchTokens(reading.with, names),
      text(`のカードのドロップ${reading.allowMultiple ? '（まとめて可）' : ''}`),
    );
  else out.write(text(`trigger: ${reading.kind}`));

  const requirements = interaction.requirementDeclarations;
  if (requirements.length > 0) {
    out.write(text('conditions:'));
    out.indented(() => describeRequirements(requirements, names, out));
  }

  const announcements = interaction.announcements;
  if (announcements.length > 0) {
    // 効果と同じ`signal ...`の行になるので、時間を進める前に告げるものだと見出しで断る（11.6節）。
    out.write(text('announce:'));
    out.indented(() => {
      for (const announcement of announcements) describeEffect(announcement, names, out);
    });
  }

  const duration = interaction.durationReading;
  if (duration !== undefined)
    out.write(text('所要時間: '), ...declaredNumberTokens(duration, names), text('分'));

  const passives = interaction.passiveDeclarations;
  if (passives.length > 0) {
    // 物のpassivesと同じ行になるので、経過している間だけのものだと見出しで断る（11.7節）。
    out.write(text('passives（経過の間、tick毎）:'));
    out.indented(() => {
      for (const passive of passives) describePassive(passive, names, out);
    });
  }

  describeEffect(interaction, names, out);
}
