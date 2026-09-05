import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { spawnInProgressObject, tryAdvanceCrafting } from '../../src/domain/crafting';
import type { RecipeDef } from '../../src/domain/RecipeDef';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { World } from '../../src/domain/wrappers/World';
import { inProgressObjectName } from '../../src/loader/inProgressObjects';
import { fixedRng } from '../support/rng';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';
import { makeBrightEnoughForAnyAction } from '../support/illumination';

/**
 * なめし革の連鎖を、実ファイルの定義だけで検証する（docs/world/SurvivalItems.md 0節・5節）。
 * 広葉樹から樹皮を剥ぎ（timber.yaml）、生皮と樹皮からなめし革を作り（clothing.yaml）、
 * そこからなめし革の衣類が最後まで作れること——狩猟と伐採が衣類で合流する唯一の経路。
 */
describe('なめし革の連鎖', () => {
  let codex: WorldCodex;
  let session: WorldSession;
  let forest: WorldObject;
  let player: WorldObject;

  beforeAll(() => {
    codex = bundledCodex();
  });

  beforeEach(() => {
    const worldInstance = new WorldObject(
      0,
      codex.objects.get(codex.objectNames.getId('world')),
      new WorldSession(codex),
    );
    session = new WorldSession(codex, new World(worldInstance, codex), fixedRng(0));

    forest = spawnInto('forest', worldInstance, 'locations');
    player = spawnInto(SAMPLE_CHARACTER, forest, 'characters');
    // 樹皮を剥ぐのも工程を進めるのも明るさを要求する（IlluminationSystem.md 5節）。ここで見たいのは
    // なめしの連鎖なので、時刻や光源を組み立てずに作業者の側で条件を満たす。
    makeBrightEnoughForAnyAction(player, codex);
  });

  function spawn(objectName: string): WorldObject {
    return session.createObject(codex.objectNames.getId(objectName));
  }

  function spawnInto(objectName: string, parent: WorldObject, slotName: string): WorldObject {
    const spawned = session.createObject(codex.objectNames.getId(objectName));
    expect(spawned.moveToSlotOrRejection(parent.getSlot(codex.slotNames.getId(slotName)))).toBeUndefined();
    return spawned;
  }

  /** 作業者が今手に持っている物の名前（剥いだ樹皮はここへ入る、11.4節のinto: agent）。 */
  function carried(): string[] {
    return player.getSlot(codex.vocabulary.world.handSlotId).contents.map((object) => object.def.name);
  }

  function recipeOf(objectName: string): RecipeDef {
    return codex.objects.get(codex.objectNames.getId(objectName)).recipesProducingThis[0];
  }

  /** 材料を材料スロットへ入れた、作りかけの1つ。置き場所は作り手の手元。 */
  function startCrafting(objectName: string, recipeName: string, materials: readonly string[]): WorldObject {
    const wip = spawnInProgressObject(
      session,
      player,
      codex.objectNames.getId(inProgressObjectName(objectName, recipeName)),
    );

    for (const name of materials)
      expect(
        spawn(name).moveToSlotOrRejection(wip.getSlot(codex.vocabulary.engine.materialsSlotId)),
        name,
      ).toBeUndefined();

    return wip;
  }

  /** レシピを最後まで進める。完成した瞬間に同じ個体が成果物へ変わる（9.9節のbecome）。 */
  function craft(objectName: string, recipeName: string, materials: readonly string[]): WorldObject {
    const recipe = recipeOf(objectName);
    const wip = startCrafting(objectName, recipeName, materials);

    for (const [index] of recipe.steps.entries())
      expect(
        tryAdvanceCrafting(wip, codex.vocabulary.engine.materialsSlotId, recipe, codex, session, player),
        `${objectName}の工程${index + 1}`,
      ).toBe(true);

    expect(wip.def.name, `${objectName} ができていない`).toBe(objectName);
    return wip;
  }

  it('立ち木から刃物で樹皮を剥ぐと、樹皮が3巻き手に入り、木は残る', () => {
    const tree = spawnInto('broadleaf_tree', forest, 'fixtures');
    const knife = spawnInto('sharp_stone', player, 'hand');

    expect(
      tree
        .combinationsWith(knife, player)
        .find((c) => c.name === 'strip_bark')
        ?.tryExecute() === true,
    ).toBe(true);

    expect(
      carried().filter((name) => name === 'tree_bark'),
      '革1枚ぶんが1回で採れる',
    ).toHaveLength(3);
    expect(tree.parent, '剥いでも木は立ったまま').toBe(forest);
  });

  it('樹皮を剥いだ木は、後から倒して丸太も採れる', () => {
    const tree = spawnInto('broadleaf_tree', forest, 'fixtures');
    const axe = spawnInto('stone_axe', player, 'hand');

    // 石斧は刃物でもある（tools.yaml）ので、剥ぐのも倒すのも同じ1本でできる。
    for (const name of ['strip_bark', 'fell'])
      expect(
        tree
          .combinationsWith(axe, player)
          .find((c) => c.name === name)
          ?.tryExecute() === true,
        name,
      ).toBe(true);

    expect(tree.parent, '倒した木は残らない').toBeUndefined();
  });

  it('素手では樹皮を剥げない（刃物が要る）', () => {
    const tree = spawnInto('broadleaf_tree', forest, 'fixtures');

    expect(tree.combinationsWith(player, player), '手を当てても成立しない').toEqual([]);
  });

  it('生皮と樹皮からなめし革ができ、刃物は減らない', () => {
    const knife = spawnInto('sharp_stone', player, 'hand');
    const wip = startCrafting('tanned_leather', 'tanned', ['rawhide', 'tree_bark', 'tree_bark', 'tree_bark']);
    const recipe = recipeOf('tanned_leather');

    // 刃物は掻き落とすためだけの道具（consume: false）なので、材料スロットへ置いても消えない。
    expect(knife.moveToSlotOrRejection(wip.getSlot(codex.vocabulary.engine.materialsSlotId))).toBeUndefined();

    for (const [index] of recipe.steps.entries())
      expect(
        tryAdvanceCrafting(wip, codex.vocabulary.engine.materialsSlotId, recipe, codex, session, player),
        `工程${index + 1}`,
      ).toBe(true);

    expect(wip.def.name).toBe('tanned_leather');
    expect(knife.parent, '刃物は消費されない').toBeDefined();
  });

  it('刃物が無ければ、毛と肉を落とす工程が進まない', () => {
    const wip = startCrafting('tanned_leather', 'tanned', ['rawhide', 'tree_bark', 'tree_bark', 'tree_bark']);

    expect(
      tryAdvanceCrafting(
        wip,
        codex.vocabulary.engine.materialsSlotId,
        recipeOf('tanned_leather'),
        codex,
        session,
        player,
      ),
    ).toBe(false);
  });

  it('樹皮が無ければ、漬ける工程で止まる（生皮だけではなめせない）', () => {
    const recipe = recipeOf('tanned_leather');
    const wip = startCrafting('tanned_leather', 'tanned', ['rawhide']);

    expect(
      spawn('sharp_stone').moveToSlotOrRejection(wip.getSlot(codex.vocabulary.engine.materialsSlotId)),
    ).toBeUndefined();

    expect(
      tryAdvanceCrafting(wip, codex.vocabulary.engine.materialsSlotId, recipe, codex, session, player),
      '毛と肉は落とせる',
    ).toBe(true);
    expect(
      tryAdvanceCrafting(wip, codex.vocabulary.engine.materialsSlotId, recipe, codex, session, player),
      '漬ける樹皮が無い',
    ).toBe(false);
    expect(wip.def.name, 'なめし革になっていない').not.toBe('tanned_leather');
  });

  it('剥いだ樹皮と生皮から、なめし革の衣類まで作れる', () => {
    const tree = spawnInto('broadleaf_tree', forest, 'fixtures');
    const knife = spawnInto('sharp_stone', player, 'hand');
    const stripBark = () =>
      expect(
        tree
          .combinationsWith(knife, player)
          .find((c) => c.name === 'strip_bark')
          ?.tryExecute() === true,
      ).toBe(true);

    // なめし革の衣類は革2枚。1枚につき生皮1枚と樹皮3巻き（ひと剥ぎぶん）が要る。
    const leathers = [0, 1].map(() => {
      stripBark();
      return craft('tanned_leather', 'tanned', [
        'rawhide',
        'tree_bark',
        'tree_bark',
        'tree_bark',
        'sharp_stone',
      ]);
    });

    expect(leathers.every((leather) => leather.def.name === 'tanned_leather')).toBe(true);

    const garment = craft('tanned_leather_clothing', 'sewn', [
      'tanned_leather',
      'tanned_leather',
      'yarn',
      'yarn',
      'yarn',
      'bone_needle',
    ]);

    expect(garment.def.name).toBe('tanned_leather_clothing');
    expect(
      garment.moveToSlotOrRejection(player.getSlot(codex.vocabulary.world.equipmentSlotId)),
      '着られる',
    ).toBeUndefined();
  });
});
