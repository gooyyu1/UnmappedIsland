import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { Location } from '../../src/domain/views/Location';
import { World } from '../../src/domain/views/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { fixedRng } from '../support/rng';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * timber.yamlの伐採を、実ファイルの定義だけで検証する。斧でしか倒せないこと、倒せば丸太が採れること
 * ——石斧から丸太、丸太から筏（voyage.yaml）へ繋がる唯一の経路（docs/world/Voyage.md 1節）。
 */
describe('timber.yamlの伐採', () => {
  let codex: WorldCodex;
  let session: WorldSession;
  let forest: WorldObject;
  let player: WorldObject;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
  });

  beforeEach(() => {
    const worldInstance = new WorldObject(
      0,
      codex.objects.get(codex.objectNames.getId('world')),
      new WorldSession(codex),
    );
    const worldView = new World(worldInstance, codex.propertyNames, codex.symbolNames);
    session = new WorldSession(codex, worldView, fixedRng(0));

    forest = spawnInto('forest', worldInstance, 'locations');
    player = spawnInto(SAMPLE_CHARACTER, forest, 'characters');
  });

  function spawnInto(objectName: string, parent: WorldObject, slotName: string): WorldObject {
    const spawned = session.spawn(codex.objectNames.getId(objectName));
    expect(spawned.moveToSlot(parent, codex.slotNames.getId(slotName))).toBeUndefined();
    return spawned;
  }

  function itemsOn(location: WorldObject): string[] {
    return new Location(location, codex).items.map((object) => object.def.name);
  }

  it('斧で伐り倒すと木が消え、丸太と太い枝が落ちる', () => {
    const tree = spawnInto('broadleaf_tree', forest, 'fixtures');
    const axe = spawnInto('stone_axe', player, 'hand');

    expect(tree.tryExecuteCombination(axe, player, 'fell')).toBe(true);

    const items = itemsOn(forest);
    expect(
      items.filter((name) => name === 'log'),
      '丸太が2本',
    ).toHaveLength(2);
    expect(
      items.filter((name) => name === 'thick_branch'),
      '太い枝も採れる',
    ).toHaveLength(3);
    expect(tree.parent, '倒した木は残らない').toBeUndefined();
    expect(axe.parent, '斧は消費されない').toBe(player);
    expect(axe.getEffectiveValue(codex.propertyNames.getId('durability')), '斧は刃こぼれする').toBeLessThan(
      960,
    );
  });

  it('刃物では伐り倒せない（斧が要る）', () => {
    const tree = spawnInto('broadleaf_tree', forest, 'fixtures');
    spawnInto('sharp_stone', player, 'hand');

    expect(tree.combinationsWith(player, player), '尖った石を当てても成立しない').toEqual([]);
    expect(tree.parent, '木は立ったまま').toBe(forest);
  });

  it('丸太1本は、キャラクタが担げる限界に近い重さ', () => {
    const log = spawnInto('log', forest, 'items');
    const loadId = codex.propertyNames.getId('load');

    expect(log.moveToSlot(player, codex.slotNames.getId('hand'))).toBeUndefined();

    // 1本担いだだけで、荷重の段が「軽い」を外れる（2本目は運べない、docs/world/Voyage.md 1節）。
    expect(player.isInStage(loadId, 'light'), '1本担いだだけで軽い段を外れる').toBe(false);
  });
});
