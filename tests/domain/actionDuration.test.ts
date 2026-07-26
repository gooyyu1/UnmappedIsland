import { describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { World } from '../../src/domain/runtime/views/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * アクションのduration（実行にかかるゲーム内時間・分）に対する自動テスト。durationを持つアクションを実行
 * すると、効果の適用後にWorldSession.advanceWorldTimeで相当分だけ時間が進む（tick境界を跨げばpassivesも
 * 動く）。時間進行まで含めてActionDef自身が行うため、呼び出し側（UI等）は実行後に別途時間を進める必要が
 * ない。
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
    const world = new World(instance, codex.propertyNames);
    const session = new WorldSession(codex, world);
    return { codex, session, world };
  }

  it('リテラルdurationは効果の適用後に世界時間を進める', () => {
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
    campfire.moveToSlot(world.instance, codex.slotNames.getId('stuff'), codex.wellKnown);

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
    trail.moveToSlot(world.instance, codex.slotNames.getId('stuff'), codex.wellKnown);

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
          - {prop: warmth, op: gt, value: 10}
`);
    const campfire = session.spawn(codex.objectNames.getId('campfire'));
    campfire.moveToSlot(world.instance, codex.slotNames.getId('stuff'), codex.wellKnown);

    expect(campfire.tryExecuteAction('rest', undefined, session)).toBe(false);
    expect(world.minute, '条件不成立なら時間は進まない').toBe(0);
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
