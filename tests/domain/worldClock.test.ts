import { describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { Rng } from '../../src/domain/Rng';
import { WorldSession } from '../../src/domain/WorldSession';
import { World } from '../../src/domain/wrappers/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { HOURS_PER_DAY, MINUTES_PER_HOUR, MINUTES_PER_TICK } from '../../src/domain/worldTime';

/**
 * WorldSession.advanceWorldTime（tick=15分の時間モデルに対する時間進行ロジック）に対する自動テスト。
 * minuteはtick毎のaddを持たない（YAML側の自動加算とWorldSessionの加算が二重にならないように
 * するため）。minuteへの加算はすべてWorldSessionが、常にminutes_per_tick以下の小さな量ずつ行う。
 */
describe('WorldSession.advanceWorldTimeによる時間進行', () => {
  function load(yaml: string): WorldCodex {
    return new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();
  }

  /** 刻みを引数に取るのは、1tickの長さが暦の定数ではなく世界の宣言に従うことを確かめるため。 */
  function buildWorld(minutesPerTick = MINUTES_PER_TICK): {
    codex: WorldCodex;
    session: WorldSession;
    world: World;
  } {
    const yaml = `
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
        value: ${minutesPerTick}
      minute:
        value: 0
        range: {min: 0, max: ${MINUTES_PER_HOUR}}
        on_max:
          add:
            self:
              minute: -${MINUTES_PER_HOUR}
              hour: 1
      hour:
        value: 0
        range: {min: 0, max: ${HOURS_PER_DAY}}
        on_max:
          add:
            self:
              hour: -${HOURS_PER_DAY}
              day: 1
      day:
        value: 1
`;
    const codex = load(yaml);
    const session = new WorldSession(codex);
    const world = new World(session.createObject(codex.objectNames.getId('world')));
    session.adoptWorld(world);
    return { codex, session, world };
  }

  it('同一tick内の加算はtickを発火させずamountだけ加算する', () => {
    const { codex, session, world } = buildWorld();
    const tickId = codex.propertyNames.getId('tick');

    session.advanceWorldTime(5);

    expect(world.minute, '15分未満はTickを跨がず、そのまま加算される').toBe(5);
    expect(world.instance.tryGetProperty(tickId)?.number ?? 0).toBe(0);
  });

  it('tick境界を跨ぐとちょうど1回だけtickが発火し、正しいminuteで終わる', () => {
    // tick内経過分(minute % minutes_per_tick)が5の状態で20分進めると、
    // Tickが1回実行され、tick内経過分は10になる。
    const { codex, session, world } = buildWorld();
    const tickId = codex.propertyNames.getId('tick');

    session.advanceWorldTime(5);
    session.advanceWorldTime(20);

    expect(world.instance.tryGetProperty(tickId)?.number ?? 0, '5+20=25分 -> 15分境界を1回だけ跨ぐ').toBe(1);
    expect(world.minute, 'minuteはtickの回数によらずamountの合計をそのまま反映する').toBe(25);
    expect(world.minute % world.rawMinutesPerTick, 'tick内経過分は10になる').toBe(10);
  });

  it('1回あたりがtick未満の量でも、複数回の呼び出しの累積で境界越えを検知する', () => {
    // 1回あたりの呼び出しがminutes_per_tick未満でも、複数回の呼び出しの累積で境界を跨いだことを
    // 正しく検知できる（tick内経過分をminuteから毎回読み直しているため）。
    const { codex, session, world } = buildWorld();
    const tickId = codex.propertyNames.getId('tick');

    session.advanceWorldTime(10); // tick内経過分は10、まだ境界に届かない
    session.advanceWorldTime(10); // 10+10=20分 -> 15を1回跨ぐ

    expect(world.instance.tryGetProperty(tickId)?.number ?? 0).toBe(1);
    expect(world.minute).toBe(20);
    expect(world.minute % world.rawMinutesPerTick).toBe(5);
  });

  it('大きな量を一度に進めると複数tickが発火し、hour・dayまで繰り上がる', () => {
    const { codex, session, world } = buildWorld();
    const tickId = codex.propertyNames.getId('tick');
    const dayId = codex.propertyNames.getId('day');

    const minutesPerTick = world.rawMinutesPerTick;

    session.advanceWorldTime(MINUTES_PER_HOUR * 25); // 25時間分を1回で進める

    expect(world.minute).toBe(0);
    expect(world.hour).toBe(1);
    expect(world.instance.tryGetProperty(dayId)?.number ?? 0).toBe(2);
    expect(world.instance.tryGetProperty(tickId)?.number ?? 0).toBe(
      Math.trunc((MINUTES_PER_HOUR * 25) / minutesPerTick),
    );
  });

  it('1tickの長さはハードコードではなく設定されたminutes_per_tickに従う', () => {
    // 1tickの長さはworld.minutes_per_tick（core.yaml側）が持つ値であり、WorldSession側に
    // ハードコードされていないことを、15以外の値でも確認する。
    const { codex, session, world } = buildWorld(20);
    const tickId = codex.propertyNames.getId('tick');

    session.advanceWorldTime(25);

    expect(
      world.instance.tryGetProperty(tickId)?.number ?? 0,
      'minutes_per_tickが20なら25分で1tick跨ぐ',
    ).toBe(1);
    expect(world.minute % world.rawMinutesPerTick).toBe(5);
  });

  describe('World.rollTimeOfDayによる開始時刻の抽選', () => {
    /** nextIntへ渡された候補の範囲を記録し、常に「下から2番目の候補」を選ぶスタブ。 */
    function pickSecondCandidate(requested: [number, number][]): Rng {
      return {
        nextDouble: () => 0,
        nextInt: (minInclusive, maxExclusive) => {
          requested.push([minInclusive, maxExclusive]);
          return minInclusive + 1;
        },
      };
    }

    it('渡した範囲をtick刻みで区切った候補から選ぶ（両端を含む）', () => {
      const { world } = buildWorld();
      const requested: [number, number][] = [];

      world.rollTimeOfDay(8 * MINUTES_PER_HOUR, 12 * MINUTES_PER_HOUR, pickSecondCandidate(requested));

      expect(requested, '8:00〜12:00を15分刻みで区切った17個の候補').toEqual([[32, 49]]);
      expect(world.hour).toBe(8);
      expect(world.minute).toBe(15);
    });

    it('刻みはハードコードではなくminutes_per_tickに従う', () => {
      const { world } = buildWorld(20);
      const requested: [number, number][] = [];

      world.rollTimeOfDay(8 * MINUTES_PER_HOUR, 12 * MINUTES_PER_HOUR, pickSecondCandidate(requested));

      expect(requested).toEqual([[24, 37]]);
      expect(world.hour).toBe(8);
      expect(world.minute).toBe(20);
    });

    it('選ばれた時刻はtick境界に乗るので、最初のtickも1tick分の長さになる', () => {
      const { codex, session, world } = buildWorld();
      const tickId = codex.propertyNames.getId('tick');

      world.rollTimeOfDay(8 * MINUTES_PER_HOUR, 12 * MINUTES_PER_HOUR, pickSecondCandidate([]));
      session.advanceWorldTime(world.rawMinutesPerTick - 1);
      expect(world.instance.tryGetProperty(tickId)?.number ?? 0, '1tickに1分足りなければまだ回らない').toBe(
        0,
      );

      session.advanceWorldTime(1);
      expect(world.instance.tryGetProperty(tickId)?.number ?? 0, 'ちょうど1tick分でtickが回る').toBe(1);
    });
  });

  describe('observeTicksによるtickの観測', () => {
    it('tickを回すたびに、その境界の時刻で観測できる', () => {
      // 07:10から45分進めると、tickが回るのは07:15/07:30/07:45の3回。最後の07:55へはtickを伴わずに進む。
      const { session, world } = buildWorld();
      session.advanceWorldTime(7 * MINUTES_PER_HOUR + 10);

      const observed: number[] = [];
      session.observeTicks(
        () => observed.push(world.totalMinutes),
        () => session.advanceWorldTime(45),
      );

      expect(observed, 'tick境界の絶対時刻で観測される').toEqual([
        7 * MINUTES_PER_HOUR + 15,
        7 * MINUTES_PER_HOUR + 30,
        7 * MINUTES_PER_HOUR + 45,
      ]);
      expect(world.totalMinutes, '観測は時間進行そのものを変えない').toBe(7 * MINUTES_PER_HOUR + 55);
    });

    it('観測は呼び出しの中だけで、抜けたあとのtickでは呼ばれない', () => {
      const { session } = buildWorld();

      let observed = 0;
      session.observeTicks(
        () => observed++,
        () => session.advanceWorldTime(MINUTES_PER_TICK),
      );
      session.advanceWorldTime(MINUTES_PER_TICK);

      expect(observed, '2回目のtickは観測の外なので数えない').toBe(1);
    });

    it('bodyが例外を投げても観測は解除される', () => {
      const { session } = buildWorld();

      let observed = 0;
      expect(() =>
        session.observeTicks(
          () => observed++,
          () => {
            throw new Error('失敗');
          },
        ),
      ).toThrow();
      session.advanceWorldTime(MINUTES_PER_TICK);

      expect(observed).toBe(0);
    });
  });
});
