import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { samplePackPath } from '../support/samplePack';
import type { ActionDef } from '../../src/domain/ActionDef';
import { DescriptionWriter } from '../../src/domain/Description';
import {
  loadYamlDirectory,
  loadYamlFile,
  SAMPLE_CHARACTER,
  WORLD_CODEX_DIR,
} from '../support/worldCodexFiles';

/**
 * サンプルアセットパックのpotions.yamlの薬を、実ファイルの定義だけで検証する。効き目はどちらも
 * blood一本なので、見るのは「幅を振り切るか」だけ——満タンから飲んでも下限を割り、空から飲んでも
 * 満タンに届く。パックの定義も同梱ぶんと同じローダーで読めることを、ここが押さえている。
 */
describe('サンプルアセットパックの薬', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    // patchの当たる先（locations.yaml）が要るので、同梱ぶんを丸ごと読んだうえでパックを重ねる。
    const loader = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR);
    loadYamlFile(loader, samplePackPath('world-codex/potions.yaml'));
    codex = loader.build();
  });

  /** 1つのアクションの書き出し（describe）。探索候補に載ったかを字面で確かめる。 */
  function describeAction(objectName: string, actionName: string): string {
    const def = codex.objects.get(codex.objectNames.getId(objectName));
    const action = def.actions.find((candidate) => candidate.name === actionName);
    const writer = new DescriptionWriter();
    (action as ActionDef).describe(codex, writer);
    return writer.toPlainText();
  }

  it('回復ポーションが砂浜の探索候補に載る（patchで足している）', () => {
    expect(describeAction('sandy_beach', 'explore')).toContain('healing_potion');
  });

  it('毒薬はジャングルの探索候補に載る', () => {
    expect(describeAction('jungle', 'explore')).toContain('poison_potion');
  });

  it('patchを当てても、同梱の候補は残る', () => {
    expect(describeAction('sandy_beach', 'explore')).toContain('palm_tree');
  });

  function spawn(objectName: string, instanceId: number): WorldObject {
    return new WorldObject(
      instanceId,
      codex.objects.get(codex.objectNames.getId(objectName)),
      new WorldSession(codex),
    );
  }

  it('毒薬をあおると、満タンから飲んでも血が下限を割って失血死する', () => {
    const character = spawn(SAMPLE_CHARACTER, 1);
    const potion = spawn('poison_potion', 2);
    const bloodId = codex.propertyNames.getId('blood');

    expect(potion.tryGetAction('drink', character)?.tryExecute() === true).toBe(true);

    // bloodのon_minが既定のクランプを置き換えるので、0を割った値がそのまま残る
    // （VitalsSystem.md 3節・6節）。死因はその段が名乗る。
    expect(character.tryGetProperty(bloodId)?.number ?? 0, '飲んだ量がそのまま引かれる').toBe(5000 - 9999);
    expect(character.tryGetProperty(bloodId)?.isInStage('exsanguinated') ?? false, '失血死の段').toBe(true);
  });

  it('回復ポーションをあおると、空から飲んでも血が満タンに戻る', () => {
    const character = spawn(SAMPLE_CHARACTER, 1);
    const potion = spawn('healing_potion', 2);
    const bloodId = codex.propertyNames.getId('blood');
    character.getProperty(bloodId).init(0);

    expect(potion.tryGetAction('drink', character)?.tryExecute() === true).toBe(true);

    expect(character.tryGetProperty(bloodId)?.number ?? 0).toBe(5000);
  });

  it.each(['poison_potion', 'healing_potion'])('%sは飲めば手元から消える', (objectName) => {
    const character = spawn(SAMPLE_CHARACTER, 1);
    const handId = codex.slotNames.getId('hand');
    const potion = spawn(objectName, 2);
    expect(potion.moveToSlot(character, handId)).toBeUndefined();

    expect(potion.tryGetAction('drink', character)?.tryExecute() === true).toBe(true);

    expect(character.tryGetSlot(handId)?.contents).toEqual([]);
  });
});
