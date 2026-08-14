import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { Location } from '../../src/domain/runtime/views/Location';
import { World } from '../../src/domain/runtime/views/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { fixedRng } from '../support/rng';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * fire.yamlの火の連鎖を、実ファイルの定義だけで検証する。
 * 火口に火をつけ、火種で炉へ着火し、薪をくべ、火を育て、肉を焼き、石を積んで炉を上げるところまで。
 *
 * 火の育ちと衰えはtick駆動（docs/engine/FireSystem.md 2.2節）なので、時間を進めて観測する。
 */
describe('fire.yamlの火の連鎖', () => {
  let codex: WorldCodex;
  let session: WorldSession;
  let worldView: World;
  let land: WorldObject;
  let player: WorldObject;

  beforeAll(() => {
    // 燃料（locations.yaml）・火口（coconut.yaml・fiber.yaml）・料理（animals.yaml）への
    // ファイルをまたぐ参照があるため、ディレクトリ全体を一括ロードする。
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
  });

  beforeEach(() => {
    const worldInstance = new WorldObject(
      0,
      codex.objects.get(codex.objectNames.getId('world')),
      new WorldSession(codex),
    );
    worldView = new World(worldInstance, codex.propertyNames, codex.symbolNames);
    // 火起こしは確率で外す。ここは連鎖を見るテストなので、必ず成功する側を引く。
    session = new WorldSession(codex, worldView, fixedRng(0));

    land = spawnInto('grassland', worldInstance, 'locations');
    player = spawnInto(SAMPLE_CHARACTER, land, 'characters');
  });

  function spawnInto(objectName: string, parent: WorldObject, slotName: string): WorldObject {
    const spawned = session.spawn(codex.objectNames.getId(objectName));
    expect(spawned.moveToSlot(parent, codex.slotNames.getId(slotName))).toBeUndefined();
    return spawned;
  }

  function itemsOn(location: WorldObject): string[] {
    return new Location(location, codex).items.map((object) => object.def.name);
  }

  function numberOf(object: WorldObject, propertyName: string): number {
    return object.getNumber(codex.propertyNames.getId(propertyName));
  }

  /** その炉の火力が指定した段にあるか。 */
  function heatIs(hearth: WorldObject, stageName: string): boolean {
    return hearth.isInStage(codex.propertyNames.getId('heat'), stageName);
  }

  /** 火のついた炉を1つ作って返す（火口・火起こし具・着火まで済ませる）。 */
  function litCampfire(): WorldObject {
    const hearth = spawnInto('campfire', land, 'fixtures');
    stoke(hearth, 'thick_branch');

    const grass = spawnInto('dry_grass', land, 'items');
    const drill = spawnInto('fire_drill', player, 'hand');
    expect(grass.tryExecuteCombination(drill, player, 'light', session)).toBe(true);

    const tinder = new Location(land, codex).items.find((o) => o.def.name === 'burning_tinder');
    expect(tinder, '火起こしに成功している').toBeDefined();
    expect(hearth.tryExecuteCombination(tinder!, player, 'ignite', session)).toBe(true);
    return hearth;
  }

  /** 炉へ燃料を1つくべる。 */
  function stoke(hearth: WorldObject, fuelName: string): void {
    const fuel = spawnInto(fuelName, land, 'items');
    expect(hearth.tryExecuteCombination(fuel, player, 'add_fuel', session)).toBe(true);
  }

  it('火起こし具は小枝と太い枝から作れて、解放条件を持たない', () => {
    const drill = codex.objects.get(codex.objectNames.getId('fire_drill'));

    expect(drill.recipes).toHaveLength(1);
    const [step] = drill.recipes[0].steps;
    expect(step.requirements.map((r) => codex.objectNames.getName(r.objectGlobalId)).sort()).toEqual([
      'thick_branch',
      'twig',
    ]);
    // 火スキルが未実装なので、今は誰でも作れる（きりもみ式は道具も紐も要らない）。
    expect(drill.recipes[0].isUnlocked(() => undefined)).toBe(true);
  });

  it('火口に火起こし具を重ねると火種ができ、火口は消える', () => {
    const grass = spawnInto('dry_grass', land, 'items');
    const drill = spawnInto('fire_drill', player, 'hand');

    expect(grass.tryExecuteCombination(drill, player, 'light', session)).toBe(true);

    expect(itemsOn(land)).toEqual(['burning_tinder']);
    expect(drill.parent, '火起こし具は消費されない').toBe(player);
  });

  it('枝は火口にならない（繊維状のものだけが火を受け止める）', () => {
    const twig = spawnInto('twig', land, 'items');
    const drill = spawnInto('fire_drill', player, 'hand');

    expect(twig.findMatchingCombinations(drill), '小枝と火起こし具は組み合わない').toEqual([]);
  });

  it('ヤシの実の皮と植物繊維も火口になる', () => {
    const tinderTag = codex.tagNames.getId('tinder');
    for (const name of ['dry_grass', 'coconut_husk', 'plant_fiber']) {
      expect(codex.objects.get(codex.objectNames.getId(name)).tags, `${name}は火口`).toContain(tinderTag);
    }
  });

  it('薪をくべると炉の薪が増え、燃料そのものは残らない', () => {
    const hearth = spawnInto('campfire', land, 'fixtures');

    stoke(hearth, 'thick_branch');

    expect(numberOf(hearth, 'fuel'), '太い枝1本ぶん').toBe(20);
    expect(itemsOn(land), '燃料は消える').toEqual([]);
  });

  it('薪を組んだだけの炉は火が消えたままで、薪も減らない', () => {
    const hearth = spawnInto('campfire', land, 'fixtures');
    stoke(hearth, 'thick_branch');

    session.advanceWorldTime(60 * 4);

    expect(heatIs(hearth, 'out'), '火は消えたまま').toBe(true);
    expect(numberOf(hearth, 'fuel'), '火がつくまで薪は減らない').toBe(20);
  });

  it('薪の無い炉には火種を落とせない', () => {
    const hearth = spawnInto('campfire', land, 'fixtures');
    const tinder = spawnInto('burning_tinder', land, 'items');

    expect(hearth.tryExecuteCombination(tinder, player, 'ignite', session)).toBe(false);
    expect(heatIs(hearth, 'out'), '火は消えたまま').toBe(true);
  });

  it('着火が置くのは種火だけで、そこから薪が火を育てる', () => {
    const hearth = litCampfire();

    expect(heatIs(hearth, 'ember'), '落とした直後は種火').toBe(true);

    session.advanceWorldTime(60);
    expect(heatIs(hearth, 'flame'), '1時間で炎まで育つ').toBe(true);
  });

  it('薪が尽きると火は衰え、種火を経て死ぬ', () => {
    const hearth = litCampfire();
    session.advanceWorldTime(60);
    expect(heatIs(hearth, 'flame')).toBe(true);

    // 太い枝1本（20）を炎（-1.5/tick）で食い尽くし、そこから冷めきるまで進める。
    session.advanceWorldTime(60 * 12);

    expect(numberOf(hearth, 'fuel')).toBe(0);
    expect(heatIs(hearth, 'out'), '薪も種火も尽きた').toBe(true);
  });

  it('焚き火は薪を積めるだけ積んでも高温には届かない', () => {
    const hearth = litCampfire();
    stoke(hearth, 'thick_branch'); // 上限の30まで積む
    session.advanceWorldTime(60 * 3);

    expect(numberOf(hearth, 'heat'), '火力の上限で頭打ちになる').toBe(30);
    expect(heatIs(hearth, 'flame'), '開いた焚き火は炎まで').toBe(true);
    expect(heatIs(hearth, 'blaze'), '本焼きの高温には届かない').toBe(false);
  });

  it('石囲いの炉は薪を多く積めるので、本焼きの高温へ届く', () => {
    const hearth = spawnInto('stone_hearth', land, 'fixtures');
    for (let i = 0; i < 6; i++) stoke(hearth, 'thick_branch');
    expect(numberOf(hearth, 'fuel')).toBe(120);

    hearth.setNumber(codex.propertyNames.getId('heat'), 1, session);
    session.advanceWorldTime(60 * 6);

    expect(heatIs(hearth, 'blaze'), '土器の本焼きに要る高温').toBe(true);
  });

  it('満杯の炉にはくべられない', () => {
    const hearth = spawnInto('campfire', land, 'fixtures');
    stoke(hearth, 'thick_branch');
    stoke(hearth, 'thick_branch');
    expect(numberOf(hearth, 'fuel')).toBe(30);

    const extra = spawnInto('thick_branch', land, 'items');
    expect(hearth.tryExecuteCombination(extra, player, 'add_fuel', session)).toBe(false);
    expect(extra.parent, 'くべられなかった薪は手元に残る').toBe(land);
  });

  it('火にかけた生肉は焼けた肉になり、放っておくと焦げる', () => {
    const hearth = litCampfire();
    const meat = spawnInto('raw_meat', land, 'items');
    expect(meat.moveToSlot(hearth, codex.slotNames.getId('fire'))).toBeUndefined();

    session.advanceWorldTime(60 * 3);
    expect(new Location(land, codex).fixtures[0].def.name).toBe('campfire');
    expect(childNames(hearth), '焼き上がりは同じ枠に残る').toEqual(['roasted_meat']);

    session.advanceWorldTime(60 * 3);
    expect(childNames(hearth), '出し忘れると焦げる').toEqual(['charred_lump']);
  });

  /** 炉のfireスロットに入っている物の型名。 */
  function childNames(hearth: WorldObject): string[] {
    const slot = hearth.tryGetSlot(codex.slotNames.getId('fire'));
    return (slot?.contents ?? []).map((object) => object.def.name);
  }

  it('石を3つ積むと三石のかまど、さらに8つで石囲いの炉になる', () => {
    let hearth = spawnInto('campfire', land, 'fixtures');

    for (let i = 0; i < 3; i++) {
      const stone = spawnInto('stone', land, 'items');
      expect(hearth.tryExecuteCombination(stone, player, 'add_stone', session)).toBe(true);
    }
    hearth = new Location(land, codex).fixtures[0];
    expect(hearth.def.name).toBe('three_stone_hearth');

    for (let i = 0; i < 8; i++) {
      const stone = spawnInto('stone', land, 'items');
      expect(hearth.tryExecuteCombination(stone, player, 'add_stone', session)).toBe(true);
    }
    expect(new Location(land, codex).fixtures[0].def.name).toBe('stone_hearth');
  });

  it('炉の段が上がるほど、火にかけられる枠が増える', () => {
    const cellCount = (hearthName: string): number | undefined =>
      codex.objects.get(codex.objectNames.getId(hearthName)).getSlotDef(codex.slotNames.getId('fire'))
        ?.cellCount;

    // 焚き火の2枠は焼く物だけ。三石は器の枠が1つ、石囲いは2つ増える（1.1節）。
    expect(cellCount('campfire')).toBe(2);
    expect(cellCount('three_stone_hearth')).toBe(3);
    expect(cellCount('stone_hearth')).toBe(5);
  });
});
