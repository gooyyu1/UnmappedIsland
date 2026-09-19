import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { spawnInProgressObject, tryAdvanceCrafting } from '../../src/domain/crafting';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { World } from '../../src/domain/wrappers/World';
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
    const wip = startCrafting(clothing, true);

    // **工程は1時間ずつに割ってある**（docs/engine/ActionSystem.md 6.3節）ので、完成するまで
    // 繰り返し進める。上限は無限に回らないための頭打ちで、工程の数そのものではない。
    for (let left = 20; wip.def.name !== clothing.name; left -= 1) {
      expect(left, `${clothing.name} ができていない`).toBeGreaterThan(0);
      expect(tryAdvanceCrafting(wip, player), `${clothing.name}の工程`).toBe(true);
    }
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

  describe('着ている間、寒さの入口を押し下げる（SurvivalItems.md 5.1節）', () => {
    /** 素の寒さの入口（characters/player_character.yamlのchill_point）。℃。 */
    const CHILL_POINT = 16;

    /** 1着ずつの押し下げ（℃）。手のかかる一着ほど深い（SurvivalItems.md 5.1節）。 */
    const DROPS: readonly (readonly [string, number])[] = [
      ['bundled_leaf_clothing', 1],
      ['rawhide_clothing', 2],
      ['woven_leaf_clothing', 3],
      ['tanned_leather_clothing', 4],
    ];

    /** 砂浜に立たせたキャラクタ。熱の削りは祖先の気温を読むので、居場所が要る。 */
    function stand(): { player: WorldObject; world: WorldObject } {
      const worldInstance = session.createObject(codex.objectNames.getId('world'));
      session.adoptWorld(new World(worldInstance));
      const beach = spawn('sandy_beach');
      expect(
        beach.moveToSlotOrRejection(worldInstance.getSlot(codex.slotNames.getId('locations'))),
      ).toBeUndefined();
      const character = spawn(SAMPLE_CHARACTER);
      expect(
        character.moveToSlotOrRejection(beach.getSlot(codex.slotNames.getId('characters'))),
      ).toBeUndefined();
      return { player: character, world: worldInstance };
    }

    /**
     * 空の気温をその摂氏へ据える。**実体値ではなく実効値で合わせる**——worldのambient_temperatureには
     * 日射と季節の段がmodifyで乗る（core.yaml）ので、書いた値がそのまま気温になるとは限らない。
     */
    function setSkyTemperature(world: WorldObject, celsius: number): void {
      const temperature = world.getProperty(codex.propertyNames.getId('ambient_temperature'));
      temperature.setNumber(celsius);
      temperature.setNumber(celsius - (temperature.getEffectiveValue() - celsius));
      expect(temperature.getEffectiveValue(), `空を${celsius}℃にする`).toBe(celsius);
    }

    /** その気温に1 tick置いたときの熱の増減。満タンだと戻りが頭打ちに掛かるので半分から測る。 */
    function warmthChange(player: WorldObject, world: WorldObject, celsius: number): number {
      setSkyTemperature(world, celsius);
      const warmth = player.getProperty(codex.propertyNames.getId('warmth'));
      warmth.setNumber((warmth.def.range?.max ?? 0) / 2);
      const before = warmth.number;

      player.tick();

      return warmth.number - before;
    }

    it('身につけられる物は、1つ残らず押し下げを名乗っている', () => {
      // 名乗り忘れた一着は、着ても寒さが何も変わらない（issue #2109 がその形）。下の各テストが
      // 名前ごとに押し下げを確かめるので、タグから数え上げてこの表と突き合わせておけば、
      // 衣類を足した人はここへも書くことになる（weatheringYaml.test.ts と同じ理由）。
      //
      // **数え上げるのはequippableで、衣類に絞らない。** このタグが言うのは身につけられることで、
      // 衣類であることではない（SurvivalItems.md 5節）ので、衣類でない装備（背負う入れ物、
      // docs/world/Containers.md）が入ればここが落ちる——それでよい。**身につける物が寒さの入口を
      // どうするかは、どれについても答えが要る**（絞っても、将来そこへ入れたくなるだけ）。
      const equippableId = codex.tagNames.getId('equippable');
      const worn = [...codex.objects]
        .filter((objectDef) => !codex.isGenerated(objectDef) && objectDef.tags.includes(equippableId))
        .map((objectDef) => objectDef.name);

      expect(worn.sort()).toEqual(DROPS.map(([name]) => name).sort());
    });

    it.each(DROPS)('%s を着ていれば、寒さの入口が%d℃下がる', (name, drop) => {
      const { player, world } = stand();
      const garment = spawn(name);
      const threshold = CHILL_POINT - drop;

      // 着る前は、押し下げた先の気温で削られる。
      expect(warmthChange(player, world, threshold), `着る前は${threshold}℃で削られる`).toBeLessThan(0);

      expect(
        garment.moveToSlotOrRejection(player.getSlot(codex.vocabulary.world.equipmentSlotId)),
      ).toBeUndefined();

      // 押し下げた先とちょうど釣り合うので、削られずに戻る（境目以上は戻り、VitalsSystem.md 8.4節）。
      expect(warmthChange(player, world, threshold), `${threshold}℃では戻る`).toBeGreaterThan(0);
      // 1℃下は入口の下なので、着ていても削られる。深さを増やせばここが落ちる。
      expect(warmthChange(player, world, threshold - 1), `${threshold - 1}℃では削られる`).toBeLessThan(0);
    });

    /**
     * 涼しい季節（thermal_levelの下限）の空を、その時刻に組み立てたときの気温（℃）。
     * **書き写さずにcore.yamlから引く**ので、季節や日射の寄与を動かせば、これを読む側が落ちる。
     * 日射の帯（ambient_brightnessの段）を名前で確かめてから返すので、時刻の側が動いても気づける。
     */
    function coolSeasonSky(world: WorldObject, hour: number, brightnessStage: string): number {
      world.getProperty(codex.propertyNames.getId('thermal_level')).setNumber(0);
      world.getProperty(codex.propertyNames.getId('hour')).setNumber(hour);
      world
        .getProperty(codex.propertyNames.getId('weather'))
        .setNumberWithoutEvents(codex.symbolNames.getId('clear'));
      expect(
        world.getProperty(codex.propertyNames.getId('ambient_brightness')).isInStage(brightnessStage),
        `${hour}時の空が${brightnessStage}の帯にある`,
      ).toBe(true);

      return world.getProperty(codex.propertyNames.getId('ambient_temperature')).getEffectiveValue();
    }

    it('いちばん安い一着は、涼しい季節の薄明とちょうど釣り合う', () => {
      // 薄明の帯（dim）は雨天の昼と同じ明るさで、屋根の無い所ではwarmthを最も速く削る場面
      // （-6/tick）。**一着も持たずに雨季を歩けるか**がここで分かれる（SurvivalItems.md 5.1節）。
      const { world } = stand();
      const [shallowestName, shallowestDrop] = DROPS.reduce((best, entry) =>
        entry[1] < best[1] ? entry : best,
      );

      expect(CHILL_POINT - shallowestDrop, `${shallowestName}が釣り合う先`).toBe(
        coolSeasonSky(world, 6, 'dim'),
      );
    });

    it('いちばん高い一着は、空が作る最も寒い夜とちょうど釣り合う', () => {
      const { player, world } = stand();
      const coldestNight = coolSeasonSky(world, 0, 'dark');

      const [deepestName, deepestDrop] = DROPS.reduce((best, entry) => (entry[1] > best[1] ? entry : best));
      expect(CHILL_POINT - deepestDrop, `${deepestName}が釣り合う先`).toBe(coldestNight);

      // ここより1段浅い一着では、最も寒い夜に足りない。
      const [shallowerName] = DROPS.reduce((best, entry) =>
        entry[1] < deepestDrop && entry[1] > best[1] ? entry : best,
      );
      const shallower = spawn(shallowerName);
      const equipmentId = codex.vocabulary.world.equipmentSlotId;
      expect(shallower.moveToSlotOrRejection(player.getSlot(equipmentId))).toBeUndefined();
      expect(warmthChange(player, world, coldestNight), `${shallowerName}では足りない`).toBeLessThan(0);

      // いちばん深い一着へ着替えれば、同じ夜で削られなくなる。
      expect(
        shallower.moveToSlotOrRejection(player.getSlot(codex.vocabulary.world.handSlotId)),
      ).toBeUndefined();
      expect(spawn(deepestName).moveToSlotOrRejection(player.getSlot(equipmentId))).toBeUndefined();
      expect(warmthChange(player, world, coldestNight), `${deepestName}なら足りる`).toBeGreaterThan(0);
    });
  });

  it('なめし革の衣類は、骨針が無ければ縫えない', () => {
    // 骨針は消費されない道具（consume: false）だが、無ければ工程は進まない。素材だけで進んで
    // しまうと、縫製が骨針より前に来てしまう（SurvivalItems.md 1.2節の経路が意味を失う）。
    //
    // **裁つところまでは針が要らない**（要求はその工程で実際に使うものへ割り当ててある）ので、
    // 止まるのは縫い始める工程。**そこから先へは一歩も進まない。**
    const sewn = CLOTHING.find((clothing) => clothing.name === 'tanned_leather_clothing')!;
    const wip = startCrafting(sewn, false);

    while (tryAdvanceCrafting(wip, player));

    expect(wip.def.name, '針無しでは縫い上がらない').not.toBe(sewn.name);
    expect(tryAdvanceCrafting(wip, player), '止まったまま動かない').toBe(false);
  });
});
