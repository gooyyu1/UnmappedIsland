import { readFileSync } from 'node:fs';
import { isMap, isScalar, parseDocument } from 'yaml';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ObjectDef } from '../../src/domain/ObjectDef';
import type { PropertyDef } from '../../src/domain/PropertyDef';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { World } from '../../src/domain/wrappers/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { fixedRng } from '../support/rng';
import {
  loadYamlDirectory,
  SAMPLE_CHARACTER,
  WORLD_CODEX_DIR,
  worldCodexYamlPaths,
} from '../support/worldCodexFiles';

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

/**
 * 食べ物の腐敗（docs/engine/DurabilitySystem.md 3節）。同節の表のレートで`durability`が減り、
 * 0で消えること、屋外ではさらに速いことを、実ファイルの定義だけで確かめる。
 */
describe('食べ物の腐敗', () => {
  /** 洞窟が湧く土地（locations.yamlのrocky_fieldのexplore）。屋根のある場所はここにしか無い。 */
  const CAVE_LAND = 'rocky_field';
  /** 1 tick（core.yamlの15分）。 */
  const ONE_TICK = 15;

  let codex: WorldCodex;
  let durabilityId: number;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
    durabilityId = codex.propertyNames.getId('durability');
  });

  /** 岩場に浅い洞窟が1つある世界。土地が屋外、洞窟の中が「守られている場所」になる。 */
  function world() {
    const worldInstance = new WorldObject(
      0,
      codex.objects.get(codex.objectNames.getId('world')),
      new WorldSession(codex),
    );
    const session = new WorldSession(codex, new World(worldInstance, codex), fixedRng(0));
    const land = spawnInto(session, CAVE_LAND, worldInstance, 'locations');
    return { session, land, cave: spawnInto(session, 'shallow_cave', land, 'fixtures') };
  }

  function spawnInto(
    session: WorldSession,
    objectName: string,
    parent: WorldObject,
    slotName: string,
  ): WorldObject {
    const spawned = session.createObject(codex.objectNames.getId(objectName));
    expect(spawned.moveToSlotOrRejection(parent.getSlot(codex.slotNames.getId(slotName)))).toBeUndefined();
    return spawned;
  }

  function durabilityOf(food: WorldObject): number {
    return food.getProperty(durabilityId).number;
  }

  /** 1 tickの間に減ったdurability。 */
  function lossIn1Tick(session: WorldSession, food: WorldObject): number {
    const before = durabilityOf(food);
    session.advanceWorldTime(ONE_TICK);
    return before - durabilityOf(food);
  }

  it.each([
    // DurabilitySystem.md 3節の表。屋外の列は、腐敗と屋外劣化の2つのaddが加算的に重なった結果
    // （GameElementDefinition.md 8.4節）。
    ['raw_meat', '調理済み料理・生魚など', 4, 5],
    ['water_spinach', '野菜など', 2, 3],
    ['taro', '芋など', 0.5, 1.5],
  ])('%s（%s）は表のレートで傷み、屋外ではさらに速い', (foodName, _category, indoors, outdoors) => {
    const { session, land, cave } = world();
    const sheltered = spawnInto(session, foodName, cave, 'items');
    const exposed = spawnInto(session, foodName, land, 'items');
    const before = durabilityOf(sheltered);

    session.advanceWorldTime(ONE_TICK);

    expect(before - durabilityOf(sheltered), '守られていれば腐敗だけ').toBe(indoors);
    expect(before - durabilityOf(exposed), '屋外では屋外劣化が上乗せされる').toBe(outdoors);
  });

  it('腐りきると消える', () => {
    const { session, land } = world();
    const meat = spawnInto(session, 'raw_meat', land, 'items');
    // 屋外の生肉は2日（192 tick）で尽きる。最後の1 tickだけを見たいので、そこまで詰めておく。
    meat.getProperty(durabilityId).setNumberWithoutEvents(5);

    session.advanceWorldTime(ONE_TICK);

    expect(meat.parent, '0に達した食べ物は世界から出る').toBeUndefined();
  });

  it('守られた場所へ移せば、腐敗だけになる', () => {
    // 蓋つきの入れ物・浅い洞窟が守るのは屋外劣化だけで、保存温度由来の腐敗は止まらない
    // （docs/engine/ContainerSystem.md 6節）。
    const { session, land, cave } = world();
    const meat = spawnInto(session, 'raw_meat', land, 'items');

    expect(lossIn1Tick(session, meat), '野ざらしなら-5').toBe(5);
    expect(meat.moveToSlotOrRejection(cave.getSlot(codex.slotNames.getId('items')))).toBeUndefined();
    expect(lossIn1Tick(session, meat), '洞窟へ入れても腐敗は残る').toBe(4);
  });

  it('食べ物はすべて腐る（炭になった終端だけが例外）', () => {
    // 食べ物を足したときに腐敗を付け忘れると、それだけが永久に保つ食料になる。数が増えても
    // 気付けるよう、ここで全数を検査する。
    const foodTagId = codex.tagNames.getId('food');
    const imperishable: string[] = [];
    for (let globalId = 0; globalId < codex.objects.count; globalId++) {
      const def = codex.objects.get(globalId);
      if (!def.tags.includes(foodTagId) || codex.isGenerated(def)) continue;
      if (def.tryGetPropertyDef(durabilityId) === undefined) imperishable.push(def.name);
    }

    expect(imperishable, '水も栄養素も残らない炭（animals.yaml）だけが腐らない').toEqual(['charred_lump']);
  });
});

/**
 * 食べた物が配る幸福度（docs/world/Characters.md 幸福度節）。**主目的は書き忘れの見張り**で、食べ物を
 * 1つ足したときにベース値を落とすと、それだけが心に何も残さない食事になる。腐敗の全数検査と同じ形。
 */
describe('食べ物が配る幸福度', () => {
  let codex: WorldCodex;
  let happinessId: number;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
    happinessId = codex.propertyNames.getId('happiness');
  });

  /** `eat`をメニューに出す型の名前（自動生成された塩漬けの版を除く）。 */
  function eatableObjectNames(): string[] {
    const found: string[] = [];
    for (let globalId = 0; globalId < codex.objects.count; globalId++) {
      const def = codex.objects.get(globalId);
      if (codex.isGenerated(def)) continue;
      if (def.menuTriggers.some((trigger) => trigger.interaction.name === 'eat')) found.push(def.name);
    }
    return found;
  }

  it('eatを持つ型はすべて、幸福度のベース値を宣言している', () => {
    const declared = declaredEatHappiness();
    const eatable = eatableObjectNames();

    expect(eatable.length, '口に入れる操作が1つも無ければ、この見張りは何も見ていない').toBeGreaterThan(0);
    expect(
      eatable.filter((name) => declared.get(name) === undefined),
      'eatのadd.agentにhappinessが無い（traitがeatを配るようになったら、拾う側も直す）',
    ).toEqual([]);
    expect(
      [...declared].filter(([, value]) => value === undefined).map(([name]) => name),
      '定義ファイルの側から見ても、幸福度を配らないeatは無い',
    ).toEqual([]);
  });

  it('火を通した食事はどれも同じだけ戻す（戻すのは量ではなく質）', () => {
    // 小さなネズミ1匹でも、火の通った1食であることは焼いた肉と変わらない（Characters.md 幸福度節）。
    const declared = declaredEatHappiness();
    const roasted = ['roasted_meat', 'roasted_rat', 'roasted_taro', 'roasted_coconut_crab'];

    expect(roasted.map((name) => declared.get(name))).toEqual([6, 6, 6, 6]);
  });

  it.each([
    // 焼いた肉と生肉の開きが、生で食べない理由を1本増やす（Characters.md 幸福度節）。
    ['roasted_meat', 6],
    ['raw_meat', 1],
    // 炭は腹の嵩しか返さない終端なので、喜びも残っていない。
    ['charred_lump', 0],
  ])('%sを食べると、幸福度が%d戻る', (foodName, expectedGain) => {
    const session = new WorldSession(codex);
    const character = new WorldObject(
      1,
      codex.objects.get(codex.objectNames.getId(SAMPLE_CHARACTER)),
      session,
    );
    const food = new WorldObject(2, codex.objects.get(codex.objectNames.getId(foodName)), session);
    character.getProperty(happinessId).setNumberWithoutEvents(0);

    expect(food.tryGetAction('eat', character)?.tryExecute() === true).toBe(true);

    expect(character.getProperty(happinessId).number).toBe(expectedGain);
  });
});

/**
 * 定義ファイルが書いた「`eat` が `agent` へ配る幸福度」を、型の名前ごとに集める。ロード後の効果は木に
 * 畳まれていて列挙できない（bundledLocale.test.tsのreasonと同じ事情）ため、構文木から拾う。
 *
 * 書いていなければ`undefined`。**0と書いてあることとは区別する**——炭のように0が正しい食べ物があるので、
 * 効果として測ると書き忘れと見分けが付かない。
 */
function declaredEatHappiness(): ReadonlyMap<string, number | undefined> {
  const found = new Map<string, number | undefined>();
  for (const path of worldCodexYamlPaths()) {
    const root = parseDocument(readFileSync(path, 'utf8')).contents;
    if (!isMap(root)) continue;
    // interactionsが書けるのは型とtraitの直下だけ（GameElementDefinition.md 9節）。
    for (const sectionName of ['traits', 'object_defs']) {
      const section = root.get(sectionName, true);
      if (!isMap(section)) continue;
      for (const pair of section.items) {
        const eat = tryGetPath(pair.value, ['interactions', 'eat']);
        if (eat === undefined) continue;
        const happiness = tryGetPath(eat, ['add', 'agent', 'happiness']);
        found.set(
          isScalar(pair.key) ? String(pair.key.value) : '',
          isScalar(happiness) ? Number(happiness.value) : undefined,
        );
      }
    }
  }
  return found;
}

/** YAMLの構文木をキーの並びで辿る（途中で辿れなくなればundefined）。 */
function tryGetPath(node: unknown, keys: readonly string[]): unknown {
  let current = node;
  for (const key of keys) {
    if (!isMap(current)) return undefined;
    current = current.get(key, true);
  }
  return current;
}
