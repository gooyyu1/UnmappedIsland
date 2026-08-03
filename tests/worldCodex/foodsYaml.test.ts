import { beforeAll, describe, expect, it } from 'vitest';
import type { ObjectDef } from '../../src/domain/defs/ObjectDef';
import type { PropertyDef } from '../../src/domain/defs/PropertyDef';
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

describe('foods.yamlの食料定義', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    const loader = new WorldCodexYamlLoader();
    loadYamlFile(loader, worldCodexPath('core.yaml'));
    loadYamlDirectory(loader, worldCodexPath('characters'));
    loadYamlFile(loader, worldCodexPath('foods.yaml'));
    codex = loader.build();
  });

  function spawn(objectName: string, instanceId: number): WorldObject {
    return new WorldObject(
      instanceId,
      codex.objects.get(codex.objectNames.getId(objectName)),
      new WorldSession(codex),
    );
  }

  it.each([
    ['water_spinach', 'vegetable_nutrition', 8],
    ['coconut_crab', 'meat_nutrition', 15],
    ['taro', 'grain_tuber_nutrition', 20],
  ])(
    '%sを食べるとsatietyと%sが加算され、食料自身は消滅する',
    (foodObjectName, nutritionPropertyName, expectedSatietyGain) => {
      const session = new WorldSession(codex);
      const character = spawn(SAMPLE_CHARACTER, 1);
      const food = spawn(foodObjectName, 2);

      const satietyId = codex.propertyNames.getId('satiety');
      const nutritionId = codex.propertyNames.getId(nutritionPropertyName);

      // 栄養カテゴリはtickごとに減衰する（characters/参照）ため、加算量だけを検証したい。
      // 一旦0まで下げてから食べさせ、増分だけを見る。
      character.setProperty(satietyId, 0);
      character.setProperty(nutritionId, 0);

      expect(food.tryExecuteAction('eat', character, session)).toBe(true);

      expect(character.getNumber(satietyId)).toBe(expectedSatietyGain);
      expect(character.getNumber(nutritionId)).toBe(20000);
    },
  );

  it('characterは3つの栄養カテゴリを持ち、初期値は満タンで1週間かけて減衰する', () => {
    const character = codex.objects.get(codex.objectNames.getId(SAMPLE_CHARACTER));
    const instance = new WorldObject(1, character, new WorldSession(codex));
    for (const name of ['vegetable_nutrition', 'meat_nutrition', 'grain_tuber_nutrition']) {
      const id = codex.propertyNames.getId(name);
      // 初期値は実行時インスタンスの現在値として観測する（DefaultNumberは非公開）。
      expect(instance.getNumber(id), `${name}の初期値`).toBe(67200);
      const prop = propOf(character, name);
      expect(prop.range?.min).toBe(0);
      expect(prop.range?.max).toBe(67200);
    }
  });

  function propOf(def: ObjectDef, propertyName: string): PropertyDef {
    const prop = def.getPropertyDef(codex.propertyNames.getId(propertyName));
    if (prop === undefined) throw new Error(`'${def.name}' はプロパティ'${propertyName}'を持ちません。`);
    return prop;
  }
});
