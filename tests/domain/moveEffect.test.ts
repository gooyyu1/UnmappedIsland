import { describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import type { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { YamlLoadError } from '../../src/loader/YamlLoadError';

/**
 * move効果動詞（対象オブジェクトを、selfのプロパティが指すインスタンスIDのオブジェクトの中へ移動する）に
 * 対する自動テスト。道（path）の移動アクションのように、移動先が定義時点ではなく生成時に確定するインスタンス
 * であるケースを想定する。
 */
describe('move効果の実行', () => {
  const islandYaml = `
traits:
  location:
    tags: [location]

object_defs:
  world:
    singleton: true
    slots:
      locations:
        accepts:
          - {tag: location, max: 9999}

  meadow:
    traits: [location]
    props:
      dummy:
        value: 0
    slots:
      characters:
        accepts:
          - {tag: character, max: 9999}
      stuff: {}

  hilltop:
    traits: [location]
    slots:
      characters:
        accepts:
          - {tag: character, max: 9999}
      stuff: {}

  character:
    tags: [character]

  path:
    props:
      destination_id:
        value: 0
      travel_minutes:
        value: 60
    actions:
      travel:
        move:
          object: actor
          to_prop: destination_id
`;

  function build(): {
    codex: WorldCodex;
    session: WorldSession;
    world: WorldObject;
    meadow: WorldObject;
    hilltop: WorldObject;
    character: WorldObject;
    path: WorldObject;
  } {
    const codex = new WorldCodexYamlLoader().load('island.yaml', islandYaml).build();
    const session = new WorldSession(codex);

    const world = session.spawn(codex.objectNames.getId('world'));
    const meadow = session.spawn(codex.objectNames.getId('meadow'));
    const hilltop = session.spawn(codex.objectNames.getId('hilltop'));
    const character = session.spawn(codex.objectNames.getId('character'));
    const path = session.spawn(codex.objectNames.getId('path'));

    const locationsId = codex.slotNames.getId('locations');
    expect(meadow.moveToSlot(world, locationsId, codex.wellKnown)).toBeUndefined();
    expect(hilltop.moveToSlot(world, locationsId, codex.wellKnown)).toBeUndefined();
    expect(character.moveToSlot(meadow, codex.slotNames.getId('characters'), codex.wellKnown)).toBeUndefined();
    expect(path.moveToSlot(meadow, codex.slotNames.getId('stuff'), codex.wellKnown)).toBeUndefined();

    return { codex, session, world, meadow, hilltop, character, path };
  }

  it('actorを移動先のcharactersスロットへ移す', () => {
    const { codex, session, meadow, hilltop, character, path } = build();
    path.setProperty(codex.propertyNames.getId('destination_id'), hilltop.instanceId);

    expect(path.tryExecuteAction('travel', character, session)).toBe(true);

    expect(character.parent, 'actorは移動先ロケーションへ移る').toBe(hilltop);
    expect(
      character.parentSlotLocalId,
      'acceptsのタグ判定により、宣言順走査でcharactersスロットへ振り分けられる',
    ).toBe(hilltop.def.slotLayout.toLocal(codex.slotNames.getId('characters')));
    expect(
      meadow.getSlotByLocalId(meadow.def.slotLayout.toLocal(codex.slotNames.getId('characters'))).contents,
      '元のロケーションからは居なくなる',
    ).not.toContain(character);
  });

  it('移動先が解決できない場合は何もしない', () => {
    const { codex, meadow, character, path, session } = build();
    path.setProperty(codex.propertyNames.getId('destination_id'), 9999);

    expect(path.tryExecuteAction('travel', character, session), 'アクション自体は成立する').toBe(true);
    expect(character.parent, '移動先が解決できなければ何も起きない').toBe(meadow);
  });

  it('actorがいない場合は何もしない', () => {
    const { codex, meadow, hilltop, character, path, session } = build();
    path.setProperty(codex.propertyNames.getId('destination_id'), hilltop.instanceId);

    expect(path.tryExecuteAction('travel', undefined, session)).toBe(true);
    expect(character.parent, 'actorがいない文脈では何も起きない').toBe(meadow);
  });

  it('moveのobjectにactor以外を指定するとロードエラーになる', () => {
    const loadBad = (): WorldCodex =>
      new WorldCodexYamlLoader().load(
        'bad.yaml',
        `
object_defs:
  path:
    props:
      destination_id:
        value: 0
    actions:
      travel:
        move:
          object: self
          to_prop: destination_id
`,
      ).build();

    expect(loadBad).toThrow(YamlLoadError);
    expect(loadBad).toThrowError(/actor/);
  });

  it('moveに未知のキーがあるとロードエラーになる', () => {
    const loadBad = (): WorldCodex =>
      new WorldCodexYamlLoader().load(
        'bad.yaml',
        `
object_defs:
  path:
    props:
      destination_id:
        value: 0
    actions:
      travel:
        move:
          object: actor
          to_prop: destination_id
          into: characters
`,
      ).build();

    expect(loadBad).toThrow(YamlLoadError);
    expect(loadBad).toThrowError(/未知のキー/);
  });

  it('on_min内のmoveはロードエラーになる', () => {
    const loadBad = (): WorldCodex =>
      new WorldCodexYamlLoader().load(
        'bad.yaml',
        `
object_defs:
  bomb:
    props:
      fuse:
        value: 1
        range: {min: 0, max: 10}
        on_min:
          move:
            object: actor
            to_prop: fuse
`,
      ).build();

    expect(loadBad).toThrow(YamlLoadError);
  });
});
