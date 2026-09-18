import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { World } from '../../src/domain/wrappers/World';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';

/**
 * 率の積分の刻みが tick であること（docs/engine/GameElementDefinition.md 8.4.2節）を、実ファイルの
 * 定義だけで検証する。
 *
 * **見ているのは「跨いだ tick の数だけ積まれる」の面**で、総量の正しさではない。分へ割る積分
 * （経過分に比例して積む）は、どれだけ進めても総量は同じところへ着くので、**総量を見る検査では
 * 緑のまま通る**。跨がない経過で動かないことと、端数が量を持たないことだけが、この2つを見分ける。
 *
 * **率も刻みの長さも書き写さない。** 端数を含む経過を「跨いだ tick ちょうどの経過」と突き合わせ、
 * 長さは world の `minutes_per_tick` から引くので、量を変えても率を1つ足しても検査の側は変わらない。
 */
describe('率の積分の刻みは tick', () => {
  let codex: WorldCodex;
  /** 1tickぶんの分数。**跨がない長さも端数を含む長さも、ここから出す。** */
  let tickMinutes: number;

  beforeAll(() => {
    codex = bundledCodex();
    tickMinutes = openWorld().session.world?.rawMinutesPerTick ?? 0;
    expect(tickMinutes, '1tickは2分以上（跨がない長さを取れる幅が要る）').toBeGreaterThan(1);
  });

  /** 実ファイルの定義だけで組んだ、密林に立つ1人。 */
  function openWorld(): { session: WorldSession; world: WorldObject } {
    const session = new WorldSession(codex);
    const world = new WorldObject(0, codex.objects.get(codex.objectNames.getId('world')), session);
    session.adoptWorld(new World(world));
    const jungle = spawnInto(session, 'jungle', world, 'locations');
    spawnInto(session, SAMPLE_CHARACTER, jungle, 'characters');
    return { session, world };
  }

  function spawnInto(
    session: WorldSession,
    objectName: string,
    parent: WorldObject,
    slotName: string,
  ): WorldObject {
    const spawned = session.createObject(codex.objectNames.getId(objectName));
    expect(spawned.moveToSlotOrRejection(parent.getSlot(codex.slotNames.getId(slotName)))).toBeUndefined();
    return spawned;
  }

  /**
   * 世界じゅうの実体値。**プロパティを名指しせずに拾う。**
   *
   * **世界の時計（day/hour/minute）だけは外す**——分ごとに動かしているのは WorldSession
   * （World.addMinutes）であって、率で積まれた値ではない。
   */
  function numbersOf(world: WorldObject): ReadonlyMap<string, number> {
    const { dayId, hourId, minuteId } = codex.vocabulary.world;
    const clock = new Set([dayId, hourId, minuteId]);
    const taken = new Map<string, number>();
    for (const object of [world, ...world.descendants()])
      for (const property of object.allProperties())
        if (!clock.has(property.def.globalId))
          taken.set(`${object.instanceId}.${property.def.name}`, property.number);
    return taken;
  }

  /**
   * 組み立て直した世界を`amount`分だけ進めたときの、時計を除く実体値の動き。`splitInto`を渡すと
   * その回数に刻んで進める。**動かなかった値は入らない**ので、比べた差はそのまま指摘になる。
   */
  function movedBy(amount: number, splitInto = 1): ReadonlyMap<string, number> {
    const { session, world } = openWorld();
    const before = numbersOf(world);

    for (let i = 0; i < splitInto; i++) session.advanceWorldTime(amount / splitInto);

    const moved = new Map<string, number>();
    for (const [key, value] of numbersOf(world)) {
      const delta = value - (before.get(key) ?? 0);
      if (delta !== 0) moved.set(key, delta);
    }
    return moved;
  }

  it('tick境界を跨がない経過では、時計だけが動き、率で動く値は1つも動かない', () => {
    const { session, world } = openWorld();
    const before = numbersOf(world);
    const startedAt = session.world?.totalMinutes ?? 0;
    // 新規ゲームの開始時刻は刻みに乗っている（World.rollTimeOfDay）ので、次のtickは1tickぶん先。
    expect(startedAt % tickMinutes, '開始時刻がtick境界の上にある').toBe(0);

    session.advanceWorldTime(tickMinutes - 1);

    expect((session.world?.totalMinutes ?? 0) - startedAt, '経過そのものは起きている').toBe(tickMinutes - 1);
    expect(numbersOf(world), '分へ割って積むなら、率で動く値がここでずれる').toEqual(before);
  });

  it('端数を含む経過で積まれる量は、跨いだtickちょうどの経過と同じ', () => {
    // 1tick跨いで1分余る。**端数は持ち越されるのでも捨てられるのでもなく、量を持たない。**
    const oneTick = movedBy(tickMinutes);

    expect(oneTick.size, '1tick分で何かは動く（動かなければ以下は素通りになる）').toBeGreaterThan(0);
    expect(movedBy(tickMinutes + 1), '分へ割って積むなら端数のぶんだけ多く積まれる').toEqual(oneTick);
  });

  it('刻んで進めても、積まれる量は跨いだtickの数で決まる', () => {
    expect(movedBy(tickMinutes + 1, 4), '4回に刻んでも跨ぐtickは1回').toEqual(movedBy(tickMinutes));
  });
});
