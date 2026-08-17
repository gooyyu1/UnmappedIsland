import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawnsObject } from '../../src/domain/defs/effectQueries';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { advanceCrafting, spawnInProgressObject } from '../../src/domain/runtime/crafting';
import { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { Location } from '../../src/domain/runtime/views/Location';
import { World } from '../../src/domain/runtime/views/World';
import { inProgressObjectName, MATERIALS_SLOT } from '../../src/loader/inProgressObjects';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * pottery.yamlの土器の連鎖を、実ファイルの定義だけで検証する。
 * 粘土を捏ねて壺の形にし、覆い焼きの炉へ入れて焼き、覆いを壊して甕を取り出すところまで。
 *
 * 焼成はtick駆動（docs/engine/FireSystem.md 7節）なので、時間を進めて観測する。
 */
describe('pottery.yamlの土器の連鎖', () => {
  let codex: WorldCodex;
  let session: WorldSession;
  let land: WorldObject;

  beforeAll(() => {
    // 粘土の湧き先（locations.yaml）・燃料（timber.yaml）・成果物の甕（liquid_containers.yaml）へ
    // ファイルをまたぐ参照があるため、ディレクトリ全体を一括ロードする。
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
  });

  beforeEach(() => {
    const worldInstance = new WorldObject(
      0,
      codex.objects.get(codex.objectNames.getId('world')),
      new WorldSession(codex),
    );
    const worldView = new World(worldInstance, codex.propertyNames, codex.symbolNames);
    session = new WorldSession(codex, worldView);

    land = session.spawn(codex.objectNames.getId('grassland'));
    expect(land.moveToSlot(worldInstance, codex.slotNames.getId('locations'))).toBeUndefined();
  });

  function spawnInto(objectName: string, parent: WorldObject, slotName: string): WorldObject {
    const spawned = session.spawn(codex.objectNames.getId(objectName));
    expect(spawned.moveToSlot(parent, codex.slotNames.getId(slotName))).toBeUndefined();
    return spawned;
  }

  function itemsOn(location: WorldObject): string[] {
    return new Location(location, codex).items.map((object) => object.def.name);
  }

  function fixturesOn(location: WorldObject): string[] {
    return new Location(location, codex).fixtures.map((object) => object.def.name);
  }

  function childNames(parent: WorldObject): string[] {
    return [...parent.children()].map((child) => child.def.name);
  }

  /** 完成するまでレシピの工程を進める。各工程の要求を、そのつど材料スロットへ入れる。 */
  function craft(productName: string, recipeName: string, materials: readonly string[][]): void {
    const recipe = codex.objects.get(codex.objectNames.getId(productName)).recipes[0];
    const materialsId = codex.slotNames.getId(MATERIALS_SLOT);
    const wip = spawnInProgressObject(
      session,
      land,
      codex.objectNames.getId(inProgressObjectName(productName, recipeName)),
    );

    for (const step of materials) {
      for (const name of step) {
        expect(session.spawn(codex.objectNames.getId(name)).moveToSlot(wip, materialsId)).toBeUndefined();
      }
      expect(advanceCrafting(wip, recipe, materialsId, codex, session), `${productName}の工程`).toBe(true);
    }
  }

  /** 火の点いた覆い焼きの炉を1つ置く。丸太1本をくべて、種火から育てる。 */
  function litKiln(): WorldObject {
    const kiln = spawnInto('earth_kiln', land, 'fixtures');
    const log = spawnInto('log', land, 'items');
    expect(kiln.tryExecuteCombination(log, undefined, 'add_fuel', session)).toBe(true);
    kiln.setNumber(codex.propertyNames.getId('heat'), 1, session);
    return kiln;
  }

  it('粘土は草地・森林・密林の探索で見つかる', () => {
    // 水際に堆積するものなので、岩場・荒野・海岸には置かない。
    const clayId = codex.objectNames.getId('clay');
    const spawnsClay = (landName: string): boolean =>
      codex.objects
        .get(codex.objectNames.getId(landName))
        .actions.some((action) => spawnsObject(action, clayId));

    for (const wet of ['grassland', 'forest', 'jungle']) expect(spawnsClay(wet), wet).toBe(true);
    for (const dry of ['sandy_beach', 'rocky_field', 'wasteland', 'mountain_peak'])
      expect(spawnsClay(dry), dry).toBe(false);
  });

  it('粘土2個から、2工程で素焼き前の壺ができる', () => {
    craft('unfired_jar', 'coiled', [['clay'], ['clay']]);

    expect(itemsOn(land), '作りかけが壺そのものへ置き換わる').toEqual(['unfired_jar']);
  });

  it('粘土3個から覆い焼きの炉を築ける', () => {
    craft('earth_kiln', 'heaped', [['clay', 'clay', 'clay']]);

    expect(fixturesOn(land), '設置物として建つ').toEqual(['earth_kiln']);
  });

  it('覆い焼きの炉は土器しか受けず、焼き物も煮炊きもできない', () => {
    // 「石囲いの炉では焼けない」の実体は火力の条件ではなく、この枠（pottery.yaml）。
    const kiln = spawnInto('earth_kiln', land, 'fixtures');
    const fireId = codex.slotNames.getId('fire');

    expect(spawnInto('unfired_jar', land, 'items').moveToSlot(kiln, fireId)).toBeUndefined();
    expect(spawnInto('raw_meat', land, 'items').moveToSlot(kiln, fireId), '覆うので焼けない').toBeDefined();
    expect(
      spawnInto('coconut_bowl', land, 'items').moveToSlot(kiln, fireId),
      '煮炊きもできない',
    ).toBeDefined();
  });

  it('石囲いの炉では土器を焼けない', () => {
    const hearth = spawnInto('stone_hearth', land, 'fixtures');
    const greenware = spawnInto('unfired_jar', land, 'items');

    expect(greenware.moveToSlot(hearth, codex.slotNames.getId('fire'))).toBeDefined();
  });

  it('火にかけた壺は焼き上がり、甕になる', () => {
    const kiln = litKiln();
    const greenware = spawnInto('unfired_jar', land, 'items');
    expect(greenware.moveToSlot(kiln, codex.slotNames.getId('fire'))).toBeUndefined();

    // 高温（blaze、5/tick）まで昇ってから24tick。昇温のぶんを足して余裕を見る。
    session.advanceWorldTime(60 * 8);

    expect(childNames(kiln), '焼き上がりは同じ枠に残る').toEqual(['jar']);
  });

  it('覆いを壊すと炉は無くなり、焼き上がった甕はその場に残る', () => {
    // 消える物の中身は、消える自分ではなく自分の親へこぼれる（9.3節）。焼いた物まで道連れにしない。
    const kiln = litKiln();
    const greenware = spawnInto('unfired_jar', land, 'items');
    expect(greenware.moveToSlot(kiln, codex.slotNames.getId('fire'))).toBeUndefined();
    session.advanceWorldTime(60 * 8);

    expect(kiln.tryExecuteAction('break_open', undefined, session)).toBe(true);

    expect(fixturesOn(land), '炉は一度きり').toEqual([]);
    expect(itemsOn(land), '甕は土地へこぼれる').toEqual(['jar']);
  });

  it('甕は持ち運べる', () => {
    // itemタグが無いとカードにならず、汲み置きした水を筏へ積めない（docs/world/Voyage.md）。
    const jar = codex.objects.get(codex.objectNames.getId('jar'));

    expect(jar.tags).toContain(codex.tagNames.getId('item'));
    // 素焼きは落とせば割れる（docs/engine/HuntingSystem.md 5.4節）。
    expect(jar.tags).toContain(codex.tagNames.getId('fragile'));
  });
});
