import { describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
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
    tags: [item]
    props:
      destination_id:
        value: 0
      loot_target:
        value: 0
      travel_minutes:
        value: 60
    slots:
      spoils: {}
    interactions:
      travel:
        trigger: menu
        move:
          subject: actor
          to_prop: destination_id
      walk_away:
        trigger: menu
        move:
          subject: self
          to_prop: destination_id
      snatch:
        trigger: menu
        move:
          subject_prop: loot_target
          to: self
      # 行き先の枠を名指しする（to_slot）。charactersが先に受け取れるが、そちらへは入らない。
      shove:
        trigger: menu
        move:
          subject: actor
          to_prop: destination_id
          to_slot: stuff
      # 型で行き先を指す（to_object）。singletonなので、生成時に確定するIDを知らなくても指せる。
      sail:
        trigger: menu
        move:
          - {subject: actor, to: self}
          - {subject: self, to_object: hilltop}
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

    const world = session.createObject(codex.objectNames.getId('world'));
    const meadow = session.createObject(codex.objectNames.getId('meadow'));
    const hilltop = session.createObject(codex.objectNames.getId('hilltop'));
    const character = session.createObject(codex.objectNames.getId('character'));
    const path = session.createObject(codex.objectNames.getId('path'));

    const locationsId = codex.slotNames.getId('locations');
    expect(meadow.moveToSlotOrRejection(world.getSlot(locationsId))).toBeUndefined();
    expect(hilltop.moveToSlotOrRejection(world.getSlot(locationsId))).toBeUndefined();
    expect(
      character.moveToSlotOrRejection(meadow.getSlot(codex.slotNames.getId('characters'))),
    ).toBeUndefined();
    expect(path.moveToSlotOrRejection(meadow.getSlot(codex.slotNames.getId('stuff')))).toBeUndefined();

    return { codex, session, world, meadow, hilltop, character, path };
  }

  it('actorを移動先のcharactersスロットへ移す', () => {
    const { codex, meadow, hilltop, character, path } = build();
    path.getProperty(codex.propertyNames.getId('destination_id')).setNumberWithoutEvents(hilltop.instanceId);

    expect(path.tryGetAction('travel', character)?.tryExecute() === true).toBe(true);

    expect(character.parent, 'actorは移動先ロケーションへ移る').toBe(hilltop);
    expect(
      character.parentSlot?.def.globalId,
      'acceptsのタグ判定により、宣言順走査でcharactersスロットへ振り分けられる',
    ).toBe(codex.slotNames.getId('characters'));
    expect(
      meadow.tryGetSlot(codex.slotNames.getId('characters'))!.contents,
      '元のロケーションからは居なくなる',
    ).not.toContain(character);
  });

  it('to_slotは、宣言順の走査ではなく名指しした枠へ入れる', () => {
    const { codex, hilltop, character, path } = build();
    path.getProperty(codex.propertyNames.getId('destination_id')).setNumberWithoutEvents(hilltop.instanceId);

    expect(path.tryGetAction('shove', character)?.tryExecute() === true).toBe(true);

    expect(character.parent).toBe(hilltop);
    expect(character.parentSlot?.def.globalId, 'charactersが先に受け取れるが、名指しのstuffへ入る').toBe(
      codex.slotNames.getId('stuff'),
    );
  });

  it('to_objectは、その型のインスタンスを行き先にする（moveを並べて2つ動かす）', () => {
    const { codex, hilltop, character, path } = build();
    // pathはmeadowのstuffスロットに居る。sailはactorを自分の中へ入れ、続けて自分ごとhilltopへ移る
    // ——筏に乗り込んでから漕ぎ出す形（voyage.yamlのset_sail）と同じ2手。
    expect(path.tryGetAction('sail', character)?.tryExecute() === true).toBe(true);

    expect(character.parent, 'actorはpathの中へ入る').toBe(path);
    expect(path.parent, 'pathは型で指した行き先へ移る').toBe(hilltop);
    expect(
      character.findRoot().findSelfOrDescendantOfDef(codex.objectNames.getId('character')),
      '中の物も一緒に運ばれる',
    ).toBe(character);
  });

  it('移動先が解決できない場合は何もしない', () => {
    const { codex, meadow, character, path } = build();
    path.getProperty(codex.propertyNames.getId('destination_id')).setNumberWithoutEvents(9999);

    expect(path.tryGetAction('travel', character)?.tryExecute() === true, 'アクション自体は成立する').toBe(
      true,
    );
    expect(character.parent, '移動先が解決できなければ何も起きない').toBe(meadow);
  });

  it('actorがいない場合は何もしない', () => {
    const { codex, meadow, hilltop, character, path } = build();
    path.getProperty(codex.propertyNames.getId('destination_id')).setNumberWithoutEvents(hilltop.instanceId);

    expect(path.tryGetAction('travel', undefined)?.tryExecute() === true).toBe(true);
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
    interactions:
      put_in:
        trigger: {drag: {tag: item}}
        move: {subject: dragged, to: self}
    slots:
      contents:
        cell: {accept: {tag: item}}
`,
      )
      .build();

    const session = new WorldSession(codex);
    const world = session.createObject(codex.objectNames.getId('world'));
    const stuffSlot = codex.slotNames.getId('stuff');
    const basket = session.createObject(codex.objectNames.getId('basket'));
    const stone = session.createObject(codex.objectNames.getId('stone'));
    for (const item of [basket, stone]) {
      expect(item.moveToSlotOrRejection(world.getSlot(stuffSlot))).toBeUndefined();
    }

    expect(
      basket
        .combinationsWith(stone, undefined)
        .find((c) => c.name === 'put_in')
        ?.tryExecute() === true,
    ).toBe(true);

    expect(stone.parent, 'draggedがかごの中へ移る').toBe(basket);
    expect(stone.parentSlot?.def.globalId, '宣言順走査でcontentsスロットへ入る').toBe(
      codex.slotNames.getId('contents'),
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
    interactions:
      put_in:
        trigger: {drag: {tag: item}}
        move: {subject: dragged, to: self}
    slots:
      contents:
        cell: {accept: {tag: item}}
`,
      )
      .build();

    const session = new WorldSession(codex);
    const world = session.createObject(codex.objectNames.getId('world'));
    const stuffSlot = codex.slotNames.getId('stuff');
    const outer = session.createObject(codex.objectNames.getId('basket'));
    const inner = session.createObject(codex.objectNames.getId('basket'));
    expect(outer.moveToSlotOrRejection(world.getSlot(stuffSlot))).toBeUndefined();
    expect(inner.moveToSlotOrRejection(world.getSlot(stuffSlot))).toBeUndefined();

    // かご同士も入れ子にできる。
    expect(
      outer
        .combinationsWith(inner, undefined)
        .find((c) => c.name === 'put_in')
        ?.tryExecute() === true,
    ).toBe(true);
    expect(inner.parent, '内側のかごが外側のかごへ入る').toBe(outer);

    // 逆向き（外側を、その中に入っている内側へ）は輪ができるので弾く。
    expect(
      inner
        .combinationsWith(outer, undefined)
        .find((c) => c.name === 'put_in')
        ?.tryExecute() === true,
    ).toBe(true);
    expect(outer.parent, '自分の中身の中へは入らない').toBe(world);
    expect(inner.parent, '相手も動かない').toBe(outer);

    // 自分自身の中へも入らない。
    expect(
      outer
        .combinationsWith(outer, undefined)
        .find((c) => c.name === 'put_in')
        ?.tryExecute() === true,
    ).toBe(true);
    expect(outer.parent, '自分自身の中へは入らない').toBe(world);
  });

  it('selfを移動先へ移す（動物が隣の土地へ逃げる1手）', () => {
    // 動かす物が「この効果を宣言したオブジェクト自身」になる形（HuntingSystem.md 5節）。
    const { codex, meadow, hilltop, path } = build();
    path.getProperty(codex.propertyNames.getId('destination_id')).setNumberWithoutEvents(hilltop.instanceId);

    expect(path.tryGetAction('walk_away', undefined)?.tryExecute() === true).toBe(true);

    expect(path.parent, 'self自身が移動先へ移る').toBe(hilltop);
    expect(
      meadow.tryGetSlot(codex.slotNames.getId('stuff'))!.contents,
      '元の土地からは居なくなる',
    ).not.toContain(path);
  });

  it('プロパティが指す個体を移す（動物が足元の物をくわえる1手）', () => {
    // 動かす物も、移動先と同じく「実行時に初めて確定する個体」を指せる（HuntingSystem.md 5節）。
    const { codex, meadow, character, path } = build();
    path.getProperty(codex.propertyNames.getId('loot_target')).setNumberWithoutEvents(character.instanceId);

    expect(path.tryGetAction('snatch', undefined)?.tryExecute() === true).toBe(true);

    expect(character.parent, 'プロパティが指す個体がselfの中へ入る').toBe(path);
    expect(
      meadow.tryGetSlot(codex.slotNames.getId('characters'))!.contents,
      '元の土地からは居なくなる',
    ).not.toContain(character);
  });

  it('subject_propが指す個体が居なければ何もしない', () => {
    const { codex, meadow, character, path } = build();
    path.getProperty(codex.propertyNames.getId('loot_target')).setNumberWithoutEvents(9999);

    expect(path.tryGetAction('snatch', undefined)?.tryExecute() === true, 'アクション自体は成立する').toBe(
      true,
    );
    expect(character.parent, '指す先が居なければ何も起きない').toBe(meadow);
  });

  it('moveのsubjectにchildを指定するとロードエラーになる（どれを動かすかが決まらない）', () => {
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
    interactions:
      travel:
        trigger: menu
        move:
          subject: child
          to_prop: destination_id
`,
        )
        .build();

    expect(loadBad).toThrow(YamlLoadError);
    expect(loadBad).toThrowError(/child/);
  });

  it('moveの動かす物をsubjectとsubject_propの両方で指定するとロードエラーになる', () => {
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
      loot_target:
        value: 0
    interactions:
      travel:
        trigger: menu
        move:
          subject: actor
          subject_prop: loot_target
          to_prop: destination_id
`,
        )
        .build();

    expect(loadBad).toThrow(YamlLoadError);
    expect(loadBad).toThrowError(/どちらか一方/);
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
    interactions:
      travel:
        trigger: menu
        move:
          subject: actor
          to: self
          to_prop: destination_id
`,
        )
        .build();

    expect(loadBad).toThrow(YamlLoadError);
    expect(loadBad).toThrowError(/どれか1つ/);
  });

  it('moveのtoにancestorを指定するとロードエラーになる（プロパティ名を伴わないため）', () => {
    const loadBad = (): WorldCodex =>
      new WorldCodexYamlLoader()
        .load(
          'bad.yaml',
          `
object_defs:
  basket:
    interactions:
      travel:
        trigger: menu
        move: {subject: actor, to: ancestor}
`,
        )
        .build();

    expect(loadBad).toThrow(YamlLoadError);
    expect(loadBad).toThrowError(/ancestor/);
  });

  it('to: parentは、宣言元ではなくその親の中へ移す', () => {
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
    interactions:
      pour_in:
        trigger: {drag: {tag: liquid}}
        move: {subject: dragged, to: parent}
`,
      )
      .build();
    const session = new WorldSession(codex);

    const jar = session.createObject(codex.objectNames.getId('jar'));
    const receiver = session.createObject(codex.objectNames.getId('water'));
    const poured = session.createObject(codex.objectNames.getId('water'));
    const contentId = codex.slotNames.getId('content');
    expect(receiver.moveToSlotOrRejection(jar.getSlot(contentId))).toBeUndefined();

    expect(
      receiver
        .combinationsWith(poured, undefined)
        .find((c) => c.name === 'pour_in')
        ?.tryExecute() === true,
    ).toBe(true);

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
    interactions:
      travel:
        trigger: menu
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

  it('on_min内のmoveはロードエラーになる', () => {
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
        on_min:
          move:
            subject: actor
            to_prop: fuse
`,
        )
        .build();

    expect(loadBad).toThrow(YamlLoadError);
  });
});
