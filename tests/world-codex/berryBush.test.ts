import { beforeAll, describe, expect, it } from 'vitest';
import type { PropertyGlobalId } from '../../src/domain/GlobalId';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { TICKS_PER_DAY } from '../../src/domain/worldTime';
import { World } from '../../src/domain/wrappers/World';
import { fixedRng } from '../support/rng';
import { bundledCodex } from '../support/worldCodexFiles';

/**
 * ベリーの茂み（locations.yamlのberry_bush）が実を返すことと、その周期の検証。
 *
 * 見たいのは**採り尽くしてから次に実るまでが、定義の288tick（3日）そのものであること**。茂みは
 * 罠・畑と同じ「留守番の設備」の形（docs/engine/TrapSystem.md）に乗っているので、留守にした日数が
 * そのまま実りにならないこと——**タイマーが止まるのは実が残っている間**——がこの型の要になる。
 */

/** 実が熟すまでの間隔（locations.yamlのripening_remaining）。 */
const RIPENING_DAYS = 3;

/** 1回の実りで並ぶ数（同on_minのspawn）。 */
const BERRIES_PER_HARVEST = 2;

/**
 * 実った後、そのまま置いて様子を見る日数。
 *
 * **屋外に置いた実が腐って消えるまで（3.3日、foods.yamlのspoils_normalと屋外の上乗せ）より短く
 * 採ること。** 長くすると、枠が空いてタイマーが回り直した後の**別の回の実**を見ることになり、
 * 「増えていない」と「入れ替わった」が個数では見分けられなくなる。
 */
const WATCH_DAYS = 2;

describe('ベリーの茂み', () => {
  let codex: WorldCodex;
  let session: WorldSession;
  let land: WorldObject;
  let bush: WorldObject;
  let ripeningRemainingId: PropertyGlobalId;

  beforeAll(() => {
    codex = bundledCodex();
    ripeningRemainingId = codex.propertyNames.getId('ripening_remaining');
  });

  /**
   * 草原に茂みが1つ立っている世界。
   *
   * **茂みの初期値は位相のぶんだけばらつく**（locations.yamlのripening_remaining）ので、周期を
   * 数えられるよう、採り尽くした直後と同じ状態（実が無く、残りが満タン）へ揃える。
   */
  function atBush(): void {
    session = new WorldSession(codex, undefined, fixedRng(0));
    const worldInstance = session.createObject(codex.objectNames.getId('world'));
    session.adoptWorld(new World(worldInstance));
    land = spawnInto('grassland', worldInstance, 'locations');
    bush = spawnInto('berry_bush', land, 'fixtures');
    bush.getProperty(ripeningRemainingId).setNumberWithoutEvents(RIPENING_DAYS * TICKS_PER_DAY);
  }

  function spawnInto(objectName: string, parent: WorldObject, slotName: string): WorldObject {
    const spawned = session.createObject(codex.objectNames.getId(objectName));
    expect(spawned.moveToSlotOrRejection(parent.getSlot(codex.slotNames.getId(slotName)))).toBeUndefined();
    return spawned;
  }

  function tick(count: number): void {
    for (let i = 0; i < count; i++) land.tick();
  }

  /** そのスロットに今並んでいる物の識別子。 */
  function contentsOf(owner: WorldObject, slotName: string): string[] {
    return (owner.tryGetSlot(codex.slotNames.getId(slotName))?.contents ?? []).map(
      (object) => object.def.name,
    );
  }

  /** 実りの枠を空にする（プレイヤーが摘み取って持ち去るのと同じ）。 */
  function takeAll(): void {
    for (const berry of [...bush.getSlot(codex.slotNames.getId('crop')).contents])
      expect(berry.moveToSlotOrRejection(land.getSlot(codex.slotNames.getId('items')))).toBeUndefined();
  }

  it('3日待てば実が付く', () => {
    atBush();

    tick(RIPENING_DAYS * TICKS_PER_DAY - 1);
    expect(contentsOf(bush, 'crop'), '3日に1tick足りなければ、まだ実らない').toEqual([]);

    tick(1);
    expect(contentsOf(bush, 'crop')).toEqual(Array<string>(BERRIES_PER_HARVEST).fill('berry'));
  });

  it('採っても株は残る（房を採るのに切り倒すバナナの株とは違う）', () => {
    atBush();
    tick(RIPENING_DAYS * TICKS_PER_DAY);

    takeAll();

    expect(contentsOf(land, 'fixtures'), '茂みは土地に残る').toContain('berry_bush');
  });

  it('採り尽くしてから次に実るまでが3日', () => {
    // **待ちが始まるのは採ったとき**——実が残っている間はタイマーが止まっているので、摘みに行くのが
    // 遅れても次の実りが早まることはない。
    atBush();
    tick(RIPENING_DAYS * TICKS_PER_DAY);
    takeAll();

    tick(RIPENING_DAYS * TICKS_PER_DAY - 1);
    expect(contentsOf(bush, 'crop'), '採った翌日から数え直す').toEqual([]);

    tick(1);
    expect(contentsOf(bush, 'crop')).toEqual(Array<string>(BERRIES_PER_HARVEST).fill('berry'));
  });

  it('採らずに置いても実は増えない（留守にした日数ぶん採れるようにはならない）', () => {
    atBush();
    tick(RIPENING_DAYS * TICKS_PER_DAY);

    tick(WATCH_DAYS * TICKS_PER_DAY);

    expect(contentsOf(bush, 'crop'), '実りは1回ぶんのまま').toEqual(
      Array<string>(BERRIES_PER_HARVEST).fill('berry'),
    );
    expect(
      bush.getProperty(ripeningRemainingId).getEffectiveValue(),
      '残りは1tickも減っていない（実が残っている間は数えない）',
    ).toBe(RIPENING_DAYS * TICKS_PER_DAY);
  });

  it('摘み残した分が在るうちは、次の実りが始まらない', () => {
    // 枠が空かどうかで数えているので、1粒でも残っていれば止まったまま。
    atBush();
    tick(RIPENING_DAYS * TICKS_PER_DAY);
    expect(contentsOf(bush, 'crop'), '実は1回ぶん並んでいる').toHaveLength(BERRIES_PER_HARVEST);
    const [first] = bush.getSlot(codex.slotNames.getId('crop')).contents;
    expect(first.moveToSlotOrRejection(land.getSlot(codex.slotNames.getId('items')))).toBeUndefined();

    tick(WATCH_DAYS * TICKS_PER_DAY);

    expect(bush.getProperty(ripeningRemainingId).getEffectiveValue(), '残りは1tickも減っていない').toBe(
      RIPENING_DAYS * TICKS_PER_DAY,
    );
  });
});
