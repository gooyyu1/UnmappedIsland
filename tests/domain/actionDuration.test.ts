import { describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { World } from '../../src/domain/runtime/views/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * actions/combinationsのduration（実行にかかるゲーム内時間・分）に対する自動テスト。durationを持つ操作を
 * 実行すると、効果の適用に**先立って**WorldSession.advanceWorldTimeで相当分だけ時間が進む（tick境界を
 * 跨げばpassivesも動く）。時間進行まで含めて定義側（ActionDef/CombinationDef）が行うため、呼び出し側
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
          - accumulate:
              self:
                tick: 1
      minutes_per_tick:
        value: 15
      minute:
        value: 0
        range: {min: 0, max: 59}
        on_overflow:
          add:
            self:
              minute: -60
              hour: 1
      hour:
        value: 0
        range: {min: 0, max: 23}
        on_overflow:
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
      .build();
    const bootstrap = new WorldSession(codex);
    const instance = new WorldObject(1, codex.objects.get(codex.objectNames.getId('world')), bootstrap);
    const world = new World(instance, codex.propertyNames, codex.symbolNames);
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
    actions:
      rest:
        duration: 30
        add:
          self:
            warmth: 1
`);
    const campfire = session.spawn(codex.objectNames.getId('campfire'));
    campfire.moveToSlot(world.instance, codex.slotNames.getId('stuff'));

    const executed = campfire.tryExecuteAction('rest', undefined, session);

    expect(executed).toBe(true);
    expect(campfire.getNumber(codex.propertyNames.getId('warmth')), '効果は適用される').toBe(1);
    expect(world.minute, 'duration分だけ時間が進む').toBe(30);
    expect(world.instance.getNumber(codex.propertyNames.getId('tick')), '15分tickを2回跨ぐ').toBe(2);
  });

  it('プロパティ参照durationはselfのプロパティを読む', () => {
    const { codex, session, world } = buildWorldSession(`
object_defs:
  trail:
    props:
      travel_minutes:
        value: 45
    actions:
      travel:
        duration: {prop: travel_minutes}
`);
    const trail = session.spawn(codex.objectNames.getId('trail'));
    trail.moveToSlot(world.instance, codex.slotNames.getId('stuff'));

    expect(trail.tryExecuteAction('travel', undefined, session)).toBe(true);
    expect(world.minute, 'self.travel_minutesの値だけ時間が進む').toBe(45);
  });

  it('条件不成立の場合は時間を消費しない', () => {
    const { codex, session, world } = buildWorldSession(`
object_defs:
  campfire:
    props:
      warmth:
        value: 0
    actions:
      rest:
        duration: 30
        conditions:
          - {prop: warmth, gt: 10}
`);
    const campfire = session.spawn(codex.objectNames.getId('campfire'));
    campfire.moveToSlot(world.instance, codex.slotNames.getId('stuff'));

    expect(campfire.tryExecuteAction('rest', undefined, session)).toBe(false);
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
    combinations:
      crack:
        with: hammer
        duration: 20
        add:
          self:
            cracked: 1
`);
    const nut = session.spawn(codex.objectNames.getId('nut'));
    const hammer = session.spawn(codex.objectNames.getId('hammer'));
    nut.moveToSlot(world.instance, codex.slotNames.getId('stuff'));

    expect(nut.tryExecuteCombination(hammer, undefined, 'crack', session)).toBe(true);

    expect(nut.getNumber(codex.propertyNames.getId('cracked')), '効果は適用される').toBe(1);
    expect(world.minute, 'duration分だけ時間が進む').toBe(20);
  });

  it('combinationの参照durationはdraggedのプロパティも読める', () => {
    const { codex, session, world } = buildWorldSession(`
object_defs:
  blunt_hammer:
    tags: [hammer]
    props:
      swing_minutes:
        value: 35
  nut:
    combinations:
      crack:
        with: hammer
        duration: {object: dragged, prop: swing_minutes}
`);
    const nut = session.spawn(codex.objectNames.getId('nut'));
    const hammer = session.spawn(codex.objectNames.getId('blunt_hammer'));
    nut.moveToSlot(world.instance, codex.slotNames.getId('stuff'));

    expect(nut.tryExecuteCombination(hammer, undefined, 'crack', session)).toBe(true);
    expect(world.minute, 'dragged.swing_minutesの値だけ時間が進む').toBe(35);
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
          - accumulate:
              self:
                staleness: 1
  oven:
    actions:
      bake:
        duration: 60
        spawn: {object: bread, into: self}
    slots:
      output: {}
`);
    const oven = session.spawn(codex.objectNames.getId('oven'));
    oven.moveToSlot(world.instance, codex.slotNames.getId('stuff'));

    expect(oven.tryExecuteAction('bake', undefined, session)).toBe(true);

    expect(world.instance.getNumber(codex.propertyNames.getId('tick')), '60分＝4tick経つ').toBe(4);
    const bread = oven.tryGetSlot(codex.slotNames.getId('output'))?.contents[0];
    expect(bread, '焼き上がったパンが出力スロットに入る').toBeDefined();
    expect(
      bread?.getNumber(codex.propertyNames.getId('staleness')),
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
        range: {min: 1, max: 10}
        on_shortfall:
          destroy: self
        passives:
          - accumulate:
              self:
                durability: -1
    actions:
      carve:
        duration: 30
        spawn: {object: statue}
`);
    const stone = session.spawn(codex.objectNames.getId('crumbling_stone'));
    const stuffSlotId = codex.slotNames.getId('stuff');
    stone.moveToSlot(world.instance, stuffSlotId);

    expect(stone.tryExecuteAction('carve', undefined, session), '行動は成立しない').toBe(false);

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
        range: {min: 1, max: 10}
        on_shortfall:
          destroy: self
        passives:
          - accumulate:
              self:
                durability: -1
  block:
    props:
      carved:
        value: 0
    combinations:
      carve:
        with: chisel
        duration: 30
        add:
          self:
            carved: 1
`);
    const block = session.spawn(codex.objectNames.getId('block'));
    const chisel = session.spawn(codex.objectNames.getId('crumbling_chisel'));
    const stuffSlotId = codex.slotNames.getId('stuff');
    for (const object of [block, chisel]) {
      expect(object.moveToSlot(world.instance, stuffSlotId)).toBeUndefined();
    }

    expect(block.tryExecuteCombination(chisel, undefined, 'carve', session)).toBe(false);

    expect(chisel.parent, 'ノミは経過中に壊れて世界から外れている').toBeUndefined();
    expect(block.getNumber(codex.propertyNames.getId('carved')), '彫りは入らない').toBe(0);
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
    actions:
      rest:
        duration: 30
        add:
          self:
            warmth: 1
`,
      )
      .build();
    const session = new WorldSession(codex);
    const campfire = session.spawn(codex.objectNames.getId('campfire'));

    expect(campfire.tryExecuteAction('rest', undefined, session)).toBe(true);
    expect(campfire.getNumber(codex.propertyNames.getId('warmth'))).toBe(1);
  });
});
