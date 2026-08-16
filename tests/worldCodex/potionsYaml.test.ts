import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import {
  loadYamlDirectory,
  loadYamlFile,
  SAMPLE_CHARACTER,
  worldCodexPath,
} from '../support/worldCodexFiles';

/**
 * potions.yamlの薬を、実ファイルの定義だけで検証する。効き目はどちらもblood一本なので、
 * 見るのは「幅を振り切るか」だけ——満タンから飲んでも下限を割り、空から飲んでも満タンに届く。
 */
describe('potions.yamlの薬', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    const loader = new WorldCodexYamlLoader();
    loadYamlFile(loader, worldCodexPath('core.yaml'));
    loadYamlDirectory(loader, worldCodexPath('characters'));
    loadYamlFile(loader, worldCodexPath('potions.yaml'));
    codex = loader.build();
  });

  function spawn(objectName: string, instanceId: number): WorldObject {
    return new WorldObject(
      instanceId,
      codex.objects.get(codex.objectNames.getId(objectName)),
      new WorldSession(codex),
    );
  }

  it('毒薬をあおると、満タンから飲んでも血が下限を割って失血死する', () => {
    const session = new WorldSession(codex);
    const character = spawn(SAMPLE_CHARACTER, 1);
    const potion = spawn('poison_potion', 2);
    const bloodId = codex.propertyNames.getId('blood');

    expect(potion.tryExecuteAction('drink', character, session)).toBe(true);

    // bloodのon_shortfallが既定のクランプを置き換えるので、0を割った値がそのまま残る
    // （VitalsSystem.md 3節・6節）。死因はその段が名乗る。
    expect(character.getNumber(bloodId), '飲んだ量がそのまま引かれる').toBe(5000 - 9999);
    expect(character.isInStage(bloodId, 'exsanguinated'), '失血死の段').toBe(true);
  });

  it('回復ポーションをあおると、空から飲んでも血が満タンに戻る', () => {
    const session = new WorldSession(codex);
    const character = spawn(SAMPLE_CHARACTER, 1);
    const potion = spawn('healing_potion', 2);
    const bloodId = codex.propertyNames.getId('blood');
    character.setProperty(bloodId, 0);

    expect(potion.tryExecuteAction('drink', character, session)).toBe(true);

    expect(character.getNumber(bloodId)).toBe(5000);
  });

  it.each(['poison_potion', 'healing_potion'])('%sは飲めば手元から消える', (objectName) => {
    const session = new WorldSession(codex);
    const character = spawn(SAMPLE_CHARACTER, 1);
    const handId = codex.slotNames.getId('hand');
    const potion = spawn(objectName, 2);
    expect(potion.moveToSlot(character, handId)).toBeUndefined();

    expect(potion.tryExecuteAction('drink', character, session)).toBe(true);

    expect(character.tryGetSlot(handId)?.contents).toEqual([]);
  });
});
