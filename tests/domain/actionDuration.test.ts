import { describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { World } from '../../src/domain/wrappers/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * actions/combinationsのduration（実行にかかるゲーム内時間・分）に対する自動テスト。durationを持つ操作を
 * 実行すると、効果の適用に**先立って**WorldSession.advanceWorldTimeで相当分だけ時間が進む（tick境界を
 * 跨げばpassivesも動く）。時間進行まで含めて定義側（InteractionDef）が行うため、呼び出し側
 * （UI等）は実行後に別途時間を進める必要がない。順序と、経過中に関与オブジェクトが失われた場合の
 * 扱いはActionSystem.mdを参照。
 */
describe('アクションのduration', () => {
  const worldYaml = `
object_defs:
  world:
    singleton: true
    props:
      tick:
        value: 0
        passives:
          - add:
              self:
                tick: 1
      minutes_per_tick:
        value: 15
      minute:
        value: 0
        range: {min: 0, max: 60}
        on_max:
          add:
            self:
              minute: -60
              hour: 1
      hour:
        value: 0
        range: {min: 0, max: 24}
        on_max:
          add:
            self:
              hour: -24
              day: 1
      day:
        value: 1
    slots:
      stuff: {}
`;

  function buildWorldSession(extraYaml: string): { codex: WorldCodex; session: WorldSession; world: World } {
    const codex = new WorldCodexYamlLoader()
      .load('world.yaml', worldYaml)
      .load('extra.yaml', extraYaml)
      .buildAndReset();
    const bootstrap = new WorldSession(codex);
    const instance = new WorldObject(1, codex.objects.get(codex.objectNames.getId('world')), bootstrap);
    const world = new World(instance, codex);
    const session = new WorldSession(codex, world);
    return { codex, session, world };
  }

  it('リテラルdurationは効果の適用前に世界時間を進める', () => {
    const { codex, session, world } = buildWorldSession(`
object_defs:
  campfire:
    props:
      warmth:
        value: 0
    interactions:
      rest:
        trigger: menu
        duration: 30
        add:
          self:
            warmth: 1
`);
    const campfire = session.createObject(codex.objectNames.getId('campfire'));
    campfire.moveToSlotOrRejection(world.instance.getSlot(codex.slotNames.getId('stuff')));

    const executed = campfire.tryGetAction('rest', undefined)?.tryExecute() === true;

    expect(executed).toBe(true);
    expect(
      campfire.tryGetProperty(codex.propertyNames.getId('warmth'))?.number ?? 0,
      '効果は適用される',
    ).toBe(1);
    expect(world.minute, 'duration分だけ時間が進む').toBe(30);
    expect(
      world.instance.tryGetProperty(codex.propertyNames.getId('tick'))?.number ?? 0,
      '15分tickを2回跨ぐ',
    ).toBe(2);
  });

  it('プロパティ参照durationはselfのプロパティを読む', () => {
    const { codex, session, world } = buildWorldSession(`
object_defs:
  trail:
    props:
      travel_minutes:
        value: 45
    interactions:
      travel:
        trigger: menu
        duration: {prop: travel_minutes}
`);
    const trail = session.createObject(codex.objectNames.getId('trail'));
    trail.moveToSlotOrRejection(world.instance.getSlot(codex.slotNames.getId('stuff')));

    expect(trail.tryGetAction('travel', undefined)?.tryExecute() === true).toBe(true);
    expect(world.minute, 'self.travel_minutesの値だけ時間が進む').toBe(45);
  });

  it('参照先がbaseで担ぎ手の遅れを継いでいれば、足された時間だけ進む', () => {
    // 合成はduration側ではなく参照先のプロパティで済ませる（GameElementDefinition.md 11.3節）。
    const { codex, session, world } = buildWorldSession(`
object_defs:
  hiker:
    props:
      travel_delay:
        value: 20
  trail:
    props:
      travel_minutes:
        value: 20
        base: {subject: agent, prop: travel_delay}
    interactions:
      travel:
        trigger: menu
        duration: {prop: travel_minutes}
`);
    const trail = session.createObject(codex.objectNames.getId('trail'));
    const hiker = session.createObject(codex.objectNames.getId('hiker'));
    trail.moveToSlotOrRejection(world.instance.getSlot(codex.slotNames.getId('stuff')));

    expect(trail.tryGetAction('travel', hiker)?.tryExecute() === true).toBe(true);
    expect(world.minute, 'self.travel_minutes + agent.travel_delay だけ進む').toBe(40);
  });

  it('土台が辿り着かなければ、道は素の長さのまま', () => {
    const { codex, session, world } = buildWorldSession(`
object_defs:
  # travel_delayを持たない担ぎ手。土台が辿り着かない。
  ghost: {}
  trail:
    props:
      travel_minutes:
        value: 45
        base: {subject: agent, prop: travel_delay}
    interactions:
      travel:
        trigger: menu
        duration: {prop: travel_minutes}
`);
    const trail = session.createObject(codex.objectNames.getId('trail'));
    const ghost = session.createObject(codex.objectNames.getId('ghost'));
    trail.moveToSlotOrRejection(world.instance.getSlot(codex.slotNames.getId('stuff')));

    expect(trail.tryGetAction('travel', ghost)?.tryExecute() === true).toBe(true);
    expect(world.minute, '土台の寄与は0で、自分の値だけが残る（6.5節）').toBe(45);
  });

  it('durationはagentのプロパティを単独でも読める', () => {
    const { codex, session, world } = buildWorldSession(`
object_defs:
  hiker:
    props:
      rest_minutes:
        value: 20
  hammock:
    interactions:
      nap:
        trigger: menu
        duration: {subject: agent, prop: rest_minutes}
`);
    const hammock = session.createObject(codex.objectNames.getId('hammock'));
    const hiker = session.createObject(codex.objectNames.getId('hiker'));
    hammock.moveToSlotOrRejection(world.instance.getSlot(codex.slotNames.getId('stuff')));

    expect(hammock.tryGetAction('nap', hiker)?.tryExecute() === true).toBe(true);
    expect(world.minute, 'agent.rest_minutesの値だけ時間が進む').toBe(20);
  });

  it('durationに掛ける相手は書けない（リテラルか{subject, prop}参照かの二択）', () => {
    expect(() =>
      new WorldCodexYamlLoader()
        .load(
          'extra.yaml',
          `
object_defs:
  trail:
    props:
      travel_minutes:
        value: 45
    interactions:
      travel:
        trigger: menu
        duration: {prop: travel_minutes, times: {subject: agent, prop: travel_delay}}
`,
        )
        .buildAndReset(),
    ).toThrowError(/未知のキー 'times'/);
  });

  it('条件不成立の場合は時間を消費しない', () => {
    const { codex, session, world } = buildWorldSession(`
object_defs:
  campfire:
    props:
      warmth:
        value: 0
    interactions:
      rest:
        trigger: menu
        duration: 30
        conditions:
          - {prop: warmth, gt: 10}
`);
    const campfire = session.createObject(codex.objectNames.getId('campfire'));
    campfire.moveToSlotOrRejection(world.instance.getSlot(codex.slotNames.getId('stuff')));

    expect(campfire.tryGetAction('rest', undefined)?.tryExecute() === true).toBe(false);
    expect(world.minute, '条件不成立なら時間は進まない').toBe(0);
  });

  it('combinationのdurationも効果の適用前に世界時間を進める', () => {
    const { codex, session, world } = buildWorldSession(`
object_defs:
  hammer:
    tags: [hammer]
  nut:
    props:
      cracked:
        value: 0
    interactions:
      crack:
        trigger: {drag: {tag: hammer}}
        duration: 20
        add:
          self:
            cracked: 1
`);
    const nut = session.createObject(codex.objectNames.getId('nut'));
    const hammer = session.createObject(codex.objectNames.getId('hammer'));
    nut.moveToSlotOrRejection(world.instance.getSlot(codex.slotNames.getId('stuff')));

    expect(
      nut
        .combinationsWith(hammer, undefined)
        .find((c) => c.name === 'crack')
        ?.tryExecute() === true,
    ).toBe(true);

    expect(nut.tryGetProperty(codex.propertyNames.getId('cracked'))?.number ?? 0, '効果は適用される').toBe(1);
    expect(world.minute, 'duration分だけ時間が進む').toBe(20);
  });

  it('combinationの参照durationはinstrumentのプロパティも読める', () => {
    const { codex, session, world } = buildWorldSession(`
object_defs:
  blunt_hammer:
    tags: [hammer]
    props:
      swing_minutes:
        value: 35
  nut:
    interactions:
      crack:
        trigger: {drag: {tag: hammer}}
        duration: {subject: instrument, prop: swing_minutes}
`);
    const nut = session.createObject(codex.objectNames.getId('nut'));
    const hammer = session.createObject(codex.objectNames.getId('blunt_hammer'));
    nut.moveToSlotOrRejection(world.instance.getSlot(codex.slotNames.getId('stuff')));

    expect(
      nut
        .combinationsWith(hammer, undefined)
        .find((c) => c.name === 'crack')
        ?.tryExecute() === true,
    ).toBe(true);
    expect(world.minute, 'instrument.swing_minutesの値だけ時間が進む').toBe(35);
  });

  it('生成物は自分の制作時間ぶんのtickを浴びない（時間が先に経つため）', () => {
    const { codex, session, world } = buildWorldSession(`
object_defs:
  # 生成された瞬間からtickごとに古びていくもの。
  bread:
    props:
      staleness:
        value: 0
        passives:
          - add:
              self:
                staleness: 1
  oven:
    interactions:
      bake:
        trigger: menu
        duration: 60
        spawn: {object: bread, into: self}
    slots:
      output: {}
`);
    const oven = session.createObject(codex.objectNames.getId('oven'));
    oven.moveToSlotOrRejection(world.instance.getSlot(codex.slotNames.getId('stuff')));

    expect(oven.tryGetAction('bake', undefined)?.tryExecute() === true).toBe(true);

    expect(
      world.instance.tryGetProperty(codex.propertyNames.getId('tick'))?.number ?? 0,
      '60分＝4tick経つ',
    ).toBe(4);
    const bread = oven.tryGetSlot(codex.slotNames.getId('output'))?.contents[0];
    expect(bread, '焼き上がったパンが出力スロットに入る').toBeDefined();
    expect(
      bread?.tryGetProperty(codex.propertyNames.getId('staleness'))?.number ?? 0,
      '焼き上がったばかりなので、焼いていた1時間ぶんは古びていない',
    ).toBe(0);
  });

  it('経過中に関与オブジェクトが壊れたら、効果は適用されない（時間は経つ）', () => {
    const { codex, session, world } = buildWorldSession(`
object_defs:
  statue: {}
  # tickごとにすり減り、0になった時点で壊れる石。
  crumbling_stone:
    props:
      durability:
        value: 2
        range: {min: 0, max: 10}
        on_min:
          destroy: self
        passives:
          - add:
              self:
                durability: -1
    interactions:
      carve:
        trigger: menu
        duration: 30
        spawn: {object: statue}
`);
    const stone = session.createObject(codex.objectNames.getId('crumbling_stone'));
    const stuffSlotId = codex.slotNames.getId('stuff');
    stone.moveToSlotOrRejection(world.instance.getSlot(stuffSlotId));

    expect(stone.tryGetAction('carve', undefined)?.tryExecute() === true, '行動は成立しない').toBe(false);

    expect(world.minute, '時間は経過している（1時間かけて道具が壊れた）').toBe(30);
    expect(stone.parent, '石は経過中に壊れて世界から外れている').toBeUndefined();
    expect(
      world.instance.tryGetSlot(stuffSlotId)?.contents.map((object) => object.def.name),
      '彫像は生成されない（黙って消えるのではなく、そもそも作られない）',
    ).toEqual([]);
  });

  it('combinationでは、ドラッグされた側が壊れた場合も効果は適用されない', () => {
    const { codex, session, world } = buildWorldSession(`
object_defs:
  # 使うそばからすり減る道具。
  crumbling_chisel:
    tags: [chisel]
    props:
      durability:
        value: 1
        range: {min: 0, max: 10}
        on_min:
          destroy: self
        passives:
          - add:
              self:
                durability: -1
  block:
    props:
      carved:
        value: 0
    interactions:
      carve:
        trigger: {drag: {tag: chisel}}
        duration: 30
        add:
          self:
            carved: 1
`);
    const block = session.createObject(codex.objectNames.getId('block'));
    const chisel = session.createObject(codex.objectNames.getId('crumbling_chisel'));
    const stuffSlotId = codex.slotNames.getId('stuff');
    for (const object of [block, chisel]) {
      expect(object.moveToSlotOrRejection(world.instance.getSlot(stuffSlotId))).toBeUndefined();
    }

    expect(
      block
        .combinationsWith(chisel, undefined)
        .find((c) => c.name === 'carve')
        ?.tryExecute() === true,
    ).toBe(false);

    expect(chisel.parent, 'ノミは経過中に壊れて世界から外れている').toBeUndefined();
    expect(block.tryGetProperty(codex.propertyNames.getId('carved'))?.number ?? 0, '彫りは入らない').toBe(0);
    expect(world.minute, '時間は経過している').toBe(30);
  });

  it('Worldを持たないセッションでは時間進行をスキップする', () => {
    // Worldを持たないセッション（時間の概念が無いテスト文脈）でも、durationつきアクションは
    // 例外を出さずに効果だけを適用する。
    const codex = new WorldCodexYamlLoader()
      .load(
        'extra.yaml',
        `
object_defs:
  campfire:
    props:
      warmth:
        value: 0
    interactions:
      rest:
        trigger: menu
        duration: 30
        add:
          self:
            warmth: 1
`,
      )
      .buildAndReset();
    const session = new WorldSession(codex);
    const campfire = session.createObject(codex.objectNames.getId('campfire'));

    expect(campfire.tryGetAction('rest', undefined)?.tryExecute() === true).toBe(true);
    expect(campfire.tryGetProperty(codex.propertyNames.getId('warmth'))?.number ?? 0).toBe(1);
  });
});
