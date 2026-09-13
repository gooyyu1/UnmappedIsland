import { beforeAll, describe, expect, it } from 'vitest';
import type { ObjectDef } from '../../src/domain/ObjectDef';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { seededRng } from '../../src/domain/Rng';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { Path } from '../../src/domain/wrappers/Path';
import { World } from '../../src/domain/wrappers/World';
import { makeBrightEnoughForAnyAction } from '../support/illumination';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';
import type { PropertyGlobalId } from '../../src/domain/GlobalId';

/**
 * 荷重の効き方（docs/world/Characters.md 荷重の効き方節）に対する自動テスト。**効かせ方は1箇所**
 * ——キャラクタの `load` の段が、移動の可否・歩みの遅れ・体力の削りの3つをまとめて駆動する。
 *
 * 遅れは道の `travel_minutes` が `base` で担ぎ手の `travel_delay` を継いで**足される**
 * （GameElementDefinition.md 6.5節）。ここが見ているのは、その足し算が実データを通して効くこと。
 *
 * **入れ物も担ぎ手も道も実データのもの**を使う——段の境目も遅れも削りも、確かめたいのは定義
 * ファイルに書いた値そのもの。引く道具の率を決めた逆転点（docs/world/Containers.md 2節）も、
 * ここで担ぎ手に担がせて確かめる。
 */

/** 道の長さ。実データの素の道（locations.yaml）と同じ長さにする。 */
const TRAVEL_MINUTES = 60;

describe('荷重が歩みの遅れと体力に効く', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    codex = bundledCodex();
  });

  function def(name: string): ObjectDef {
    return codex.objects.get(codex.objectNames.getId(name));
  }

  function propertyId(name: string): PropertyGlobalId {
    return codex.propertyNames.getId(name);
  }

  /** 草原から森への発見済みの道と、そこに立つ担ぎ手。 */
  function setUpTrek(): {
    session: WorldSession;
    world: World;
    worldInstance: WorldObject;
    character: WorldObject;
    path: WorldObject;
    forest: WorldObject;
  } {
    const session = new WorldSession(codex, undefined, seededRng(42));
    const worldInstance = new WorldObject(0, def('world'), session);
    const world = new World(worldInstance, codex);
    session.adoptWorld(world);

    const locationsSlotId = codex.slotNames.getId('locations');
    const grassland = session.createObject(codex.objectNames.getId('grassland'));
    const forest = session.createObject(codex.objectNames.getId('forest'));
    expect(grassland.moveToSlotOrRejection(worldInstance.getSlot(locationsSlotId))).toBeUndefined();
    expect(forest.moveToSlotOrRejection(worldInstance.getSlot(locationsSlotId))).toBeUndefined();

    const character = session.createObject(codex.objectNames.getId(SAMPLE_CHARACTER));
    // 見たいのは荷の効き方だけなので、暗さの条件は担ぎ手の側で黙らせる（IlluminationSystem.md 5節）。
    makeBrightEnoughForAnyAction(character, codex);
    expect(
      character.moveToSlotOrRejection(grassland.getSlot(codex.slotNames.getId('characters'))),
    ).toBeUndefined();

    // 探索を経ずに発見済みの道を1本置く（発見の流れはlocationsYaml.test.tsが受け持つ）。
    const path = session.createObject(codex.objectNames.getId('path'));
    expect(path.moveToSlotOrRejection(grassland.getSlot(codex.slotNames.getId('fixtures')))).toBeUndefined();
    path.getProperty(propertyId('travel_minutes')).setNumberWithoutEvents(TRAVEL_MINUTES);
    path.getProperty(propertyId('destination_id')).setNumberWithoutEvents(forest.instanceId);

    return { session, world, worldInstance, character, path, forest };
  }

  /** 石を指定個数、そのスロットへ入れる（束ねられるので枠は1つで足りる）。 */
  function loadStones(session: WorldSession, into: WorldObject, slotName: string, count: number): void {
    const slot = into.getSlot(codex.slotNames.getId(slotName));
    for (let i = 0; i < count; i++)
      expect(
        session.createObject(codex.objectNames.getId('stone')).moveToSlotOrRejection(slot),
      ).toBeUndefined();
  }

  /** 道を1本渡った結果。渡れなかったときは経過も削りも0になる。 */
  interface Trek {
    readonly moved: boolean;
    readonly minutes: number;
    readonly ticks: number;
    readonly staminaLost: number;
    readonly stage: string | undefined;
    /** 道へ出る前に担ぎ手が感じていた荷（g）。段の名前より細かい比較に使う。 */
    readonly load: number;
  }

  /**
   * 石をstoneCount個担いで、道を1本渡る。`container` を渡すとその入れ物を手に持ち、石はそちらへ
   * 積む（入れ物はどれも `contents` スロットを持つ、containers.yaml）。
   */
  function trek(stoneCount: number, container?: string): Trek {
    const { session, world, worldInstance, character, path, forest } = setUpTrek();
    const arrived = (): boolean => character.parent === forest;

    if (container !== undefined) {
      const carrier = session.createObject(codex.objectNames.getId(container));
      expect(carrier.moveToSlotOrRejection(character.getSlot(codex.slotNames.getId('hand')))).toBeUndefined();
      loadStones(session, carrier, 'contents', stoneCount);
    } else {
      loadStones(session, character, 'hand', stoneCount);
    }

    const staminaId = propertyId('stamina');
    const tickId = propertyId('tick');
    const minutesBefore = world.totalMinutes;
    const ticksBefore = worldInstance.getProperty(tickId).number;
    const staminaBefore = character.getProperty(staminaId).number;
    const stage = character.tryGetProperty(propertyId('load'))?.stage?.name;
    const load = character.getProperty(propertyId('load')).getEffectiveValue();

    const moved = new Path(path, codex).travel(character);
    expect(arrived(), '成立したときだけ移動先の土地へ移る').toBe(moved);

    return {
      moved,
      minutes: world.totalMinutes - minutesBefore,
      ticks: worldInstance.getProperty(tickId).number - ticksBefore,
      staminaLost: staminaBefore - character.getProperty(staminaId).number,
      stage,
      load,
    };
  }

  it('空身なら遅れずに渡り、体力は1も減らない', () => {
    const trip = trek(0);

    expect(trip.stage).toBe('light');
    expect(trip.moved).toBe(true);
    expect(trip.minutes, '道のtravel_minutesがそのまま').toBe(TRAVEL_MINUTES);
    expect(trip.staminaLost, '担いでいない間はtickで減らない').toBe(0);
  });

  it('担ぐと遅れが足され、担いだ時間ぶん体力が削られる', () => {
    // medicのladenは8250gから（characters/medic.yaml）。
    const trip = trek(9);

    expect(trip.stage).toBe('laden');
    expect(trip.minutes, '60分 + 遅れ10分').toBe(TRAVEL_MINUTES + 10);
    expect(trip.staminaLost, '-0.3/tick').toBeCloseTo(0.3 * trip.ticks, 6);
    expect(trip.ticks, '削られる量は渡っている時間で決まる').toBeGreaterThan(0);
  });

  it('重い荷ほど遅れが大きく、削りも大きい', () => {
    // medicのheavyは16500gから。同じ道の遅れが25分に開き、削りは3倍以上になる。
    const laden = trek(9);
    const heavy = trek(17);

    expect(heavy.stage).toBe('heavy');
    expect(heavy.minutes, '60分 + 遅れ25分').toBe(TRAVEL_MINUTES + 25);
    expect(heavy.minutes).toBeGreaterThan(laden.minutes);
    expect(heavy.staminaLost, '-1/tick').toBeCloseTo(heavy.ticks, 6);
    expect(heavy.staminaLost).toBeGreaterThan(laden.staminaLost);
  });

  it('担ぎきれない荷では道に出られない', () => {
    // medicのtoo_heavyは27500gから。道のtravelがこの段の名前を見て落とす（ContainerSystem.md 5節）。
    const trip = trek(28);

    expect(trip.stage).toBe('too_heavy');
    expect(trip.moved).toBe(false);
    expect(trip.minutes, '成立しなかった操作は時間を消費しない').toBe(0);
  });

  it('そりに載せれば、担ぎきれない荷でも道に出られる', () => {
    // 同じ28個（28kg）でも、引きずるそりなら体感は55%（(8000 + 28000) × 0.55 ＝ 19800g）で、
    // 通れない段（27500g）の内側に収まる。**遅れも削りも消えはしない**——そりが戻すのは
    // 通れることだけで、heavyの段はそのまま効く。
    const carried = trek(28);
    const dragged = trek(28, 'sledge');

    expect(carried.stage, '担げば動けない').toBe('too_heavy');
    expect(carried.moved).toBe(false);
    expect(dragged.stage, '引けば通れる段まで下がる').toBe('heavy');
    expect(dragged.moved, '通れる').toBe(true);
  });

  it('丸太2本はそりでだけ運べる', () => {
    // そりの値打ちは「担げない重さを運べる」ことに出る（docs/world/Containers.md 2節）。
    // 丸太は1本20kgなので、2本＝40kgは担いでも籠でも通れない段に入る。
    const loadOf = (container: string): number => {
      const { session: s, character } = setUpTrek();
      const carrier = s.createObject(codex.objectNames.getId(container));
      expect(carrier.moveToSlotOrRejection(character.getSlot(codex.slotNames.getId('hand')))).toBeUndefined();
      const contents = carrier.getSlot(codex.slotNames.getId('contents'));
      for (let i = 0; i < 2; i++)
        expect(
          s.createObject(codex.objectNames.getId('log')).moveToSlotOrRejection(contents),
          `${container} へ${i + 1}本目`,
        ).toBeUndefined();
      return character.getProperty(propertyId('load')).getEffectiveValue();
    };

    // 籠（20L）には丸太（35L）が1本も入らないので、比べる相手は素手。
    expect(trek(40).stage, '40kgを担げば動けない').toBe('too_heavy');
    expect(loadOf('sledge'), 'そりなら通れない段（27500g）の内側').toBeLessThan(27500);
    expect(loadOf('handcart'), '台車はさらに軽い').toBeLessThan(loadOf('sledge'));
  });

  it('引く道具へ乗り換える積載は、Containers.mdが置いた線のとおり', () => {
    // 率は逆転点から逆算してある（docs/world/Containers.md 2節）ので、**線が動けばここが落ちる**。
    // 石は1個1kgなので、個数がそのまま積載（kg）になる。
    const basketAt = (stones: number): number => trek(stones, 'woven_basket').load;
    const sledgeAt = (stones: number): number => trek(stones, 'sledge').load;
    const handcartAt = (stones: number): number => trek(stones, 'handcart').load;

    expect(basketAt(8), '編み籠とそりは8kgで並ぶ').toBeCloseTo(sledgeAt(8), 6);
    expect(basketAt(7), '7kgでは籠のほうが軽い').toBeLessThan(sledgeAt(7));
    expect(basketAt(9), '9kgではそりのほうが軽い').toBeGreaterThan(sledgeAt(9));

    expect(sledgeAt(10), 'そりと台車は10kgで並ぶ').toBeCloseTo(handcartAt(10), 6);
    expect(sledgeAt(9), '9kgではそりのほうが軽い').toBeLessThan(handcartAt(9));
    expect(sledgeAt(11), '11kgでは台車のほうが軽い').toBeGreaterThan(handcartAt(11));
  });
});
