import { beforeAll, describe, expect, it } from 'vitest';
import type { ObjectDef } from '../../src/domain/ObjectDef';
import type { PropertyDef } from '../../src/domain/PropertyDef';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

describe('foods.yamlの食料定義', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    // 焼き上がりの焦げた先（animals.yamlのcharred_lump）へファイルをまたぐ参照があるため、
    // ディレクトリ全体を一括ロードする。
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
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
    ['roasted_coconut_crab', 460, 'protein', 28, 1],
    ['roasted_taro', 550, 'carbohydrate', 48, 24],
  ])(
    '%sを食べると、かさ・栄養素・ビタミンが加算され、食料自身は消滅する',
    (foodObjectName, expectedBulk, nutrientName, expectedNutrient, expectedVitamin) => {
      const character = spawn(SAMPLE_CHARACTER, 1);
      const food = spawn(foodObjectName, 2);

      const satietyId = codex.propertyNames.getId('satiety');
      const nutrientId = codex.propertyNames.getId(nutrientName);
      const vitaminId = codex.propertyNames.getId('vitamin');

      // 在庫は体脂肪へ流れ続ける（characters/参照）ため、加算量だけを見たい。一旦0まで下げる。
      for (const id of [satietyId, nutrientId, vitaminId])
        character.getProperty(id).setNumberWithoutEvents(0);

      expect(food.tryGetAction('eat', character)?.tryExecute() === true).toBe(true);

      expect(character.tryGetProperty(satietyId)?.number ?? 0, 'かさ').toBe(expectedBulk);
      expect(character.tryGetProperty(nutrientId)?.number ?? 0, '栄養素').toBe(expectedNutrient);
      expect(character.tryGetProperty(vitaminId)?.number ?? 0, 'ビタミン').toBe(expectedVitamin);
    },
  );

  it.each(['coconut_crab', 'taro'])('%s は生では食べられず、火にかけて初めて食べ物になる', (rawName) => {
    // ヤシガニはシュウ酸ではなく殻と生の甲殻類の危うさ、タロイモはシュウ酸カルシウムの針状結晶
    // （foods.yaml）。どちらも「加熱したほうがよい」ではなく、加熱が食用の条件。
    const raw = codex.objects.get(codex.objectNames.getId(rawName));
    const foodTagId = codex.tagNames.getId('food');

    expect(raw.tags, '生は食べ物のタグを持たない').not.toContain(foodTagId);
    expect(
      raw.menuTriggers.map((trigger) => trigger.interaction.name),
      '生を口に入れる操作は無い',
    ).not.toContain('eat');
    // 火の中の枠へ入れるためのタグ（docs/engine/FireSystem.md 1.1節）。
    expect(raw.tags).toContain(codex.tagNames.getId('roastable'));
    expect(codex.objects.get(codex.objectNames.getId(`roasted_${rawName}`)).tags).toContain(foodTagId);
  });

  it('焦げた塊は、腹の嵩だけを返す', () => {
    // 肉も芋もここへ落ちる（foods.yamlのタロイモ・ヤシガニ）ので、元が何だったかによらない終端に
    // していなければならない（animals.yaml）。
    const character = spawn(SAMPLE_CHARACTER, 1);
    const lump = spawn('charred_lump', 2);

    const nutrients = ['carbohydrate', 'protein', 'lipid', 'vitamin'].map((name) =>
      codex.propertyNames.getId(name),
    );
    const satietyId = codex.propertyNames.getId('satiety');
    for (const id of [satietyId, ...nutrients]) character.getProperty(id).setNumberWithoutEvents(0);

    expect(lump.tryGetAction('eat', character)?.tryExecute() === true).toBe(true);

    expect(character.tryGetProperty(satietyId)?.number ?? 0, 'かさは少し戻る').toBe(200);
    for (const id of nutrients)
      expect(character.tryGetProperty(id)?.number ?? 0, '身になるものは残っていない').toBe(0);
  });

  it('characterはエネルギーの在庫を3本持ち、速さが栄養素ごとに違う', () => {
    // 速いものから 糖質 → たんぱく質 → 脂質（DigestionSystem.md 3節）。
    const character = codex.objects.get(codex.objectNames.getId(SAMPLE_CHARACTER));
    const instance = new WorldSession(codex).createObject(character.globalId);

    for (const [name, expectedRate] of [
      ['carbohydrate', 2],
      ['protein', 1],
      ['lipid', 0.5],
    ] as const) {
      const id = codex.propertyNames.getId(name);
      expect(instance.tryGetProperty(id)?.number ?? 0, `${name}の初期値`).toBeGreaterThan(0);
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
      instance.getProperty(codex.propertyNames.getId(name)).setNumberWithoutEvents(0);
    instance.getProperty(codex.propertyNames.getId('vitamin')).setNumberWithoutEvents(1000);
    instance.getProperty(bodyFatId).setNumberWithoutEvents(100);

    instance.tick();

    expect(instance.tryGetProperty(bodyFatId)?.number ?? 0, '在庫が空なら基礎代謝で減るだけ').toBeLessThan(
      100,
    );
    expect(propOf(character, 'vitamin').range?.max).toBe(1500);
  });

  /** その栄養素だけを在庫に持つインスタンスが1 tickで体脂肪へ渡す量（基礎代謝ぶんを除く）。 */
  function bodyFatGainIn1Tick(stocked: string | undefined): number {
    const def = codex.objects.get(codex.objectNames.getId(SAMPLE_CHARACTER));
    const session = new WorldSession(codex);
    const instance = new WorldObject(1, def, session);
    const bodyFatId = codex.propertyNames.getId('body_fat');
    for (const name of ['carbohydrate', 'protein', 'lipid'])
      instance
        .getProperty(codex.propertyNames.getId(name))
        .setNumberWithoutEvents(name === stocked ? 100 : 0);

    const before = instance.tryGetProperty(bodyFatId)?.number ?? 0;
    instance.tick();
    return (instance.tryGetProperty(bodyFatId)?.number ?? 0) - before + basalPerTick();
  }

  /** 在庫が空のときに1 tickで減る体脂肪（＝基礎代謝）。 */
  function basalPerTick(): number {
    const def = codex.objects.get(codex.objectNames.getId(SAMPLE_CHARACTER));
    const session = new WorldSession(codex);
    const instance = new WorldObject(1, def, session);
    const bodyFatId = codex.propertyNames.getId('body_fat');
    for (const name of ['carbohydrate', 'protein', 'lipid'])
      instance.getProperty(codex.propertyNames.getId(name)).setNumberWithoutEvents(0);

    const before = instance.tryGetProperty(bodyFatId)?.number ?? 0;
    instance.tick();
    return before - (instance.tryGetProperty(bodyFatId)?.number ?? 0);
  }

  function propOf(def: ObjectDef, propertyName: string): PropertyDef {
    const prop = def.tryGetPropertyDef(codex.propertyNames.getId(propertyName));
    if (prop === undefined) throw new Error(`'${def.name}' はプロパティ'${propertyName}'を持ちません。`);
    return prop;
  }
});
