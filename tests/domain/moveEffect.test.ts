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
        cell: {accept: {tag: location}}

  meadow:
    traits: [location]
    props:
      dummy:
        value: 0
    slots:
      characters:
        cell: {accept: {tag: character}}
      stuff: {}

  hilltop:
    traits: [location]
    slots:
      characters:
        cell: {accept: {tag: character}}
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
          subject: actor
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
    expect(meadow.moveToSlot(world, locationsId)).toBeUndefined();
    expect(hilltop.moveToSlot(world, locationsId)).toBeUndefined();
    expect(character.moveToSlot(meadow, codex.slotNames.getId('characters'))).toBeUndefined();
    expect(path.moveToSlot(meadow, codex.slotNames.getId('stuff'))).toBeUndefined();

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

  it('draggedをselfの中へ移す（かごへ入れるcombination）', () => {
    const codex = new WorldCodexYamlLoader()
      .load(
        'containers.yaml',
        `
object_defs:
  world:
    singleton: true
    slots:
      stuff:
        cell: {accept: {tag: item}}

  stone:
    tags: [item]

  basket:
    tags: [item]
    combinations:
      put_in:
        with: {tag: item}
        move: {subject: dragged, to: self}
    slots:
      contents:
        cell: {accept: {tag: item}}
`,
      )
      .build();

    const session = new WorldSession(codex);
    const world = session.spawn(codex.objectNames.getId('world'));
    const stuffSlot = codex.slotNames.getId('stuff');
    const basket = session.spawn(codex.objectNames.getId('basket'));
    const stone = session.spawn(codex.objectNames.getId('stone'));
    for (const item of [basket, stone]) {
      expect(item.moveToSlot(world, stuffSlot)).toBeUndefined();
    }

    expect(basket.tryExecuteCombination(stone, undefined, 'put_in', session)).toBe(true);

    expect(stone.parent, 'draggedがかごの中へ移る').toBe(basket);
    expect(stone.parentSlotLocalId, '宣言順走査でcontentsスロットへ入る').toBe(
      basket.def.slotLayout.toLocal(codex.slotNames.getId('contents')),
    );
  });

  it('入れ物を自分自身や自分の中身の中へは入れられない', () => {
    const codex = new WorldCodexYamlLoader()
      .load(
        'containers.yaml',
        `
object_defs:
  world:
    singleton: true
    slots:
      stuff:
        cell: {accept: {tag: item}}

  basket:
    tags: [item]
    combinations:
      put_in:
        with: {tag: item}
        move: {subject: dragged, to: self}
    slots:
      contents:
        cell: {accept: {tag: item}}
`,
      )
      .build();

    const session = new WorldSession(codex);
    const world = session.spawn(codex.objectNames.getId('world'));
    const stuffSlot = codex.slotNames.getId('stuff');
    const outer = session.spawn(codex.objectNames.getId('basket'));
    const inner = session.spawn(codex.objectNames.getId('basket'));
    expect(outer.moveToSlot(world, stuffSlot)).toBeUndefined();
    expect(inner.moveToSlot(world, stuffSlot)).toBeUndefined();

    // かご同士も入れ子にできる。
    expect(outer.tryExecuteCombination(inner, undefined, 'put_in', session)).toBe(true);
    expect(inner.parent, '内側のかごが外側のかごへ入る').toBe(outer);

    // 逆向き（外側を、その中に入っている内側へ）は輪ができるので弾く。
    expect(inner.tryExecuteCombination(outer, undefined, 'put_in', session)).toBe(true);
    expect(outer.parent, '自分の中身の中へは入らない').toBe(world);
    expect(inner.parent, '相手も動かない').toBe(outer);

    // 自分自身の中へも入らない。
    expect(outer.tryExecuteCombination(outer, undefined, 'put_in', session)).toBe(true);
    expect(outer.parent, '自分自身の中へは入らない').toBe(world);
  });

  it('moveのobjectにactor以外を指定するとロードエラーになる', () => {
    const loadBad = (): WorldCodex =>
      new WorldCodexYamlLoader()
        .load(
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
          subject: self
          to_prop: destination_id
`,
        )
        .build();

    expect(loadBad).toThrow(YamlLoadError);
    expect(loadBad).toThrowError(/actor/);
  });

  it('moveの移動先をtoとto_propの両方で指定するとロードエラーになる', () => {
    const loadBad = (): WorldCodex =>
      new WorldCodexYamlLoader()
        .load(
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
          subject: actor
          to: self
          to_prop: destination_id
`,
        )
        .build();

    expect(loadBad).toThrow(YamlLoadError);
    expect(loadBad).toThrowError(/どちらか一方/);
  });

  it('moveのtoにself/parent以外を指定するとロードエラーになる', () => {
    const loadBad = (): WorldCodex =>
      new WorldCodexYamlLoader()
        .load(
          'bad.yaml',
          `
object_defs:
  basket:
    actions:
      travel:
        move: {subject: actor, to: ancestor}
`,
        )
        .build();

    expect(loadBad).toThrow(YamlLoadError);
    expect(loadBad).toThrowError(/'self'か'parent'/);
  });

  it('to: parentは、宣言元ではなくその親の中へ移す', () => {
    // 代表(represented_by)へリダイレクトされた中身が、自分ではなく容器を行き先にするケース
    // （液体の注ぎ移し、LiquidContainerSystem.md 4節）。
    const codex = new WorldCodexYamlLoader()
      .load(
        'jar.yaml',
        `
object_defs:
  jar:
    slots:
      content:
        cell: {accept: {tag: liquid}}
  water:
    tags: [liquid]
    combinations:
      pour_in:
        with: {tag: liquid}
        move: {subject: dragged, to: parent}
`,
      )
      .build();
    const session = new WorldSession(codex);

    const jar = session.spawn(codex.objectNames.getId('jar'));
    const receiver = session.spawn(codex.objectNames.getId('water'));
    const poured = session.spawn(codex.objectNames.getId('water'));
    const contentId = codex.slotNames.getId('content');
    expect(receiver.moveToSlot(jar, contentId)).toBeUndefined();

    expect(receiver.tryExecuteCombination(poured, undefined, 'pour_in', session)).toBe(true);

    expect(poured.parent, '宣言元(receiver)ではなく、その親である容器へ入る').toBe(jar);
  });

  it('moveに未知のキーがあるとロードエラーになる', () => {
    const loadBad = (): WorldCodex =>
      new WorldCodexYamlLoader()
        .load(
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
          subject: actor
          to_prop: destination_id
          into: characters
`,
        )
        .build();

    expect(loadBad).toThrow(YamlLoadError);
    expect(loadBad).toThrowError(/未知のキー/);
  });

  it('on_shortfall内のmoveはロードエラーになる', () => {
    const loadBad = (): WorldCodex =>
      new WorldCodexYamlLoader()
        .load(
          'bad.yaml',
          `
object_defs:
  bomb:
    props:
      fuse:
        value: 1
        range: {min: 0, max: 10}
        on_shortfall:
          move:
            subject: actor
            to_prop: fuse
`,
        )
        .build();

    expect(loadBad).toThrow(YamlLoadError);
  });
});
