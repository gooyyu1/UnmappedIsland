import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { Location } from '../../src/domain/views/Location';
import { PlayerCharacter } from '../../src/domain/views/PlayerCharacter';
import { World } from '../../src/domain/views/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { fixedRng } from '../support/rng';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

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
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
  });

  beforeEach(() => {
    const worldInstance = new WorldObject(
      0,
      codex.objects.get(codex.objectNames.getId('world')),
      new WorldSession(codex),
    );
    worldView = new World(worldInstance, codex);
    session = new WorldSession(codex, worldView, fixedRng(0));

    jungle = spawnInto('jungle', worldInstance, 'locations');
    player = spawnInto(SAMPLE_CHARACTER, jungle, 'characters');
  });

  function spawnInto(objectName: string, parent: WorldObject, slotName: string): WorldObject {
    const spawned = session.spawn(codex.objectNames.getId(objectName));
    expect(spawned.moveToSlot(parent.getSlot(codex.slotNames.getId(slotName)))).toBeUndefined();
    return spawned;
  }

  function itemsOn(location: WorldObject): string[] {
    return new Location(location, codex).items.map((object) => object.def.name);
  }

  function carriedBy(character: WorldObject): string[] {
    return new PlayerCharacter(character, codex).handStacks.flatMap((stack) =>
      stack.map((object) => object.def.name),
    );
  }

  /** 土地のitemsスロットに並ぶ物の重さ（g）。 */
  function weightsOn(location: WorldObject): number[] {
    const weightId = codex.propertyNames.getId('weight');
    return new Location(location, codex).items.map((object) => object.tryGetProperty(weightId)?.number ?? 0);
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

    expect(plant.combinationsWith(player, player), '刃物以外を当てても組み合わせは成立しない').toEqual([]);
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

    expect(itemsOn(jungle), '元の茎が居た場所へ2束が並んで置き換わる').toEqual([
      'plant_fiber',
      'plant_fiber',
    ]);
    expect(weightsOn(jungle), '茎3000gのうち、繊維として残るのは60g×2だけ').toEqual([60, 60]);
    expect(worldView.minute, 'durationの30分が経つ').toBe(30);
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

    expect(rope.recipes).toHaveLength(1);

    const recipe = rope.recipes[0];
    expect(recipe.steps).toHaveLength(1);

    const [requirement] = recipe.steps[0].requirements;
    expect(requirement.requires(codex.objects.get(codex.objectNames.getId('cord')))).toBe(true);
    expect(requirement.count).toBe(3);
    expect(requirement.consume).toBe(true);

    // 繊維・編みスキルが未実装なので、今は誰でも作れる（fiber.yamlのコメント参照）。
    expect(recipe.unmetUnlockRequirement(() => undefined)).toBeUndefined();
  });
});
