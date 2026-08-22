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
 * weaving.yamlのヤシの葉を編む連鎖を、実ファイルの定義だけで検証する。
 * 葉を採り、素手または刃物で編み、編んだ葉から籠を作るところまで。
 */
describe('weaving.yamlのヤシの葉を編む連鎖', () => {
  let codex: WorldCodex;
  let session: WorldSession;
  let worldView: World;
  let beach: WorldObject;
  let player: WorldObject;

  beforeAll(() => {
    // 葉を採るヤシの木（coconut.yaml）・刃物（tools.yaml）・土地（locations.yaml）への
    // ファイルをまたぐ参照があるため、ディレクトリ全体を一括ロードする。
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
  });

  beforeEach(() => {
    const worldInstance = new WorldObject(
      0,
      codex.objects.get(codex.objectNames.getId('world')),
      new WorldSession(codex),
    );
    worldView = new World(worldInstance, codex);
    // 葉採りは確率で捻挫する（injuries.yaml）。ここは加工の連鎖を見るテストなので、必ず成功する側を引く。
    session = new WorldSession(codex, worldView, fixedRng(0));

    beach = spawnInto('sandy_beach', worldInstance, 'locations');
    player = spawnInto(SAMPLE_CHARACTER, beach, 'characters');
  });

  function spawnInto(objectName: string, parent: WorldObject, slotName: string): WorldObject {
    const spawned = session.spawn(codex.objectNames.getId(objectName));
    expect(spawned.moveToSlot(parent.getSlot(codex.slotNames.getId(slotName)))).toBeUndefined();
    return spawned;
  }

  function itemsOn(location: WorldObject): string[] {
    return new Location(location, codex).items.map((object) => object.def.name);
  }

  function handOf(character: WorldObject): string[] {
    return new PlayerCharacter(character, codex).handStacks.flatMap((stack) =>
      stack.map((object) => object.def.name),
    );
  }

  /** 土地のitemsスロットに並ぶ物の重さ（g）。 */
  function weightsOn(location: WorldObject): number[] {
    const weightId = codex.propertyNames.getId('weight');
    return new Location(location, codex).items.map((object) => object.tryGetProperty(weightId)?.number ?? 0);
  }

  it('ヤシの木から葉を採ると、1回でまとめて手に入る', () => {
    const tree = spawnInto('palm_tree', beach, 'fixtures');

    expect(tree.tryGetAction('pick_frond', player)?.tryExecute() === true).toBe(true);

    expect(handOf(player)).toEqual(['palm_frond', 'palm_frond', 'palm_frond']);
    expect(tree.parent, 'ヤシの木は残る').toBe(beach);
    expect(worldView.minute, 'durationの30分が経つ').toBe(30);
  });

  it('素手で編むと、葉1枚から編んだ葉が1枚できる', () => {
    const frond = spawnInto('palm_frond', beach, 'items');

    expect(frond.tryGetAction('weave', player)?.tryExecute() === true).toBe(true);

    expect(itemsOn(beach)).toEqual(['woven_leaf']);
    expect(weightsOn(beach), '重さの大半を占める中軸を捨てるので、葉4000gより軽くなる').toEqual([400]);
    expect(worldView.hour, '素手は時間がかかる（90分）').toBe(1);
    expect(worldView.minute).toBe(30);
  });

  it('刃物を当てて割って編むと、同じ葉から2枚とれる', () => {
    const frond = spawnInto('palm_frond', beach, 'items');
    const knife = spawnInto('sharp_stone', player, 'hand');

    expect(
      frond
        .combinationsWith(knife, player)
        .find((c) => c.name === 'split_and_weave')
        ?.tryExecute() === true,
    ).toBe(true);

    expect(itemsOn(beach), '元の葉が居た場所へ2枚が並んで置き換わる').toEqual(['woven_leaf', 'woven_leaf']);
    expect(weightsOn(beach), '2枚に増えても1枚ぶんの重さは変わらない').toEqual([400, 400]);
    expect(knife.parent, '刃物は消費されない').toBe(player);
    expect(worldView.hour, '割って編むほうが1枚あたりは速い（60分で2枚）').toBe(1);
    expect(worldView.minute).toBe(0);
  });

  it('編み籠のレシピは編んだ葉を6枚要求し、解放条件を持たない', () => {
    const basket = codex.objects.get(codex.objectNames.getId('woven_basket'));

    expect(basket.recipes).toHaveLength(1);

    const recipe = basket.recipes[0];
    expect(recipe.steps).toHaveLength(1);

    const [requirement] = recipe.steps[0].requirements;
    expect(requirement.requires(codex.objects.get(codex.objectNames.getId('woven_leaf')))).toBe(true);
    expect(requirement.count).toBe(6);
    expect(requirement.consume).toBe(true);

    // 繊維・編みスキルが未実装なので、今は誰でも作れる（containers.yamlのコメント参照）。
    expect(recipe.unmetUnlockRequirement(() => undefined)).toBeUndefined();
  });
});
