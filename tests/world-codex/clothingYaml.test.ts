import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { spawnInProgressObject, tryAdvanceCrafting } from '../../src/domain/crafting';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { inProgressObjectName } from '../../src/loader/inProgressObjects';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';
import { makeBrightEnoughForAnyAction } from '../support/illumination';

/**
 * clothing.yamlの衣類4種（docs/world/SurvivalItems.md 5節）を、実ファイルの定義だけで検証する。
 * カタログの素材から作れること、作った物をキャラクタの装備スロットへ着られて脱げること。
 */
describe('clothing.yamlの衣類', () => {
  /** 4種と、そのレシピ名・工程が要求する素材・消費されない道具。 */
  const CLOTHING: readonly {
    readonly name: string;
    readonly recipe: string;
    readonly materials: readonly string[];
    readonly tools: readonly string[];
  }[] = [
    {
      name: 'bundled_leaf_clothing',
      recipe: 'bundled',
      materials: ['palm_frond', 'plant_fiber'],
      tools: [],
    },
    { name: 'rawhide_clothing', recipe: 'draped', materials: ['rawhide', 'rawhide'], tools: [] },
    {
      name: 'woven_leaf_clothing',
      recipe: 'stitched',
      materials: ['woven_leaf', 'woven_leaf', 'woven_leaf', 'plant_fiber', 'plant_fiber'],
      tools: [],
    },
    {
      name: 'tanned_leather_clothing',
      recipe: 'sewn',
      materials: ['tanned_leather', 'tanned_leather', 'yarn', 'yarn', 'yarn'],
      tools: ['bone_needle'],
    },
  ];

  let codex: WorldCodex;
  let session: WorldSession;
  let player: WorldObject;

  beforeAll(() => {
    // 素材がweaving.yaml・fiber.yaml・animals.yaml・tools.yamlに散っているため、ディレクトリ全体を
    // 一括ロードする。
    codex = bundledCodex();
  });

  beforeEach(() => {
    session = new WorldSession(codex);
    player = session.createObject(codex.objectNames.getId(SAMPLE_CHARACTER));
    // 工程を進めるには手元の明るさが要る（IlluminationSystem.md 5節）。ここで見たいのは衣類なので、
    // 時刻や光源を組み立てずに作り手の側で条件を満たす。
    makeBrightEnoughForAnyAction(player, codex);
  });

  function spawn(objectName: string): WorldObject {
    return session.createObject(codex.objectNames.getId(objectName));
  }

  /** 材料を材料スロットへ入れた、作りかけの1着。置き場所は作り手の手元。 */
  function startCrafting(clothing: (typeof CLOTHING)[number], withTools: boolean): WorldObject {
    const wip = spawnInProgressObject(
      session,
      player,
      codex.objectNames.getId(inProgressObjectName(clothing.name, clothing.recipe)),
    );
    const materialsId = codex.vocabulary.engine.materialsSlotId;

    for (const name of withTools ? [...clothing.materials, ...clothing.tools] : clothing.materials)
      expect(spawn(name).moveToSlotOrRejection(wip.getSlot(materialsId)), name).toBeUndefined();

    return wip;
  }

  /**
   * レシピを最後まで進めて1着を返す。作りかけは完成した瞬間に成果物へ変わる（9.9節のbecome）ので、
   * 返るのは同じオブジェクト。
   */
  function craft(clothing: (typeof CLOTHING)[number]): WorldObject {
    const recipe = codex.objects.get(codex.objectNames.getId(clothing.name)).recipesProducingThis[0];
    const wip = startCrafting(clothing, true);

    expect(
      tryAdvanceCrafting(wip, codex.vocabulary.engine.materialsSlotId, recipe, codex, session, player),
      `${clothing.name}の工程`,
    ).toBe(true);
    expect(wip.def.name, `${clothing.name} ができていない`).toBe(clothing.name);
    return wip;
  }

  it.each(CLOTHING)('$name はカタログの素材から作れる', (clothing) => {
    craft(clothing);
  });

  it.each(CLOTHING)('$name は、身につけられることを名乗っている', (clothing) => {
    // 装備スロットが受け入れる先はこのタグ（player_character.yaml）。
    const equippableTagId = codex.tagNames.getId('equippable');

    expect(codex.objects.get(codex.objectNames.getId(clothing.name)).tags).toContain(equippableTagId);
  });

  it('身につけられることを名乗らない物は、装備スロットへ入らない', () => {
    // 石でもヤシの実でも身につけられた頃の裏返し。断るのは枠の型（accept、7.2節）で、画面はこの
    // 答えをそのまま落とし先の有無に使う（Windows.md 2節）。
    const equipmentId = codex.vocabulary.world.equipmentSlotId;

    for (const name of ['stone', 'coconut', 'sharp_stone'])
      expect(spawn(name).moveToSlotOrRejection(player.getSlot(equipmentId)), name).toContain(
        '枠の型が合いません',
      );
  });

  it.each(CLOTHING)('$name は装備スロットへ着られて、脱げる', (clothing) => {
    const equipmentId = codex.vocabulary.world.equipmentSlotId;
    const handId = codex.vocabulary.world.handSlotId;
    const garment = craft(clothing);

    expect(garment.moveToSlotOrRejection(player.getSlot(equipmentId)), '着られる').toBeUndefined();
    expect(garment.parentSlot?.def.globalId, '装備に入っている').toBe(equipmentId);

    expect(garment.moveToSlotOrRejection(player.getSlot(handId)), '脱げる').toBeUndefined();
    expect(garment.parentSlot?.def.globalId, '手持ちへ戻っている').toBe(handId);
  });

  it('4種はどれも1着で全身を覆う（同じ部位・同じ階層）', () => {
    const coverages = CLOTHING.map(
      (clothing) => codex.objects.get(codex.objectNames.getId(clothing.name)).wornCoverage,
    );

    for (const [index, coverage] of coverages.entries()) {
      expect(coverage, `${CLOTHING[index].name} が身につける場所を持たない`).toBeDefined();
      expect(coverage!.conflictsWith(coverages[0]), `${CLOTHING[index].name} が1着目と競合しない`).toBe(true);
    }
  });

  it('着ているあいだは、別の1着を重ねられない（外せば着られる）', () => {
    const equipmentId = codex.vocabulary.world.equipmentSlotId;
    const handId = codex.vocabulary.world.handSlotId;
    const [worn, other] = [craft(CLOTHING[0]), craft(CLOTHING[1])];

    expect(worn.moveToSlotOrRejection(player.getSlot(equipmentId))).toBeUndefined();
    expect(other.moveToSlotOrRejection(player.getSlot(equipmentId)), '重ねられない').toContain(
      '同じ部位の同じ階層',
    );

    expect(worn.moveToSlotOrRejection(player.getSlot(handId)), '脱ぐ').toBeUndefined();
    expect(other.moveToSlotOrRejection(player.getSlot(equipmentId)), '脱いだ後なら着られる').toBeUndefined();
  });

  it('なめし革の衣類は、骨針が無ければ縫えない', () => {
    // 骨針は消費されない道具（consume: false）だが、無ければ工程は進まない。素材だけで進んで
    // しまうと、縫製が骨針より前に来てしまう（SurvivalItems.md 1.2節の経路が意味を失う）。
    const sewn = CLOTHING.find((clothing) => clothing.name === 'tanned_leather_clothing')!;
    const recipe = codex.objects.get(codex.objectNames.getId(sewn.name)).recipesProducingThis[0];
    const wip = startCrafting(sewn, false);

    expect(
      tryAdvanceCrafting(wip, codex.vocabulary.engine.materialsSlotId, recipe, codex, session, player),
    ).toBe(false);
  });
});
