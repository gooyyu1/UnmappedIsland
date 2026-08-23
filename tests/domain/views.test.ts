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
    return new WorldCodexYamlLoader().load('core.yaml', yaml).build();
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

    const world = new World(instance, codex);

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

    const world = new World(instance, codex);

    expect(world.minute).toBe(40);
    expect(world.weather, '天気の語彙を持たないCodex').toBeUndefined();
  });

  it('PlayerCharacterはhpとsatietyを公開する', () => {
    const yaml = `
object_defs:
  character:
    props:
      hp:
        value: 100
      satiety:
        value: 50
`;
    const codex = load(yaml);
    const instance = new WorldObject(
      1,
      codex.objects.get(codex.objectNames.getId('character')),
      new WorldSession(codex),
    );

    const actor = new PlayerCharacter(instance, codex);

    expect(actor.hp).toBe(100);
    expect(actor.satiety).toBe(50);
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
    const stone = session.spawn(codex.objectNames.getId('stone'));
    stone.moveToSlot(instance.getSlot(codex.slotNames.getId('hand')));

    const actor = new PlayerCharacter(instance, codex);

    expect(actor.hand).toEqual([stone, undefined, undefined]);
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

    expect(new PlayerCharacter(instance, codex).hand).toEqual([]);
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
    const clearing = session.spawn(codex.objectNames.getId('clearing'));
    const instance = session.spawn(codex.objectNames.getId('character'));
    const actor = new PlayerCharacter(instance, codex);

    expect(actor.location).toBeUndefined();

    instance.moveToSlot(clearing.getSlot(codex.slotNames.getId('characters')));

    expect(actor.location?.instance).toBe(clearing);
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
    const clearing = session.spawn(codex.objectNames.getId('clearing'));
    const instance = session.spawn(codex.objectNames.getId('character'));
    const actor = new PlayerCharacter(instance, codex);

    expect(actor.explore(), '土地に居なければ探索できない').toBe(false);

    instance.moveToSlot(clearing.getSlot(codex.slotNames.getId('characters')));

    expect(actor.explore()).toBe(true);
    expect(new Location(clearing, codex).explorationProgress, '今いる土地の進捗が進む').toBe(1);
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

    const location = new Location(instance, codex);

    expect(location.instance).toBe(instance);
  });
});
