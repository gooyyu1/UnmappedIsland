import { describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { World } from '../../src/domain/runtime/views/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * WorldSession.advanceWorldTime（tick=15分の時間モデルに対する時間進行ロジック）に対する自動テスト。
 * minuteはtick駆動のaccumulateを持たない（YAML側の自動加算とWorldSessionの加算が二重にならないように
 * するため）。minuteへの加算はすべてWorldSessionが、常にminutes_per_tick以下の小さな量ずつ行う。
 */
describe('WorldSession.advanceWorldTimeによる時間進行', () => {
  function load(yaml: string): WorldCodex {
    return new WorldCodexYamlLoader().load('core.yaml', yaml).build();
  }

  function buildWorld(minutesPerTick = 15): { codex: WorldCodex; world: World } {
    const yaml = `
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
        value: ${minutesPerTick}
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
`;
    const codex = load(yaml);
    const instance = new WorldObject(
      1,
      codex.objects.get(codex.objectNames.getId('world')),
      new WorldSession(codex),
    );
    return { codex, world: new World(instance, codex.propertyNames) };
  }

  it('同一tick内の加算はtickを発火させずamountだけ加算する', () => {
    const { codex, world } = buildWorld();
    const session = new WorldSession(codex, world);
    const tickId = codex.propertyNames.getId('tick');

    session.advanceWorldTime(5);

    expect(world.minute, '15分未満はTickを跨がず、そのまま加算される').toBe(5);
    expect(world.instance.getNumber(tickId)).toBe(0);
  });

  it('tick境界を跨ぐとちょうど1回だけtickが発火し、正しいminuteで終わる', () => {
    // tick内経過分(minute % minutes_per_tick)が5の状態で20分進めると、
    // Tickが1回実行され、tick内経過分は10になる。
    const { codex, world } = buildWorld();
    const session = new WorldSession(codex, world);
    const tickId = codex.propertyNames.getId('tick');

    session.advanceWorldTime(5);
    session.advanceWorldTime(20);

    expect(world.instance.getNumber(tickId), '5+20=25分 -> 15分境界を1回だけ跨ぐ').toBe(1);
    expect(world.minute, 'minuteはtickの回数によらずamountの合計をそのまま反映する').toBe(25);
    expect(world.minute % world.minutesPerTick, 'tick内経過分は10になる').toBe(10);
  });

  it('1回あたりがtick未満の量でも、複数回の呼び出しの累積で境界越えを検知する', () => {
    // 1回あたりの呼び出しがminutes_per_tick未満でも、複数回の呼び出しの累積で境界を跨いだことを
    // 正しく検知できる（tick内経過分をminuteから毎回読み直しているため）。
    const { codex, world } = buildWorld();
    const session = new WorldSession(codex, world);
    const tickId = codex.propertyNames.getId('tick');

    session.advanceWorldTime(10); // tick内経過分は10、まだ境界に届かない
    session.advanceWorldTime(10); // 10+10=20分 -> 15を1回跨ぐ

    expect(world.instance.getNumber(tickId)).toBe(1);
    expect(world.minute).toBe(20);
    expect(world.minute % world.minutesPerTick).toBe(5);
  });

  it('大きな量を一度に進めると複数tickが発火し、hour・dayまで繰り上がる', () => {
    const { codex, world } = buildWorld();
    const session = new WorldSession(codex, world);
    const tickId = codex.propertyNames.getId('tick');
    const dayId = codex.propertyNames.getId('day');

    const minutesPerTick = world.minutesPerTick;

    session.advanceWorldTime(60 * 25); // 25時間分を1回で進める

    expect(world.minute).toBe(0);
    expect(world.hour).toBe(1);
    expect(world.instance.getNumber(dayId)).toBe(2);
    expect(world.instance.getNumber(tickId)).toBe(Math.trunc((60 * 25) / minutesPerTick));
  });

  it('1tickの長さはハードコードではなく設定されたminutes_per_tickに従う', () => {
    // 1tickの長さはworld.minutes_per_tick（core.yaml側）が持つ値であり、WorldSession側に
    // ハードコードされていないことを、15以外の値でも確認する。
    const { codex, world } = buildWorld(20);
    const session = new WorldSession(codex, world);
    const tickId = codex.propertyNames.getId('tick');

    session.advanceWorldTime(25);

    expect(world.instance.getNumber(tickId), 'minutes_per_tickが20なら25分で1tick跨ぐ').toBe(1);
    expect(world.minute % world.minutesPerTick).toBe(5);
  });
});
