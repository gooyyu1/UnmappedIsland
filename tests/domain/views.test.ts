import { describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { Location } from '../../src/domain/wrappers/Location';
import { PlayerCharacter } from '../../src/domain/wrappers/PlayerCharacter';
import { World } from '../../src/domain/wrappers/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * World/PlayerCharacter/Location（Views）に対する自動テスト。ラップ対象のWorldObjectが実際に持つ
 * プロパティを、コンストラクタで解決したグローバルIDを通じて正しく読めることだけを確認する。
 */
describe('World/PlayerCharacter/Locationビュー', () => {
  function load(yaml: string): WorldCodex {
    return new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();
  }

  it('Worldはday/hour/minute/weatherを公開する', () => {
    const yaml = `
object_defs:
  world:
    singleton: true
    props:
      day:
        value: 3
      hour:
        value: 8
      minute:
        value: 30
      minutes_per_tick:
        value: 15
      weather:
        value: light_rain
`;
    const codex = load(yaml);
    const instance = new WorldObject(
      1,
      codex.objects.get(codex.objectNames.getId('world')),
      new WorldSession(codex),
    );

    const world = new World(instance);

    expect(world.day).toBe(3);
    expect(world.hour).toBe(8);
    expect(world.minute).toBe(30);
    expect(world.weather, 'シンボル型なので、値のIDではなく名前が返る').toBe('light_rain');
    expect(world.instance).toBe(instance);
  });

  it('Worldはmodify passivesを反映した値を返す(実体値そのままではない)', () => {
    const yaml = `
object_defs:
  world:
    singleton: true
    props:
      day:
        value: 3
      hour:
        value: 8
      minute:
        value: 30
      minutes_per_tick:
        value: 15
    passives:
      - modify:
          self:
            minute: 10
`;
    const codex = load(yaml);
    const instance = new WorldObject(
      1,
      codex.objects.get(codex.objectNames.getId('world')),
      new WorldSession(codex),
    );

    const world = new World(instance);

    expect(world.minute).toBe(40);
    expect(world.weather, '天気の語彙を持たないCodex').toBeUndefined();
  });

  it('PlayerCharacterのhandは固定枠の空きセルをundefinedとして並べる', () => {
    const yaml = `
object_defs:
  stone:
    tags: [item]
  character:
    slots:
      hand:
        cell: {accept: {tag: item}}
        cell_count: 3
`;
    const codex = load(yaml);
    const session = new WorldSession(codex);
    const instance = new WorldObject(1, codex.objects.get(codex.objectNames.getId('character')), session);
    const stone = session.createObject(codex.objectNames.getId('stone'));
    stone.moveToSlotOrRejection(instance.getSlot(codex.slotNames.getId('hand')));

    const agent = new PlayerCharacter(instance);

    expect(agent.hand).toEqual([stone, undefined, undefined]);
  });

  // 枠ごとに分けて返す口も、Slotが並びで返す口と同じく写し（SlotSystem.md 1節）。実体（ObjectStack.members）
  // をそのまま渡すと、受け取った側が後で読み返したときに顔ぶれが変わっている。
  it('PlayerCharacterのhandStacksは読んだ時点の写しで、後の出入りに影響されない', () => {
    const yaml = `
object_defs:
  stone:
    tags: [item]
  character:
    slots:
      hand:
        cell: {accept: {tag: item}}
        cell_count: 3
`;
    const codex = load(yaml);
    const session = new WorldSession(codex);
    const instance = new WorldObject(1, codex.objects.get(codex.objectNames.getId('character')), session);
    const hand = instance.getSlot(codex.slotNames.getId('hand'));
    const stone = session.createObject(codex.objectNames.getId('stone'));
    stone.moveToSlotOrRejection(hand);

    const stacks = new PlayerCharacter(instance).handStacks;
    session.createObject(codex.objectNames.getId('stone')).moveToSlotOrRejection(hand);

    expect(stacks[0], '読んだ後に同じ枠へ合流したものは、写しには現れない').toEqual([stone]);
  });

  it('PlayerCharacterのhandはhandスロットを持たないCodexでも空配列を返す', () => {
    const yaml = `
object_defs:
  character: {}
`;
    const codex = load(yaml);
    const instance = new WorldObject(
      1,
      codex.objects.get(codex.objectNames.getId('character')),
      new WorldSession(codex),
    );

    expect(new PlayerCharacter(instance).hand).toEqual([]);
  });

  it('PlayerCharacterのlocationは自分が入っている土地を返す', () => {
    const yaml = `
object_defs:
  character:
    tags: [character]
  clearing:
    slots:
      characters:
        cell: {accept: {tag: character}}
`;
    const codex = load(yaml);
    const session = new WorldSession(codex);
    const clearing = session.createObject(codex.objectNames.getId('clearing'));
    const instance = session.createObject(codex.objectNames.getId('character'));
    const agent = new PlayerCharacter(instance);

    expect(agent.location).toBeUndefined();

    instance.moveToSlotOrRejection(clearing.getSlot(codex.slotNames.getId('characters')));

    expect(agent.location?.instance).toBe(clearing);
  });

  it('PlayerCharacterのexploreは今いる土地を探索する', () => {
    const yaml = `
object_defs:
  character:
    tags: [character]
  clearing:
    props:
      exploration_progress:
        value: 0
        range: {min: 0, max: 2}
    slots:
      characters:
        cell: {accept: {tag: character}}
    interactions:
      explore:
        trigger: menu
        add:
          self:
            exploration_progress: 1
`;
    const codex = load(yaml);
    const session = new WorldSession(codex);
    const clearing = session.createObject(codex.objectNames.getId('clearing'));
    const instance = session.createObject(codex.objectNames.getId('character'));
    const agent = new PlayerCharacter(instance);

    expect(agent.explore(), '土地に居なければ探索できない').toBe(false);

    instance.moveToSlotOrRejection(clearing.getSlot(codex.slotNames.getId('characters')));

    expect(agent.explore()).toBe(true);
    expect(new Location(clearing).explorationProgress, '今いる土地の進捗が進む').toBe(1);
  });

  it('Locationはどのプロパティも要求せずinstanceをラップする', () => {
    const yaml = `
object_defs:
  forest_clearing: {}
`;
    const codex = load(yaml);
    const instance = new WorldObject(
      1,
      codex.objects.get(codex.objectNames.getId('forest_clearing')),
      new WorldSession(codex),
    );

    const location = new Location(instance);

    expect(location.instance).toBe(instance);
  });
});
