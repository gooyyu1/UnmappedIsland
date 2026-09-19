import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Rng } from '../../src/domain/Rng';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { Location } from '../../src/domain/wrappers/Location';
import { PlayerCharacter } from '../../src/domain/wrappers/PlayerCharacter';
import { World } from '../../src/domain/wrappers/World';
import { fixedRng } from '../support/rng';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';
import { makeBrightEnoughForAnyAction } from '../support/illumination';

/**
 * fiber.yamlの繊維の連鎖を、実ファイルの定義だけで検証する。
 * 草を切り倒し、茎から繊維を掻き取り、撚って糸・紐にし、ロープのレシピへ届くところまで。
 */
describe('fiber.yamlの繊維を撚る連鎖', () => {
  let codex: WorldCodex;
  let session: WorldSession;
  let worldView: World;
  let jungle: WorldObject;
  let player: WorldObject;

  beforeAll(() => {
    // 刃物（tools.yaml）・土地（locations.yaml）へのファイルをまたぐ参照があるため、
    // ディレクトリ全体を一括ロードする。
    codex = bundledCodex();
  });

  beforeEach(() => {
    buildWorld(fixedRng(0));
  });

  /**
   * 土地1つと作業者1人だけの世界を組む。**引く先を名指ししたいテストが引数で乱数源を渡す**
   * ——余分の卓（無駄の無さ）は同じ引きでも腕で結果が変わるので、引きを固定しないと差が読めない。
   */
  function buildWorld(rng: Rng): void {
    session = new WorldSession(codex, undefined, rng);
    const worldInstance = session.createObject(codex.objectNames.getId('world'));
    worldView = new World(worldInstance);
    session.adoptWorld(worldView);

    jungle = spawnInto('jungle', worldInstance, 'locations');
    player = spawnInto(SAMPLE_CHARACTER, jungle, 'characters');
    // 刈るのも掻き取るのも撚るのも明るさを要求する（IlluminationSystem.md 5節）。ここで見たいのは
    // 繊維の連鎖なので、時刻や光源を組み立てずに作業者の側で明るさを満たす。
    makeBrightEnoughForAnyAction(player, codex);
  }

  function spawnInto(objectName: string, parent: WorldObject, slotName: string): WorldObject {
    const spawned = session.createObject(codex.objectNames.getId(objectName));
    expect(spawned.moveToSlotOrRejection(parent.getSlot(codex.slotNames.getId(slotName)))).toBeUndefined();
    return spawned;
  }

  function itemsOn(location: WorldObject): string[] {
    return new Location(location).items.map((object) => object.def.name);
  }

  function carriedBy(character: WorldObject): string[] {
    return new PlayerCharacter(character).handStacks.flatMap((stack) =>
      stack.map((object) => object.def.name),
    );
  }

  /** 土地のitemsスロットに並ぶ物の重さ（g）。 */
  function weightsOn(location: WorldObject): number[] {
    const weightId = codex.propertyNames.getId('weight');
    return new Location(location).items.map((object) => object.tryGetProperty(weightId)?.number ?? 0);
  }

  /** 刃物を1本持たせる。 */
  function armPlayer(): WorldObject {
    return spawnInto('sharp_stone', player, 'hand');
  }

  it('アバカは刃物で切り倒すと消え、茎だけがまとめて採れる', () => {
    const plant = spawnInto('abaca', jungle, 'fixtures');
    const knife = armPlayer();

    expect(
      plant
        .combinationsWith(knife, player)
        .find((c) => c.name === 'fell')
        ?.tryExecute() === true,
    ).toBe(true);

    expect(carriedBy(player).filter((name) => name === 'banana_stem')).toHaveLength(5);
    expect(carriedBy(player), '実は付かない').not.toContain('banana');
    expect(plant.parent, '切り倒した株は残らない').toBeUndefined();
    expect(knife.parent, '刃物は消費されない').toBe(player);
  });

  it('バナナの株は切り倒すと、実と茎が一度に採れる', () => {
    const plant = spawnInto('banana_plant', jungle, 'fixtures');
    const knife = armPlayer();

    expect(
      plant
        .combinationsWith(knife, player)
        .find((c) => c.name === 'fell')
        ?.tryExecute() === true,
    ).toBe(true);

    const carried = carriedBy(player);
    expect(carried.filter((name) => name === 'banana')).toHaveLength(2);
    expect(
      carried.filter((name) => name === 'banana_stem'),
      'アバカ（5本）より少ない',
    ).toHaveLength(2);
    expect(plant.parent).toBeUndefined();
  });

  it('素手では切り倒せない', () => {
    const plant = spawnInto('abaca', jungle, 'fixtures');

    expect(
      plant.combinationsWith(player, player).map((c) => c.name),
      '刃物以外を当てても組み合わせは成立しない',
    ).toEqual([]);
    expect(plant.parent).toBe(jungle);
  });

  it('茎から繊維を掻き取ると、水と髄を捨てるぶん軽くなる', () => {
    const stem = spawnInto('banana_stem', jungle, 'items');
    const knife = armPlayer();

    expect(
      stem
        .combinationsWith(knife, player)
        .find((c) => c.name === 'strip')
        ?.tryExecute() === true,
    ).toBe(true);

    expect(itemsOn(jungle), '元の茎が居た場所へ3束が並んで置き換わる').toEqual([
      'plant_fiber',
      'plant_fiber',
      'plant_fiber',
    ]);
    expect(weightsOn(jungle), '茎3000gのうち、繊維として残るのは60g×3だけ').toEqual([60, 60, 60]);
    expect(worldView.minute, 'durationの30分が経つ').toBe(30);
  });

  it('掻き取りの腕が上がると、同じ茎からもう1束落ちる', () => {
    // 無駄の無さ（docs/world/Skills.md 7節）。取れない側の重み（100）は茎が持ち、取れる側の重みが
    // 作り手の上乗せなので、**素人では2つ目の候補が卓に無いのと同じ**。引きを固定してあるので、
    // 結果が変わったのは卓が腕を読んでいるからだと言える。
    //
    // **足す束は1つで、素の3束の1/3に収まる**（同7.2節）。上限そのものは世界じゅうの卓を走査する
    // skillsYaml.test.ts が見張っていて、ここが見るのは腕を読んでいることのほう。
    const skillId = codex.propertyNames.getId('skill_cordage');

    /** その腕前の作業者に1本掻き取らせて、土地に残った物を返す。 */
    const strippedBy = (skillValue: number): string[] => {
      // 取れる側（上乗せ60）へ落ちる引き。素人では卓の合計が100なので、同じ引きが取れない側に留まる。
      buildWorld(fixedRng(0.9));
      player.getProperty(skillId).setNumberWithoutEvents(skillValue);
      const stem = spawnInto('banana_stem', jungle, 'items');
      expect(
        stem
          .combinationsWith(armPlayer(), player)
          .find((c) => c.name === 'strip')
          ?.tryExecute() === true,
      ).toBe(true);
      return itemsOn(jungle);
    };

    expect(strippedBy(0), '素人は3束のまま').toEqual(['plant_fiber', 'plant_fiber', 'plant_fiber']);
    expect(strippedBy(180), '熟達すると余分が1束').toEqual([
      'plant_fiber',
      'plant_fiber',
      'plant_fiber',
      'plant_fiber',
    ]);
  });

  it('繊維2束を撚ると糸が1本できる（道具は要らない）', () => {
    const first = spawnInto('plant_fiber', jungle, 'items');
    const second = spawnInto('plant_fiber', jungle, 'items');

    expect(
      first
        .combinationsWith(second, player)
        .find((c) => c.name === 'spin')
        ?.tryExecute() === true,
    ).toBe(true);

    expect(itemsOn(jungle)).toEqual(['yarn']);
    expect(weightsOn(jungle), '繊維60g×2から、撚りきれない屑20gが落ちる').toEqual([100]);
  });

  it('糸2本を撚り合わせると紐が1本できる（重さは保存する）', () => {
    const first = spawnInto('yarn', jungle, 'items');
    const second = spawnInto('yarn', jungle, 'items');

    expect(
      first
        .combinationsWith(second, player)
        .find((c) => c.name === 'ply')
        ?.tryExecute() === true,
    ).toBe(true);

    expect(itemsOn(jungle)).toEqual(['cord']);
    expect(weightsOn(jungle), '糸100g×2がそのまま紐200gになる').toEqual([200]);
  });

  it('ロープのレシピは紐を3本要求し、解放条件を持たない', () => {
    const rope = codex.objects.get(codex.objectNames.getId('rope'));

    expect(rope.recipesProducingThis).toHaveLength(1);

    const recipe = rope.recipesProducingThis[0];
    expect(recipe.steps).toHaveLength(1);

    const [requirement] = recipe.steps[0].requirements;
    expect(requirement.requires(codex.objects.get(codex.objectNames.getId('cord')))).toBe(true);
    expect(requirement.count).toBe(3);
    expect(requirement.consume).toBe(true);

    // **中間素材なので誰でも作れる**（SkillSystem.md 4.2節）。紐3本を撚る手間がゲートで、
    // そこへ腕を重ねると二重になる。
    expect(recipe.unlock).toBeUndefined();
  });
});
