import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
 */
describe('率の積分の刻みは tick', () => {
  /** medicの1tickあたりの水分の減り（characters/medic.yaml のプロパティレベルのpassives）。 */
  const HYDRATION_PER_TICK = -1;

  let codex: WorldCodex;
  let session: WorldSession;
  let world: WorldObject;
  let player: WorldObject;

  beforeAll(() => {
    codex = bundledCodex();
  });

  beforeEach(() => {
    session = new WorldSession(codex);
    world = new WorldObject(0, codex.objects.get(codex.objectNames.getId('world')), session);
    session.adoptWorld(new World(world, codex));
    const jungle = spawnInto('jungle', world, 'locations');
    player = spawnInto(SAMPLE_CHARACTER, jungle, 'characters');
  });

  function spawnInto(objectName: string, parent: WorldObject, slotName: string): WorldObject {
    const spawned = session.createObject(codex.objectNames.getId(objectName));
    expect(spawned.moveToSlotOrRejection(parent.getSlot(codex.slotNames.getId(slotName)))).toBeUndefined();
    return spawned;
  }

  function hydration(): number {
    return player.getProperty(codex.propertyNames.getId('hydration')).number;
  }

  /** 世界じゅうの実体値。**プロパティを名指しせずに拾う**ので、率を1つ足しても検査の側は変わらない。 */
  function allNumbers(): ReadonlyMap<string, number> {
    const taken = new Map<string, number>();
    for (const object of [world, ...world.descendants()])
      for (const property of object.allProperties())
        taken.set(`${object.instanceId}.${property.def.name}`, property.number);
    return taken;
  }

  function movedSince(before: ReadonlyMap<string, number>): readonly string[] {
    const moved: string[] = [];
    for (const [key, value] of allNumbers()) if (before.get(key) !== value) moved.push(key);
    return moved.sort();
  }

  it('tick境界を跨がない経過では、時計のほかに動く値が1つも無い', () => {
    // 開始時刻は0:00＝境界の上なので、次のtickは15分先。
    const before = allNumbers();

    session.advanceWorldTime(5);

    expect(movedSince(before), '分へ割って積むなら、率で動く値がここへ並ぶ').toEqual([
      `${world.instanceId}.minute`,
    ]);
  });

  it('端数を含む経過でも、積まれるのは跨いだtickの数ぶんだけ', () => {
    // 20分＝1tick跨いで5分余る。**端数は持ち越されるのでも捨てられるのでもなく、量を持たない。**
    const before = hydration();

    session.advanceWorldTime(20);

    expect(hydration() - before, '分へ割って積むなら20/15tick分になる').toBe(HYDRATION_PER_TICK);
  });

  it('跨いだtickの数が同じなら、何回に分けて進めても同じだけ積まれる', () => {
    const before = hydration();

    for (let i = 0; i < 4; i++) session.advanceWorldTime(5);

    expect(hydration() - before, '20分を4回に刻んでも跨ぐtickは1回').toBe(HYDRATION_PER_TICK);
  });
});
