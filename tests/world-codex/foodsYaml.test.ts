import { readFileSync } from 'node:fs';
import { isMap, isScalar, parseDocument } from 'yaml';
import { beforeAll, describe, expect, it } from 'vitest';
import { spawnsObject } from '../../src/codex-viewer/describe/effectQueries';
import type { ObjectDef } from '../../src/domain/ObjectDef';
import type { PropertyDef } from '../../src/domain/PropertyDef';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { World } from '../../src/domain/wrappers/World';
import { fixedRng } from '../support/rng';
import { bundledCodex, SAMPLE_CHARACTER, worldCodexYamlPaths } from '../support/worldCodexFiles';
import { makeBrightEnoughForAnyAction } from '../support/illumination';
import type { PropertyGlobalId } from '../../src/domain/GlobalId';

describe('foods.yamlの食料定義', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    // 焼き上がりの焦げた先（animals.yamlのcharred_lump）へファイルをまたぐ参照があるため、
    // ディレクトリ全体を一括ロードする。
    codex = bundledCodex();
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
      ['lipid', 0.25],
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
  /** core.yamlが宣言する1 tick（15分）。 */
  const ONE_TICK = 15;

  let codex: WorldCodex;
  let durabilityId: PropertyGlobalId;

  beforeAll(() => {
    codex = bundledCodex();
    durabilityId = codex.propertyNames.getId('durability');
  });

  /** 岩場に浅い洞窟が1つある世界。土地が屋外、洞窟の中が「守られている場所」になる。 */
  function world() {
    const session = new WorldSession(codex, fixedRng(0));
    const worldInstance = session.createObject(codex.objectNames.getId('world'));
    session.adoptWorld(new World(worldInstance));
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
    for (const def of codex.objects) {
      if (!def.tags.includes(foodTagId) || codex.isGenerated(def)) continue;
      if (def.tryGetPropertyDef(durabilityId) === undefined) imperishable.push(def.name);
    }

    expect(imperishable, '水も栄養素も残らない炭（animals.yaml）だけが腐らない').toEqual(['charred_lump']);
  });
});

/** 火を通した1食が戻す幸福度（docs/world/Characters.md 幸福度節）。戻すのは量ではなく質なので、どれも同じ。 */
const ROASTED_HAPPINESS = 6;

/** 上出来の料理（`fine_dish`、docs/world/Skills.md 5.4節）が、普段の出来へ上乗せして戻す幸福度（同幸福度節）。 */
const FINE_DISH_BONUS = 3;

/**
 * 食べた物が配る幸福度（docs/world/Characters.md 幸福度節）。**主目的は書き忘れの見張り**で、食べ物を
 * 1つ足したときにベース値を落とすと、それだけが心に何も残さない食事になる。腐敗の全数検査と同じ形。
 */
describe('食べ物が配る幸福度', () => {
  let codex: WorldCodex;
  let happinessId: PropertyGlobalId;

  beforeAll(() => {
    codex = bundledCodex();
    happinessId = codex.propertyNames.getId('happiness');
  });

  /** `eat`をメニューに出す型の名前（自動生成された塩漬けの版を除く）。 */
  function eatableObjectNames(): string[] {
    const found: string[] = [];
    for (const def of codex.objects) {
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
    // **上出来の料理だけはその上に乗る**（docs/world/Skills.md 5.4節）。出来も質なので、量で変えない
    // ことは同じ。
    const declared = declaredEatHappiness();
    const roasted = roastedMealNames();
    const fineDishTagId = codex.tagNames.getId('fine_dish');
    const expected = (name: string): number =>
      codex.objects.get(codex.objectNames.getId(name)).hasTag(fineDishTagId)
        ? ROASTED_HAPPINESS + FINE_DISH_BONUS
        : ROASTED_HAPPINESS;

    expect(roasted.length, '火を通した食事が1つも無ければ、この見張りは何も見ていない').toBeGreaterThan(0);
    expect(roasted.map((name) => declared.get(name))).toEqual(roasted.map(expected));
  });

  it('上出来の料理は、同じ火から生まれる普段の出来と、幸福度のほかは何も違わない', () => {
    // 上出来の型は普段の出来を書き写して持つ（foods.yaml）ので、**片方だけを直すと出来が腹の足しや
    // 傷み方まで変える**。宣言の面で、違ってよいもの（幸福度・印・絵の借り先）を除いて突き合わせる。
    const fineDishTagId = codex.tagNames.getId('fine_dish');
    const fineDishes = [...codex.objects].filter((def) => def.hasTag(fineDishTagId));
    const declarations = declaredObjectBodies();

    expect(fineDishes.length, '上出来の料理が1つも無ければ、この見張りは何も見ていない').toBeGreaterThan(0);
    for (const fine of fineDishes) {
      const plain = plainSiblingsOf(fine);
      expect(plain, `${fine.name}: 同じ焼き上がりから生まれる普段の出来`).toHaveLength(1);

      const withoutGrade = (name: string): unknown => {
        const body = structuredClone(declarations.get(name)) as {
          tags: string[];
          art?: string;
          interactions: { eat: { add: { agent: Record<string, number> } } };
        };
        body.tags = body.tags.filter((tag) => tag !== 'fine_dish');
        delete body.art;
        delete body.interactions.eat.add.agent.happiness;
        return body;
      };
      expect(withoutGrade(fine.name), `${fine.name} と ${plain[0]}`).toEqual(withoutGrade(plain[0]));
      expect(declarations.get(fine.name)).toHaveProperty('art', plain[0]);
    }
  });

  it('上出来を生む焼き上がりは、下ごしらえできる物にだけある', () => {
    // 出来を決めるのは刻んだ手で、焼き上げる炉の端には操作者が居ない（docs/world/Skills.md 5.5節）。
    // **下ごしらえの軸を持たない物に上出来の枝を置くと、誰の腕も届かない抽選になる。**
    const fineDishTagId = codex.tagNames.getId('fine_dish');
    const preppable = new Set<string>();
    for (const def of codex.objects) {
      const baseGlobalId = codex.generatedTypes.baseGlobalIdIfVariantOn(def, 'prep');
      if (baseGlobalId !== undefined) preppable.add(codex.objects.get(baseGlobalId).name);
    }
    const sources = [...codex.objects]
      .filter((def) => def.hasTag(fineDishTagId))
      .flatMap((fine) => roastingSourcesOf(fine).map((def) => def.name));

    expect(sources.length, '上出来を生む焼き上がりが1つも無い').toBeGreaterThan(0);
    expect(sources.filter((name) => !preppable.has(name))).toEqual([]);
  });

  /** その型を焼き上がり（`cooking_progress`の`on_max`）で生む、手で書いた型。 */
  function roastingSourcesOf(product: ObjectDef): ObjectDef[] {
    const cookingProgressId = codex.propertyNames.getId('cooking_progress');
    return [...codex.objects].filter(
      (def) =>
        !codex.isGenerated(def) &&
        def
          .tryGetPropertyDef(cookingProgressId)
          ?.rangeEvents()
          .some(([label, effect]) => label === 'on_max' && spawnsObject(effect, product.globalId)) === true,
    );
  }

  /** 上出来の型と同じ焼き上がり（`cooking_progress`の`on_max`）から生まれる、普段の出来の型の名前。 */
  function plainSiblingsOf(fine: ObjectDef): string[] {
    const cookingProgressId = codex.propertyNames.getId('cooking_progress');
    const fineDishTagId = codex.tagNames.getId('fine_dish');
    const sources = roastingSourcesOf(fine);
    const siblings = new Set<string>();
    for (const source of sources)
      for (const [label, effect] of source.tryGetPropertyDef(cookingProgressId)?.rangeEvents() ?? [])
        if (label === 'on_max')
          for (const def of codex.objects)
            if (!def.hasTag(fineDishTagId) && !codex.isGenerated(def) && spawnsObject(effect, def.globalId))
              siblings.add(def.name);
    return [...siblings];
  }

  /**
   * 火を通した1食（`cooking_progress`の`on_max`、FireSystem.md 7節）。**焼成の宣言から数え上げる**
   * ——手で並べると、焼ける食べ物が増えたときに「どれも同じだけ戻す」の外へ黙って出る。
   *
   * 採るのは**鎖の1段目だけ**で、焼き過ぎた先（炭）は入らない——炭を生むのは、既に焼かれて生まれた
   * 物のほう。食べ物でない焼き上がり（素焼きの器）は`eat`を持たないので、そちらで落ちる。
   */
  function roastedMealNames(): readonly string[] {
    const cookingProgressId = codex.propertyNames.getId('cooking_progress');
    const defs = [...codex.objects].filter((def) => !codex.isGenerated(def));
    const roastsInto = (from: ObjectDef, to: ObjectDef): boolean =>
      from
        .tryGetPropertyDef(cookingProgressId)
        ?.rangeEvents()
        .some(([label, effect]) => label === 'on_max' && spawnsObject(effect, to.globalId)) === true;

    const eatable = new Set(eatableObjectNames());
    return defs
      .filter(
        (def) =>
          eatable.has(def.name) &&
          defs.some(
            (source) => roastsInto(source, def) && !defs.some((earlier) => roastsInto(earlier, source)),
          ),
      )
      .map((def) => def.name);
  }

  it.each([
    // 焼いた肉と生肉の開きが、生で食べない理由を1本増やす（Characters.md 幸福度節）。
    ['roasted_meat', ROASTED_HAPPINESS],
    ['raw_meat', 1],
    // 同じ芋でも、出来で食べたときの嬉しさが違う（docs/world/Skills.md 5.4節）。
    ['roasted_taro', ROASTED_HAPPINESS],
    ['roasted_taro_fine', ROASTED_HAPPINESS + FINE_DISH_BONUS],
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
 * 下ごしらえ（foods.yamlのtaroのchop）。**料理の腕の入口**（docs/world/Skills.md 2.5節）で、火にかける
 * 手には腕を配れない——火にかけた後を進めるのは炉であって人ではないため。
 *
 * 見るのは、**払った手間が返ること**（火の通りが速くなる）と、**同じ1つを刻み直しても稼げないこと**。
 * 前者が無ければ誰も刻まないので腕も伸びず、後者が抜けると20分の繰り返しが最も速い伸ばし方になる。
 */
describe('foods.yamlの下ごしらえ', () => {
  /** core.yamlが宣言する1 tick（15分）。 */
  const ONE_TICK = 15;
  /** 炎の段（fire.yamlのheat）の下端。焚き火の上限は30なので、ここへ置けば炎のまま燃え続ける。 */
  const FLAME_HEAT = 20;
  /** 浅い洞窟が湧く土地（locations.yamlのrocky_fieldのexplore）。屋根のある場所はここにしか無い。 */
  const CAVE_LAND = 'rocky_field';

  let codex: WorldCodex;
  let cookingProgressId: PropertyGlobalId;
  let skillCookingId: PropertyGlobalId;
  let durabilityId: PropertyGlobalId;

  beforeAll(() => {
    codex = bundledCodex();
    cookingProgressId = codex.propertyNames.getId('cooking_progress');
    skillCookingId = codex.propertyNames.getId('skill_cooking');
    durabilityId = codex.propertyNames.getId('durability');
  });

  /** 草地にプレイヤーが立っている世界。`roll`は抽選が引く位置（fixedRng）。 */
  function open(landName = 'grassland', roll = 0) {
    const session = new WorldSession(codex, fixedRng(roll));
    const worldInstance = session.createObject(codex.objectNames.getId('world'));
    session.adoptWorld(new World(worldInstance));
    const land = spawnInto(session, landName, worldInstance, 'locations');
    const player = spawnInto(session, SAMPLE_CHARACTER, land, 'characters');
    // 刃を当てる手元の作業なので明るさを要求する（foods.yaml）。ここで見たいのは下ごしらえの側なので、
    // 時刻を作らずに満たす。
    makeBrightEnoughForAnyAction(player, codex);
    return { session, land, player };
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

  /** 炎で燃えている焚き火。薪はこの検査のあいだ尽きない。 */
  function litCampfire(session: WorldSession, land: WorldObject): WorldObject {
    const hearth = spawnInto(session, 'campfire', land, 'fixtures');
    hearth.getProperty(codex.propertyNames.getId('fuel')).setNumberWithoutEvents(30);
    hearth.getProperty(codex.propertyNames.getId('heat')).setNumberWithoutEvents(FLAME_HEAT);
    return hearth;
  }

  /** 尖った石を重ねて刻む組み合わせ（相手として名乗り出なければundefined）。 */
  function chopping(session: WorldSession, player: WorldObject, taro: WorldObject) {
    const blade = spawnInto(session, 'sharp_stone', player, 'hand');
    return taro.combinationsWith(blade, player).find((combination) => combination.name === 'chop');
  }

  /** その炉に今かかっている物の型名。 */
  function childNames(hearth: WorldObject): string[] {
    const slot = hearth.tryGetSlot(codex.slotNames.getId('fire'));
    return (slot?.contents ?? []).map((object) => object.def.name).sort();
  }

  it('刻むと、同じ個体が刻んだ版になって料理の腕が伸びる', () => {
    // 料理の腕の入口（foods.yamlのchop。入口が1本であることは
    // tests/world-codex/skillsYaml.test.tsが見張る）。別の型は作らず同じ個体を作り変える（become）
    // ので、傷み具合はそのまま引き継がれる。
    const { session, land, player } = open();
    const taro = spawnInto(session, 'taro', land, 'items');
    player.getProperty(skillCookingId).setNumberWithoutEvents(0);

    expect(chopping(session, player, taro)?.tryExecute(), '尖った石で刻める').toBe(true);

    expect(taro.def.name, '同じ個体が刻んだ版になる').toBe('taro__prep_chopped');
    expect(player.getProperty(skillCookingId).number, '実行経路の、20分ぶんの+1').toBe(1);
  });

  it('二度は刻めない（同じ1つを刻み直して腕を稼げない）', () => {
    // 伸びる量は作業の長さから決まる（SkillSystem.md 3節）が、時間あたりの上端に居る短い操作
    // なので、ここが開いていると20分の刻み直しが最も速い伸ばし方になる。**軸は塞いでくれない**
    // ——刻んだ芋にも操作は残り、同じ軸の同じ値への`become`は自分自身として解けるので、
    // 止めているのはfoods.yamlの条件のほう。
    const { session, land, player } = open();
    const taro = spawnInto(session, 'taro', land, 'items');
    expect(chopping(session, player, taro)?.tryExecute()).toBe(true);

    expect(chopping(session, player, taro)?.tryExecute() === true, '二度目は通らない').toBe(false);
    expect(player.getProperty(skillCookingId).number, '腕は1回ぶんのまま').toBe(1);
  });

  it('刻んだ芋は、同じ火にかけても先に焼き上がる', () => {
    // **払った手間が返るのはここ**（foods.yamlのprepped）。炉が渡す熱（炎なら3/tick）へ2が上乗せ
    // されるので、30の道のりが10tickから6tickへ縮む。
    const { session, land, player } = open();
    const whole = spawnInto(session, 'taro', land, 'items');
    const chopped = spawnInto(session, 'taro', land, 'items');
    expect(chopping(session, player, chopped)?.tryExecute()).toBe(true);

    const hearth = litCampfire(session, land);
    for (const food of [whole, chopped])
      expect(food.moveToSlotOrRejection(hearth.getSlot(codex.slotNames.getId('fire')))).toBeUndefined();

    expect(whole.tryGetProperty(cookingProgressId)?.ticksUntilMax(), '丸のままは3/tick').toBe(10);
    expect(chopped.tryGetProperty(cookingProgressId)?.ticksUntilMax(), '刻んであれば5/tick').toBe(6);

    session.advanceWorldTime(ONE_TICK * 6);
    expect(childNames(hearth), '刻んだほうだけが焼き上がっている').toEqual(['roasted_taro', 'taro']);
  });

  /** 料理の腕が`skill`の者が、抽選の位置`roll`で芋を刻み、炎で焼き上げたときにできる物の型名。 */
  function roastedAfterChopping(skill: number | undefined, roll: number): string[] {
    const { session, land, player } = open('grassland', roll);
    const taro = spawnInto(session, 'taro', land, 'items');
    if (skill !== undefined) {
      player.getProperty(skillCookingId).setNumberWithoutEvents(skill);
      expect(chopping(session, player, taro)?.tryExecute()).toBe(true);
    }
    const hearth = litCampfire(session, land);
    expect(taro.moveToSlotOrRejection(hearth.getSlot(codex.slotNames.getId('fire')))).toBeUndefined();
    session.advanceWorldTime(ONE_TICK * 10);
    return childNames(hearth);
  }

  it('同じ芋を刻んで焼いても、出来の違う物ができることがある', () => {
    // docs/world/Skills.md 5.4節【確定】。出来は刻んだときに決まり、焼き上がりがそれを読む
    // （foods.yamlのtaro）。素人でも、引きが良ければ上手に焼ける。
    expect(roastedAfterChopping(0, 0.5), '引きが並なら普段の出来').toEqual(['roasted_taro']);
    expect(roastedAfterChopping(0, 0.99), '引きが良ければ上出来').toEqual(['roasted_taro_fine']);
  });

  it('料理の腕が高いほど、同じ引きでも上出来になる', () => {
    // 腕は上出来の側の重みにだけ積まれる（characters/player_character.yamlのcooking_flair）ので、
    // 同じ位置を引いても、上の段ほど上出来の側へ落ちる。位置を3つ取り、**段が1つ上がるごとに
    // 上出来になる位置が広がる**ことを見る（段の下端は characters/player_character.yaml）。
    const stageMins = [0, 20, 60, 180];
    const fineAt = (roll: number): boolean[] =>
      stageMins.map((skill) => roastedAfterChopping(skill, roll).includes('roasted_taro_fine'));

    expect(fineAt(0.6), 'expertだけが上出来').toEqual([false, false, false, true]);
    expect(fineAt(0.75), 'skilledから上出来').toEqual([false, false, true, true]);
    expect(fineAt(0.85), 'basicから上出来').toEqual([false, true, true, true]);
  });

  it('刻まずに焼いた芋は、どれだけ引きが良くても普段の出来', () => {
    // 焼き上げる炉の端には操作者が居ないので、腕の出番が無かった芋は出来の抽選を持たない
    // （foods.yamlのtaroのroasts_into_*）。
    expect(roastedAfterChopping(undefined, 0.99)).toEqual(['roasted_taro']);
  });

  it('刻んだ芋は、切り口のぶん腐るのが速い', () => {
    // **下ごしらえは火にかける直前**という順序を作る上乗せ（foods.yamlのprepped）。分類によらず-1で、
    // 量は屋外に置いたぶんの上乗せから借りているが、**門は持たない**——屋根の下でも切り口は塞がらない。
    const { session, land, player } = open();
    const whole = spawnInto(session, 'taro', land, 'items');
    const chopped = spawnInto(session, 'taro', land, 'items');
    expect(chopping(session, player, chopped)?.tryExecute()).toBe(true);

    const before = [whole, chopped].map((food) => food.getProperty(durabilityId).number);
    session.advanceWorldTime(ONE_TICK);

    expect(before[0] - whole.getProperty(durabilityId).number, '丸のままは芋の速さ＋屋外').toBe(1.5);
    expect(before[1] - chopped.getProperty(durabilityId).number, '刻むと-1が重なる').toBe(2.5);
  });

  it('切り口は、屋根の下へ入れても塞がらない', () => {
    // 一つ上と対。**屋外だけを見ていると、門を足されても緑のまま**——量を借りた先（屋外の上乗せ）は
    // `sheltered` の門を通しているので、そこごと写されると蓋つきの入れ物で切り口が止まる別の挙動に
    // なる。守るのは浅い洞窟が守れるものだけ（docs/engine/ContainerSystem.md 6節）。
    const { session, land, player } = open(CAVE_LAND);
    const cave = spawnInto(session, 'shallow_cave', land, 'fixtures');
    const whole = spawnInto(session, 'taro', land, 'items');
    const chopped = spawnInto(session, 'taro', land, 'items');
    expect(chopping(session, player, chopped)?.tryExecute()).toBe(true);
    for (const food of [whole, chopped])
      expect(food.moveToSlotOrRejection(cave.getSlot(codex.slotNames.getId('items')))).toBeUndefined();

    const before = [whole, chopped].map((food) => food.getProperty(durabilityId).number);
    session.advanceWorldTime(ONE_TICK);

    expect(before[0] - whole.getProperty(durabilityId).number, '丸のままは屋外の-1が落ちる').toBe(0.5);
    expect(before[1] - chopped.getProperty(durabilityId).number, '刻んだぶんの-1は残る').toBe(1.5);
  });

  it('下ごしらえできる食べ物は、今のところタロイモだけ', () => {
    // **「この芋だけ」と書いた主張が、破れたときに落ちる先。** 置ける先が生のままで火にかける物に
    // 限られること・保存の軸と両立しないことは docs/world/Skills.md 2.5節とfoods.yamlのtaroが
    // 理由ごと書いているが、2つ目が生えても、腕が伸びる操作を数えるだけの検査
    // （skillsYaml.test.ts）は緑のまま通る。**ここが落ちたら、その2箇所も一緒に直す。**
    const prepped: string[] = [];
    for (const def of codex.objects) {
      const baseGlobalId = codex.generatedTypes.baseGlobalIdIfVariantOn(def, 'prep');
      if (baseGlobalId !== undefined) prepped.push(codex.objects.get(baseGlobalId).name);
    }

    expect(prepped, '増えたなら、Skills.md 2.5節とfoods.yamlのtaroの理由も書き直す').toEqual(['taro']);
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

/** 定義ファイルが`object_defs`へ書いた型の中身を、型の名前ごとに素のJSの値で集める。 */
function declaredObjectBodies(): ReadonlyMap<string, unknown> {
  const found = new Map<string, unknown>();
  for (const path of worldCodexYamlPaths()) {
    // 空のファイルはnullになる。
    const root = parseDocument(readFileSync(path, 'utf8')).toJS() as {
      object_defs?: Record<string, unknown>;
    } | null;
    for (const [name, body] of Object.entries(root?.object_defs ?? {})) found.set(name, body);
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
