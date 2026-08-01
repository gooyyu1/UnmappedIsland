import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { Location } from '../../src/domain/runtime/views/Location';
import { PlayerCharacter } from '../../src/domain/runtime/views/PlayerCharacter';
import { World } from '../../src/domain/runtime/views/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * coconut.yamlのヤシの実の加工の連鎖を、実ファイルの定義だけで検証する。
 * ヤシの木から実を採り、皮をはぎ、穴を開け、割り、果肉を掻き出すまでを一続きで通す。
 */
describe('coconut.yamlのヤシの実の加工', () => {
  let codex: WorldCodex;
  let session: WorldSession;
  let worldView: World;
  let beach: WorldObject;
  let player: WorldObject;

  beforeAll(() => {
    // 刃物（tools.yaml）・土地（locations.yaml）・殻の容器（liquid_containers.yaml）への
    // ファイルをまたぐ参照があるため、ディレクトリ全体を一括ロードする。
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
  });

  beforeEach(() => {
    const worldInstance = new WorldObject(
      0,
      codex.objects.get(codex.objectNames.getId('world')),
      new WorldSession(codex),
    );
    worldView = new World(worldInstance, codex.propertyNames);
    session = new WorldSession(codex, worldView);

    beach = spawnInto('sandy_beach', worldInstance, 'locations');
    player = spawnInto('character', beach, 'characters');
  });

  function spawnInto(objectName: string, parent: WorldObject, slotName: string): WorldObject {
    const spawned = session.spawn(codex.objectNames.getId(objectName));
    expect(spawned.moveToSlot(parent, codex.slotNames.getId(slotName), codex.wellKnown)).toBeUndefined();
    return spawned;
  }

  /** 土地のitemsスロットに並ぶ物の識別子。 */
  function itemsOn(location: WorldObject): string[] {
    return new Location(location, codex).items.map((object) => object.def.name);
  }

  /** 手持ちに並ぶ物の識別子（同種のスタックは個数ぶん並べる）。 */
  function handOf(character: WorldObject): string[] {
    return new PlayerCharacter(character, codex).handStacks.flatMap((stack) =>
      stack.map((object) => object.def.name),
    );
  }

  /** 道具を手に取り、対象のカードへドラッグしてcombinationを1つ実行する。 */
  function combine(target: WorldObject, toolName: string, combinationName: string): void {
    const tool = spawnInto(toolName, player, 'hand');
    expect(target.tryExecuteCombination(tool, player, combinationName, session)).toBe(true);
    expect(tool.parent, '道具は消費されない').toBe(player);
  }

  it('ヤシの木から実を採ると、手持ちにヤシの実が増える', () => {
    const tree = spawnInto('palm_tree', beach, 'fixtures');

    expect(tree.tryExecuteAction('pick_coconut', player, session)).toBe(true);

    expect(handOf(player)).toEqual(['coconut']);
    expect(tree.parent, 'ヤシの木は残る').toBe(beach);
    expect(worldView.hour, 'durationの30分が経つ').toBe(0);
    expect(worldView.minute).toBe(30);
  });

  it('ヤシの実に刃物を当てると、皮を剥いだ実と皮に分かれる', () => {
    const coconut = spawnInto('coconut', beach, 'items');

    combine(coconut, 'sharp_stone', 'husk');

    expect(itemsOn(beach), '連鎖を継ぐ実は、元の実が居た場所へ置き換わる').toEqual(['husked_coconut']);
    expect(handOf(player), '副産物の皮はactorの手元へ入る').toEqual(['sharp_stone', 'coconut_husk']);
  });

  it('皮を剥いだ実に刃物を当てると、穴が開く', () => {
    const husked = spawnInto('husked_coconut', beach, 'items');

    combine(husked, 'sharp_stone', 'bore');

    expect(itemsOn(beach)).toEqual(['holed_coconut']);
  });

  it.each([
    ['stone', 'crack'],
    ['sharp_stone', 'pry_open'],
  ])('穴を開けた実は%sで割れ、割れた実が2つできる', (toolName, combinationName) => {
    const holed = spawnInto('holed_coconut', beach, 'items');

    combine(holed, toolName, combinationName);

    expect(itemsOn(beach), '割れた実は両方ともactorの手元へ入る').toEqual([]);
    expect(handOf(player)).toEqual([toolName, 'coconut_half', 'coconut_half']);
  });

  it('割れた実に刃物を当てると、果肉が採れて殻が残る', () => {
    const half = spawnInto('coconut_half', beach, 'items');

    combine(half, 'sharp_stone', 'scrape');

    expect(itemsOn(beach), '殻は割れた実が居た場所へ置き換わる').toEqual(['coconut_bowl']);
    expect(handOf(player)).toEqual(['sharp_stone', 'coconut_meat']);
  });

  it('ヤシの殻は液体を入れられ、持ち歩ける', () => {
    const bowl = spawnInto('coconut_bowl', player, 'hand');
    const water = session.spawn(codex.objectNames.getId('water_liquid'));

    expect(water.moveToSlot(bowl, codex.slotNames.getId('content'), codex.wellKnown)).toBeUndefined();
    expect(handOf(player), '手持ちのaccepts（itemタグ）を通る').toEqual(['coconut_bowl']);
  });

  it('果肉を食べると満腹度・水分・栄養が増え、果肉は無くなる', () => {
    const meat = spawnInto('coconut_meat', player, 'hand');
    const satietyId = codex.propertyNames.getId('satiety');
    const hydrationId = codex.propertyNames.getId('hydration');
    const nutritionId = codex.propertyNames.getId('vegetable_nutrition');
    for (const id of [satietyId, hydrationId, nutritionId]) player.setProperty(id, 0);

    expect(meat.tryExecuteAction('eat', player, session)).toBe(true);

    expect(player.getNumber(satietyId)).toBe(6);
    expect(player.getNumber(hydrationId)).toBe(480);
    expect(player.getNumber(nutritionId)).toBe(2500);
    expect(meat.parent, '食べた果肉は消える').toBeUndefined();
  });

  it('生のヤシの実は食べられない（連鎖を通さないと栄養にならない）', () => {
    const coconut = spawnInto('coconut', player, 'hand');

    expect(coconut.tryExecuteAction('eat', player, session)).toBe(false);
  });
});
