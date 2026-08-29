import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { Location } from '../../src/domain/wrappers/Location';
import { World } from '../../src/domain/wrappers/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { fixedRng } from '../support/rng';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 浅い洞窟（locations.yamlのshallow_cave）が、雨をしのげる暗い拠点として働くことの検証
 * （docs/world/Dwellings.md 5節）。
 *
 * 見るのは「入れて出られる」「外より暗いが底ではない」「中では雨が当たらない」「物を置ける」の4つ。
 * 明るさの仕組みそのものはtests/world-codex/illumination.test.tsが受け持つ。
 */

/** 夜。太陽が地平線の下なので、世界の明るさは底（-6）に張り付く。 */
const NIGHT_HOUR = 0;
/** 正午。晴れ（clear）なら世界の明るさは+14で、洞窟を掘る岩場も遮るものが無いので同じ値になる。 */
const NOON_HOUR = 12;

/** 洞窟が湧く土地の1つ（locations.yamlのrocky_fieldのexplore）。 */
const CAVE_LAND = 'rocky_field';

describe('浅い洞窟', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
  });

  /** 岩場に浅い洞窟が1つあり、その外にプレイヤーが立っている世界。 */
  function outside(hour: number, weather = 'clear') {
    const worldInstance = new WorldObject(
      0,
      codex.objects.get(codex.objectNames.getId('world')),
      new WorldSession(codex),
    );
    const worldView = new World(worldInstance, codex);
    const session = new WorldSession(codex, worldView, fixedRng(0));
    worldInstance.getProperty(codex.propertyNames.getId('hour')).setNumberWithoutEvents(hour);
    worldInstance
      .getProperty(codex.propertyNames.getId('weather'))
      .setNumberWithoutEvents(codex.symbolNames.getId(weather));

    const land = spawnInto(session, CAVE_LAND, worldInstance, 'locations');
    const cave = spawnInto(session, 'shallow_cave', land, 'fixtures');
    const player = spawnInto(session, SAMPLE_CHARACTER, land, 'characters');
    return { session, land, cave, player };
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

  function execute(target: WorldObject, actionName: string, agent: WorldObject): boolean {
    return target.tryGetAction(actionName, agent)?.tryExecute() === true;
  }

  function propertyOf(object: WorldObject, propertyName: string): number {
    return object.getProperty(codex.propertyNames.getId(propertyName)).getEffectiveValue();
  }

  /** 種火に薪を少しくべた焚き火（fire.yaml）。雨に打たれなければ、1tickで薪のぶん（+2）だけ育つ。 */
  function smallFire(session: WorldSession, place: WorldObject): WorldObject {
    const hearth = spawnInto(session, 'campfire', place, 'fixtures');
    hearth.getProperty(codex.propertyNames.getId('fuel')).setNumber(5);
    hearth.getProperty(codex.propertyNames.getId('heat')).setNumber(1);
    return hearth;
  }

  /** 水の入った甕（liquid_containers.yaml）。空けて置けば、降っている雨のぶんだけ増える。 */
  function waterJar(session: WorldSession, place: WorldObject): WorldObject {
    return spawnInto(session, 'jar__content_water_liquid', place, 'items');
  }

  it('浅い洞窟に入れて、出られる', () => {
    const { cave, player, land } = outside(NOON_HOUR);

    expect(execute(cave, 'enter', player), '入れる').toBe(true);
    expect(player.parent, 'プレイヤーは洞窟の中に居る').toBe(cave);

    expect(execute(cave, 'leave', player), '出られる').toBe(true);
    expect(player.parent, 'プレイヤーは元の土地へ戻る').toBe(land);
  });

  it('夜に入っても出られる（明るさで閉じ込めない）', () => {
    const { cave, player, land } = outside(NIGHT_HOUR);

    expect(execute(cave, 'enter', player)).toBe(true);
    expect(execute(cave, 'leave', player), '真っ暗でも外へ戻れる').toBe(true);
    expect(player.parent).toBe(land);
  });

  it('中は外より暗いが、暗さの底ではない', () => {
    const { land, cave } = outside(NOON_HOUR);

    expect(propertyOf(cave, 'ambient_brightness'), '岩陰ぶん6段暗い').toBe(
      propertyOf(land, 'ambient_brightness') - 6,
    );
    expect(propertyOf(cave, 'ambient_brightness'), '底（-6）には落ちない').toBeGreaterThan(-6);
  });

  it('昼なら中でも手元の作業ができるが、夜は何もできない', () => {
    const noon = outside(NOON_HOUR);
    expect(execute(noon.cave, 'enter', noon.player)).toBe(true);
    expect(
      propertyOf(noon.player, 'hand_brightness'),
      '昼の洞窟はしきい値（+5）を超える',
    ).toBeGreaterThanOrEqual(5);

    const night = outside(NIGHT_HOUR);
    expect(execute(night.cave, 'enter', night.player)).toBe(true);
    expect(propertyOf(night.player, 'hand_brightness'), '夜の洞窟は底（-6）').toBe(-6);
  });

  it('中では雨が当たらない — 外の甕は雨で満ちていくが、中の甕は増えない', () => {
    const { session, land, cave } = outside(NOON_HOUR, 'heavy_rain');
    const outdoorJar = waterJar(session, land);
    const shelteredJar = waterJar(session, cave);
    const before = propertyOf(shelteredJar, 'fill');

    session.advanceWorldTime(15);

    expect(propertyOf(outdoorJar, 'fill'), '野ざらしの甕は雨を受ける').toBeGreaterThan(before);
    expect(propertyOf(shelteredJar, 'fill'), '洞窟の中の甕は雨を受けない').toBeLessThanOrEqual(before);
  });

  it('中では雨が当たらない — 雨天でも、洞窟の中では雨受けを始められない', () => {
    const { session, land, cave, player } = outside(NOON_HOUR, 'heavy_rain');
    const outdoorJar = spawnInto(session, 'jar', land, 'items');
    const shelteredJar = spawnInto(session, 'jar', cave, 'items');

    expect(execute(outdoorJar, 'collect_rain', player), '外では雨を受け始められる').toBe(true);
    expect(
      shelteredJar.tryGetAction('collect_rain', player)?.unmetRequirement()?.reasonName,
      '中では雨が当たらない',
    ).toBe('sheltered');
  });

  it('中では雨で火が消えない — 外の焚き火は消えるが、中の焚き火は育つ', () => {
    const { session, land, cave } = outside(NOON_HOUR, 'heavy_rain');
    const outdoorFire = smallFire(session, land);
    const shelteredFire = smallFire(session, cave);

    session.advanceWorldTime(15);

    expect(propertyOf(outdoorFire, 'heat'), '野ざらしの炉は雨に消される').toBe(0);
    expect(propertyOf(shelteredFire, 'heat'), '洞窟の中の炉は薪のぶんだけ育つ').toBe(3);
  });

  it('物を置いて拠点にできる — items / fixtures / charactersの3つが働く', () => {
    const { session, cave, player } = outside(NOON_HOUR);

    const stone = spawnInto(session, 'stone', cave, 'items');
    const campfire = spawnInto(session, 'campfire', cave, 'fixtures');
    expect(execute(cave, 'enter', player)).toBe(true);

    const inside = new Location(cave, codex);
    expect(inside.items, '置いた物は中に並ぶ').toContain(stone);
    expect(inside.fixtures, '据えた炉も中に並ぶ').toContain(campfire);
    expect(inside.characters, '中に居るのはプレイヤー').toContain(player);
  });
});
