import { describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import type { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * bound_to_owner（GameElementDefinition.md 7.9節）——単独では存在できない物に対する自動テスト。
 * 「別の持ち主へ移せない」ことと「親が消えれば道連れになる」ことの2つを確かめる。
 */
describe('bound_to_owner（単独では在れない物）', () => {
  const yaml = `
object_defs:
  world:
    singleton: true
    slots:
      places: {cell: {accept: {tag: place}}}
      stuff: {cell: {accept: {tag: item}}}

  land:
    tags: [place]
    slots:
      roads: {cell: {accept: {tag: road}}}
      stuff: {cell: {accept: {tag: item}}}

  road:
    tags: [road]
    bound_to_owner: true
    slots:
      # 道そのものは持ち出せないが、道に置いた物は道と運命を共にしない。
      stuff: {cell: {accept: {tag: item}}}

  stone:
    tags: [item]
`;

  const build = (): WorldCodex => {
    const loader = new WorldCodexYamlLoader();
    loader.load('bound.yaml', yaml);
    return loader.build();
  };

  interface Fixture {
    readonly codex: WorldCodex;
    readonly world: WorldObject;
    readonly here: WorldObject;
    readonly there: WorldObject;
    readonly road: WorldObject;
    readonly stone: WorldObject;
  }

  /** here / there の2つの土地を作り、here に道を、その道の上に石を1つ置いた状態。 */
  const setUp = (): Fixture => {
    const codex = build();
    const session = new WorldSession(codex);
    const placesId = codex.slotNames.getId('places');
    const roadsId = codex.slotNames.getId('roads');
    const stuffId = codex.slotNames.getId('stuff');

    const world = session.spawn(codex.objectNames.getId('world'));
    const lands = [0, 1].map(() => {
      const land = session.spawn(codex.objectNames.getId('land'));
      expect(land.moveToSlot(world, placesId)).toBeUndefined();
      return land;
    });
    const [here, there] = lands as [WorldObject, WorldObject];

    const road = session.spawn(codex.objectNames.getId('road'));
    expect(road.moveToSlot(here, roadsId), '生まれた直後の配置は通る').toBeUndefined();

    const stone = session.spawn(codex.objectNames.getId('stone'));
    expect(stone.moveToSlot(road, stuffId)).toBeUndefined();

    return { codex, world, here, there, road, stone };
  };

  it('いったん持ち主に付いたら、別の持ち主へは移せない', () => {
    const { codex, there, road } = setUp();
    const roadsId = codex.slotNames.getId('roads');

    expect(road.moveToSlot(there, roadsId)).toContain('離せません');
    expect(road.parent?.def.name, '元の持ち主に留まる').toBe('land');
    expect(there.tryGetSlot(roadsId)?.contents).toEqual([]);
  });

  it('forceでも移せない（acceptsの判定ではなく、その物の在り方の制約だから）', () => {
    const { codex, there, road } = setUp();

    expect(road.moveToSlot(there, codex.slotNames.getId('roads'), true)).toContain('離せません');
  });

  it('弾くのは持ち主が変わるときだけで、同じ持ち主の中では動かせる', () => {
    const { codex, here, road } = setUp();

    expect(road.moveToSlot(here, codex.slotNames.getId('roads'))).toBeUndefined();
  });

  it('持ち主が消えれば道連れになるが、中身は道連れにならない', () => {
    const { here, road, stone } = setUp();

    road.destroy();

    expect(road.parent, '道は土地とともに世界から外れる').toBeUndefined();
    expect(stone.parent, '道の上の石はこぼれ出て土地に残る').toBe(here);
  });

  it('boundな子は持ち主に付いたまま世界を去るが、その中身は逃げ出す', () => {
    const { world, here, road, stone } = setUp();

    here.destroy();

    expect(here.parent, '土地が世界から外れる').toBeUndefined();
    expect(road.parent, '道はこぼれず、土地に付いたまま一緒に外れる').toBe(here);
    expect(stone.parent, '道の上の石は単独で在れるので、生き残っている場所まで逃げる').toBe(world);
  });
});
