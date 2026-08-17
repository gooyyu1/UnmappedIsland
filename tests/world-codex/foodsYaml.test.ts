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
    // 食べ物が名乗るのは、かさ（satiety、mL）と中身（栄養素、tick／mg）の2つ。かさと中身は別の数で、
    // 葉物はかさばる割にほとんど身にならない（DigestionSystem.md 1節）。
    ['water_spinach', 300, 'carbohydrate', 1, 83],
    ['coconut_crab', 500, 'protein', 25, 2],
    ['taro', 600, 'carbohydrate', 40, 36],
  ])(
    '%sを食べると、かさ・栄養素・ビタミンが加算され、食料自身は消滅する',
    (foodObjectName, expectedBulk, nutrientName, expectedNutrient, expectedVitamin) => {
      const session = new WorldSession(codex);
      const character = spawn(SAMPLE_CHARACTER, 1);
      const food = spawn(foodObjectName, 2);

      const satietyId = codex.propertyNames.getId('satiety');
      const nutrientId = codex.propertyNames.getId(nutrientName);
      const vitaminId = codex.propertyNames.getId('vitamin');

      // 在庫は体脂肪へ流れ続ける（characters/参照）ため、加算量だけを見たい。一旦0まで下げる。
      for (const id of [satietyId, nutrientId, vitaminId]) character.setProperty(id, 0);

      expect(food.tryExecuteAction('eat', character, session)).toBe(true);

      expect(character.getNumber(satietyId), 'かさ').toBe(expectedBulk);
      expect(character.getNumber(nutrientId), '栄養素').toBe(expectedNutrient);
      expect(character.getNumber(vitaminId), 'ビタミン').toBe(expectedVitamin);
    },
  );

  it('characterはエネルギーの在庫を3本持ち、速さが栄養素ごとに違う', () => {
    // 速いものから 糖質 → たんぱく質 → 脂質（DigestionSystem.md 3節）。
    const character = codex.objects.get(codex.objectNames.getId(SAMPLE_CHARACTER));
    const instance = new WorldObject(1, character, new WorldSession(codex));

    for (const [name, expectedRate] of [
      ['carbohydrate', 2],
      ['protein', 1],
      ['lipid', 0.5],
    ] as const) {
      const id = codex.propertyNames.getId(name);
      expect(instance.getNumber(id), `${name}の初期値`).toBeGreaterThan(0);
      expect(propOf(character, name).range?.max, `${name}のmax`).toBe(120);

      // 体脂肪は基礎代謝でも動くので、在庫があるときと空のときの差を見る。
      expect(bodyFatGainIn1Tick(name), `${name}が1 tickで身になる量`).toBe(expectedRate);
    }
  });

  it('ビタミンはエネルギーにならず、体脂肪へは流れない', () => {
    // 葉物はエネルギーをほとんど持たないので、別の物差し（mg）で持つ（DigestionSystem.md 4節）。
    const character = codex.objects.get(codex.objectNames.getId(SAMPLE_CHARACTER));
    const session = new WorldSession(codex);
    const instance = new WorldObject(1, character, session);
    const bodyFatId = codex.propertyNames.getId('body_fat');
    for (const name of ['carbohydrate', 'protein', 'lipid'])
      instance.setProperty(codex.propertyNames.getId(name), 0);
    instance.setProperty(codex.propertyNames.getId('vitamin'), 1000);
    instance.setProperty(bodyFatId, 100);

    instance.tick(session);

    expect(instance.getNumber(bodyFatId), '在庫が空なら基礎代謝で減るだけ').toBeLessThan(100);
    expect(propOf(character, 'vitamin').range?.max).toBe(1500);
  });

  /** その栄養素だけを在庫に持つインスタンスが1 tickで体脂肪へ渡す量（基礎代謝ぶんを除く）。 */
  function bodyFatGainIn1Tick(stocked: string | undefined): number {
    const def = codex.objects.get(codex.objectNames.getId(SAMPLE_CHARACTER));
    const session = new WorldSession(codex);
    const instance = new WorldObject(1, def, session);
    const bodyFatId = codex.propertyNames.getId('body_fat');
    for (const name of ['carbohydrate', 'protein', 'lipid'])
      instance.setProperty(codex.propertyNames.getId(name), name === stocked ? 100 : 0);

    const before = instance.getNumber(bodyFatId);
    instance.tick(session);
    return instance.getNumber(bodyFatId) - before + basalPerTick();
  }

  /** 在庫が空のときに1 tickで減る体脂肪（＝基礎代謝）。 */
  function basalPerTick(): number {
    const def = codex.objects.get(codex.objectNames.getId(SAMPLE_CHARACTER));
    const session = new WorldSession(codex);
    const instance = new WorldObject(1, def, session);
    const bodyFatId = codex.propertyNames.getId('body_fat');
    for (const name of ['carbohydrate', 'protein', 'lipid'])
      instance.setProperty(codex.propertyNames.getId(name), 0);

    const before = instance.getNumber(bodyFatId);
    instance.tick(session);
    return before - instance.getNumber(bodyFatId);
  }

  function propOf(def: ObjectDef, propertyName: string): PropertyDef {
    const prop = def.getPropertyDef(codex.propertyNames.getId(propertyName));
    if (prop === undefined) throw new Error(`'${def.name}' はプロパティ'${propertyName}'を持ちません。`);
    return prop;
  }
});
