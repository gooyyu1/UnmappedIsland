import { describe, expect, it } from 'vitest';
import { craftingStepsOf } from '../../src/analysis/craftingSteps';
import { WorldSession } from '../../src/domain/WorldSession';
import { World } from '../../src/domain/wrappers/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { AGENT_YAML, createAgent } from '../support/agent';
import { WORLD_TIME_YAML } from '../support/worldYaml';

/**
 * 同じ宣言を、**世界が在る場面の答え手**（ReferenceContext）と**定義しか無い場面の答え手**（解析）の
 * 両方に読ませる。問いは1つ（ReferenceValueResolver）なので、どちらへ訊いても同じ分数が返る
 * ——端数の落とし方も、宣言が無いときの0も、宣言を持つ側（InteractionDef.minutesFor）だけが決める。
 *
 * **この一致が破れるのは、どちらかが読み方を自分で持ち直したときだけ。**
 */
const YAML = `
object_defs:
  shoreline:
    tags: [location]
    props:
      # 端数のある分数。どちらの答え手も同じ落とし方をすることを、この端数が見分ける。
      comb_minutes: {value: 12.7}
      combed: {value: 0}
    interactions:
      comb:
        trigger: menu
        duration: {prop: comb_minutes}
        add: {self: {combed: 1}}
      # 時間を宣言しない操作。「宣言が無ければ0」も、同じ1箇所の読み方。
      glance:
        trigger: menu
        add: {self: {combed: 1}}
`;

const codex = new WorldCodexYamlLoader()
  .load('world.yaml', WORLD_TIME_YAML)
  .load('shore.yaml', YAML)
  .load('agent.yaml', AGENT_YAML)
  .buildAndReset();

/** 世界に置いた渚へ、実行時の文脈で分数を訊く（Interaction.executionMinutes）。 */
function runtimeMinutesOf(interactionName: string): number {
  const session = new WorldSession(codex);
  const worldInstance = session.createObject(codex.objectNames.getId('world'));
  session.adoptWorld(new World(worldInstance));

  const shoreline = session.createObject(codex.objectNames.getId('shoreline'));
  shoreline.moveToSlotOrRejection(worldInstance.getSlot(codex.slotNames.getId('locations')));
  return shoreline.tryGetAction(interactionName, createAgent(session))!.executionMinutes();
}

/** 同じ操作へ、定義だけの解決器で分数を訊く（CraftingStep.laborMinutes）。 */
function staticMinutesOf(interactionName: string): number {
  const steps = craftingStepsOf(codex, codex.objects.get(codex.objectNames.getId('shoreline')));
  return steps.find((step) => step.name === interactionName)!.laborMinutes;
}

describe('宣言された分数は、どちらの答え手に訊いても同じ', () => {
  it('端数は、どちらの答え手でも切り捨てられる', () => {
    expect(runtimeMinutesOf('comb'), '12.7分の宣言').toBe(12);
    expect(staticMinutesOf('comb'), '定義だけの解決器も同じ端数の落とし方').toBe(12);
  });

  it('時間を宣言していない操作は、どちらの答え手でも0', () => {
    expect(runtimeMinutesOf('glance')).toBe(0);
    expect(staticMinutesOf('glance')).toBe(0);
  });
});
