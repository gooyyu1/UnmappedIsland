import { describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { Location } from '../../src/domain/runtime/views/Location';
import { PlayerCharacter } from '../../src/domain/runtime/views/PlayerCharacter';
import { World } from '../../src/domain/runtime/views/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * World/PlayerCharacter/Location（Views）に対する自動テスト。ラップ対象のWorldObjectが実際に持つ
 * プロパティを、コンストラクタで解決したグローバルIDを通じて正しく読めることだけを確認する。
 */
describe('World/PlayerCharacter/Locationビュー', () => {
  function load(yaml: string): WorldCodex {
    return new WorldCodexYamlLoader().load('core.yaml', yaml).build();
  }

  it('Worldはday/hour/minuteを公開する', () => {
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
`;
    const codex = load(yaml);
    const instance = new WorldObject(1, codex.objects.get(codex.objectNames.getId('world')), new WorldSession(codex));

    const world = new World(instance, codex.propertyNames);

    expect(world.day).toBe(3);
    expect(world.hour).toBe(8);
    expect(world.minute).toBe(30);
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
    const instance = new WorldObject(1, codex.objects.get(codex.objectNames.getId('world')), new WorldSession(codex));

    const world = new World(instance, codex.propertyNames);

    expect(world.minute).toBe(40);
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

    const actor = new PlayerCharacter(instance, codex.propertyNames);

    expect(actor.hp).toBe(100);
    expect(actor.satiety).toBe(50);
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
