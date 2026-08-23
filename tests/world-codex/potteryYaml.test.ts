import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawnsObject } from '../../src/codex-viewer/describe/effectQueries';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { tryAdvanceCrafting, spawnInProgressObject } from '../../src/domain/crafting';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { Location } from '../../src/domain/wrappers/Location';
import { World } from '../../src/domain/wrappers/World';
import { inProgressObjectName } from '../../src/loader/inProgressObjects';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { fixedRng } from '../support/rng';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * pottery.yamlの土器の連鎖を、実ファイルの定義だけで検証する。
 * 粘土を捏ねて壺の形にし、覆い焼きの炉へ入れて焼き、覆いを壊して甕を取り出すところまで。
 *
 * 焼成はtick駆動（docs/engine/FireSystem.md 7節）なので、時間を進めて観測する。
 */
describe('pottery.yamlの土器の連鎖', () => {
  /** 割れる側を引く。乾き切った壺では割れの重みが0になるので、この引きでも焼き上がる。 */
  const CRACKS = 0;
  /** 焼き上がる側を引く。半々（成形直後）でも当たりに回る。 */
  const SURVIVES = 0.9;

  let codex: WorldCodex;
  let session: WorldSession;
  let land: WorldObject;

  beforeAll(() => {
    // 粘土の湧き先（locations.yaml）・燃料（timber.yaml）・成果物の甕（liquid_containers.yaml）へ
    // ファイルをまたぐ参照があるため、ディレクトリ全体を一括ロードする。
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
  });

  beforeEach(() => {
    // 焼き上がりの候補（割れ・焼き上がり）は宣言順なので、0を引けば割れる側になる。
    open(CRACKS);
  });

  /** 草地を1つ置いた世界。rollは焼き上がりのpickがどの候補を引くかを決める。 */
  function open(roll: number): void {
    const worldInstance = new WorldObject(
      0,
      codex.objects.get(codex.objectNames.getId('world')),
      new WorldSession(codex),
    );
    const worldView = new World(worldInstance, codex);
    session = new WorldSession(codex, worldView, fixedRng(roll));

    land = session.createObject(codex.objectNames.getId('grassland'));
    expect(
      land.moveToSlotOrRejection(worldInstance.getSlot(codex.slotNames.getId('locations'))),
    ).toBeUndefined();
  }

  function spawnInto(objectName: string, parent: WorldObject, slotName: string): WorldObject {
    const spawned = session.createObject(codex.objectNames.getId(objectName));
    expect(spawned.moveToSlotOrRejection(parent.getSlot(codex.slotNames.getId(slotName)))).toBeUndefined();
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
    const recipe = codex.objects.get(codex.objectNames.getId(productName)).recipesProducingThis[0];
    const materialsId = codex.vocabulary.engine.materialsSlotId;
    const wip = spawnInProgressObject(
      session,
      land,
      codex.objectNames.getId(inProgressObjectName(productName, recipeName)),
    );

    for (const step of materials) {
      for (const name of step) {
        expect(
          session.createObject(codex.objectNames.getId(name)).moveToSlotOrRejection(wip.getSlot(materialsId)),
        ).toBeUndefined();
      }
      expect(tryAdvanceCrafting(wip, materialsId, recipe, codex, session), `${productName}の工程`).toBe(true);
    }
  }

  /** 火の点いた覆い焼きの炉を1つ置く。丸太1本をくべて、種火から育てる。 */
  function litKiln(): WorldObject {
    const kiln = spawnInto('earth_kiln', land, 'fixtures');
    const log = spawnInto('log', land, 'items');
    expect(
      kiln
        .combinationsWith(log, undefined)
        .find((c) => c.name === 'add_fuel')
        ?.tryExecute() === true,
    ).toBe(true);
    kiln.tryGetProperty(codex.propertyNames.getId('heat'))?.setNumber(1);
    return kiln;
  }

  /** 壺を1つ、hours時間だけ乾かしてから炉で焼き切る。返すのはその炉。 */
  function fireDriedGreenware(hours: number): WorldObject {
    const greenware = spawnInto('unfired_jar', land, 'items');
    session.advanceWorldTime(60 * hours);

    const kiln = litKiln();
    expect(greenware.moveToSlotOrRejection(kiln.getSlot(codex.slotNames.getId('fire')))).toBeUndefined();
    // 高温（blaze、5/tick）まで昇ってから24tick。昇温のぶんを足して余裕を見る。
    session.advanceWorldTime(60 * 8);
    return kiln;
  }

  /** 焼き上がりの判定だけを起こす。値を超えさせるとon_maxが走る（6.3節）。 */
  function overheat(greenware: WorldObject): void {
    greenware.tryGetProperty(codex.propertyNames.getId('cooking_progress'))?.setNumber(200);
  }

  /** bodyの実行中に告げられた出来事（signal、9.8節）を「誰の身に・何が」の形で並べる。 */
  function signalsOf(body: () => void): string[] {
    const seen: string[] = [];
    session.observeSignals((signal) => seen.push(`${signal.object.def.name}: ${signal.name}`), body);
    return seen;
  }

  it('粘土は草地・森林・密林の探索で見つかる', () => {
    // 水際に堆積するものなので、岩場・荒野・海岸には置かない。
    const clayId = codex.objectNames.getId('clay');
    const spawnsClay = (landName: string): boolean =>
      codex.objects
        .get(codex.objectNames.getId(landName))
        .triggers.some((trigger) => spawnsObject(trigger.interaction, clayId));

    for (const wet of ['grassland', 'forest', 'jungle']) expect(spawnsClay(wet), wet).toBe(true);
    for (const dry of ['sandy_beach', 'rocky_field', 'wasteland', 'mountain_peak'])
      expect(spawnsClay(dry), dry).toBe(false);
  });

  it('粘土2個から素焼き前の壺ができ、できた直後は濡れている', () => {
    craft('unfired_jar', 'coiled', [['clay', 'clay']]);

    expect(itemsOn(land), '作りかけが壺そのものへ置き換わる').toEqual(['unfired_jar']);
    const [greenware] = new Location(land, codex).items;
    expect(greenware.tryGetProperty(codex.propertyNames.getId('moisture'))?.number ?? 0, '練り土の水').toBe(
      96,
    );
  });

  it('置いておくだけで乾く（工程ではなく時間が乾かす）', () => {
    const greenware = spawnInto('unfired_jar', land, 'items');
    const moistureId = codex.propertyNames.getId('moisture');

    session.advanceWorldTime(60 * 12);
    expect(greenware.tryGetProperty(moistureId)?.number ?? 0, '半日で半分ほど抜ける').toBe(48);

    session.advanceWorldTime(60 * 12);
    expect(greenware.tryGetProperty(moistureId)?.number ?? 0, '1日で乾き切る').toBe(0);
    expect(greenware.tryGetProperty(moistureId)?.isInStage('bone_dry') ?? false).toBe(true);
  });

  it('粘土3個から覆い焼きの炉を築ける', () => {
    craft('earth_kiln', 'heaped', [['clay', 'clay', 'clay']]);

    expect(fixturesOn(land), '設置物として建つ').toEqual(['earth_kiln']);
  });

  it('覆い焼きの炉は土器しか受けず、焼き物も煮炊きもできない', () => {
    // 「石囲いの炉では焼けない」の実体は火力の条件ではなく、この枠（pottery.yaml）。
    const kiln = spawnInto('earth_kiln', land, 'fixtures');
    const fireId = codex.slotNames.getId('fire');

    expect(
      spawnInto('unfired_jar', land, 'items').moveToSlotOrRejection(kiln.getSlot(fireId)),
    ).toBeUndefined();
    expect(
      spawnInto('raw_meat', land, 'items').moveToSlotOrRejection(kiln.getSlot(fireId)),
      '覆うので焼けない',
    ).toBeDefined();
    expect(
      spawnInto('coconut_bowl', land, 'items').moveToSlotOrRejection(kiln.getSlot(fireId)),
      '煮炊きもできない',
    ).toBeDefined();
  });

  it('石囲いの炉では土器を焼けない', () => {
    const hearth = spawnInto('stone_hearth', land, 'fixtures');
    const greenware = spawnInto('unfired_jar', land, 'items');

    expect(greenware.moveToSlotOrRejection(hearth.getSlot(codex.slotNames.getId('fire')))).toBeDefined();
  });

  it('乾かしてから焼けば、割れの引きでも必ず甕になる', () => {
    // 残った水がそのまま割れの重みなので、乾き切った壺では割れの候補が抽選から外れる。
    const kiln = fireDriedGreenware(24);

    expect(childNames(kiln), '焼き上がりは同じ枠に残る').toEqual(['jar']);
  });

  it('濡れたまま焼くと、残った水が器を割る', () => {
    const kiln = spawnInto('earth_kiln', land, 'fixtures');
    const greenware = spawnInto('unfired_jar', land, 'items');
    expect(greenware.moveToSlotOrRejection(kiln.getSlot(codex.slotNames.getId('fire')))).toBeUndefined();

    expect(signalsOf(() => overheat(greenware))).toEqual(['unfired_jar: cracked']);
    expect(childNames(kiln), '割れた器は何も残さない').toEqual([]);
  });

  it('濡れていても、当たれば焼き上がる', () => {
    open(SURVIVES);
    const kiln = spawnInto('earth_kiln', land, 'fixtures');
    const greenware = spawnInto('unfired_jar', land, 'items');
    expect(greenware.moveToSlotOrRejection(kiln.getSlot(codex.slotNames.getId('fire')))).toBeUndefined();

    expect(signalsOf(() => overheat(greenware))).toEqual(['unfired_jar: fired']);
    expect(childNames(kiln)).toEqual(['jar']);
  });

  it('成形直後に火へ入れると、焼き上がるまでに水は抜け切らない', () => {
    // 炉の中でも水は抜けるが、焼成のほうが4倍近く速いので追いつかない。急げば賭けになる。
    open(SURVIVES);
    const kiln = litKiln();
    const greenware = spawnInto('unfired_jar', land, 'items');
    expect(greenware.moveToSlotOrRejection(kiln.getSlot(codex.slotNames.getId('fire')))).toBeUndefined();
    const moistureId = codex.propertyNames.getId('moisture');

    let remaining = greenware.tryGetProperty(moistureId)?.number ?? 0;
    for (let tick = 0; tick < 96 && !childNames(kiln).includes('jar'); tick++) {
      remaining = greenware.tryGetProperty(moistureId)?.number ?? 0;
      session.advanceWorldTime(15);
    }

    expect(childNames(kiln), '当たりを引けば焼き上がる').toEqual(['jar']);
    expect(remaining, '半分以上の水を抱えたまま焼き上がる').toBeGreaterThan(48);
  });

  it('覆いを壊すと炉は無くなり、焼き上がった甕はその場に残る', () => {
    // 消える物の中身は、消える自分ではなく自分の親へこぼれる（9.3節）。焼いた物まで道連れにしない。
    const kiln = fireDriedGreenware(24);

    expect(kiln.tryGetAction('break_open', undefined)?.tryExecute() === true).toBe(true);

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
