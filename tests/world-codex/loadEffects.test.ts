import { beforeAll, describe, expect, it } from 'vitest';
import type { ObjectDef } from '../../src/domain/ObjectDef';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { seededRng } from '../../src/domain/Rng';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { Path } from '../../src/domain/wrappers/Path';
import { World } from '../../src/domain/wrappers/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { makeBrightEnoughForAnyAction } from '../support/illumination';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 荷重の効き方（docs/world/Characters.md 荷重の効き方節）に対する自動テスト。**効かせ方は1箇所**
 * ——キャラクタの `load` の段が、移動の可否・歩みの速さ・体力の削りの3つをまとめて駆動する。
 *
 * 率を下げる道具（そり）はまだ実データに無いので、ここだけで足す。担ぎ手・道・積み荷は実データの
 * ものを使う——段の境目も倍率も削りも、確かめたいのは定義ファイルに書いた値そのもの。
 */
const SLED_YAML = `
object_defs:
  sled:
    tags: [item]
    props:
      weight: {value: 8000}
      volume: {value: 200000}
      load_rate:
        value: 1
        passives:
          - conditions: [{in_slot: hand}]
            modify: {self: {load_rate: -0.9}}
    slots:
      cargo:
        cell: {accept: {tag: item}}
`;

/** 道の長さ。段ごとの倍率（1.15倍・1.4倍）が分の単位で割り切れる長さにする。 */
const TRAVEL_MINUTES = 60;

describe('荷重が歩みの速さと体力に効く', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR)
      .load('sled.yaml', SLED_YAML)
      .buildAndReset();
  });

  function def(name: string): ObjectDef {
    return codex.objects.get(codex.objectNames.getId(name));
  }

  function propertyId(name: string): number {
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
  }

  /** 石をstoneCount個担いで（sled: trueならそりに載せて引いて）、道を1本渡る。 */
  function trek(stoneCount: number, options: { sled: boolean } = { sled: false }): Trek {
    const { session, world, worldInstance, character, path, forest } = setUpTrek();
    const arrived = (): boolean => character.parent === forest;

    if (options.sled) {
      const sled = session.createObject(codex.objectNames.getId('sled'));
      expect(sled.moveToSlotOrRejection(character.getSlot(codex.slotNames.getId('hand')))).toBeUndefined();
      loadStones(session, sled, 'cargo', stoneCount);
    } else {
      loadStones(session, character, 'hand', stoneCount);
    }

    const staminaId = propertyId('stamina');
    const tickId = propertyId('tick');
    const minutesBefore = world.totalMinutes;
    const ticksBefore = worldInstance.getProperty(tickId).number;
    const staminaBefore = character.getProperty(staminaId).number;
    const stage = character.tryGetProperty(propertyId('load'))?.stage?.name;

    const moved = new Path(path, codex).travel(character);
    expect(arrived(), '成立したときだけ移動先の土地へ移る').toBe(moved);

    return {
      moved,
      minutes: world.totalMinutes - minutesBefore,
      ticks: worldInstance.getProperty(tickId).number - ticksBefore,
      staminaLost: staminaBefore - character.getProperty(staminaId).number,
      stage,
    };
  }

  it('空身なら等倍で渡り、体力は1も減らない', () => {
    const trip = trek(0);

    expect(trip.stage).toBe('light');
    expect(trip.moved).toBe(true);
    expect(trip.minutes, '道のtravel_minutesがそのまま').toBe(TRAVEL_MINUTES);
    expect(trip.staminaLost, '担いでいない間はtickで減らない').toBe(0);
  });

  it('担ぐと遅くなり、担いだ時間ぶん体力が削られる', () => {
    // medicのladenは8250gから（characters/medic.yaml）。
    const trip = trek(9);

    expect(trip.stage).toBe('laden');
    expect(trip.minutes, '60分 × 1.15').toBe(69);
    expect(trip.staminaLost, '-0.3/tick').toBeCloseTo(0.3 * trip.ticks, 6);
    expect(trip.ticks, '削られる量は渡っている時間で決まる').toBeGreaterThan(0);
  });

  it('重い荷ほど遅くなり、削りも大きい', () => {
    // medicのheavyは16500gから。同じ道が84分に伸び、削りは3倍以上になる。
    const laden = trek(9);
    const heavy = trek(17);

    expect(heavy.stage).toBe('heavy');
    expect(heavy.minutes, '60分 × 1.4').toBe(84);
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

  it('そりに載せれば、通れる・速い・疲れないの3つが同時に戻る', () => {
    // 同じ28個（28kg）でも、引きずるそりなら体感は1割（8000 + 28000 の 0.1 ＝ 3600g）でlightに収まる。
    const carried = trek(28);
    const dragged = trek(28, { sled: true });

    expect(carried.stage, '担げば動けない').toBe('too_heavy');
    expect(dragged.stage, '引けば空身と同じ段').toBe('light');
    expect(dragged.moved, '通れる').toBe(true);
    expect(dragged.minutes, '速さも等倍に戻る').toBe(TRAVEL_MINUTES);
    expect(dragged.staminaLost, '疲れもしない').toBe(0);
  });
});
