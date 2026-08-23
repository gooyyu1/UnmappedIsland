import { describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * 行き場を失った物の落ち方（GameElementDefinition.md 9.4節、WorldObject.spillTo）に対する自動テスト。
 *
 * 枠が受け入れないものを押し込む経路は無い。入らなければ親、さらにその親…と落ちていき、どこにも
 * 入らなければ世界から消える——どの段でも枠の宣言はそのまま効く、というのがここで確かめること。
 */
describe('行き場を失った物は、入る所まで落ちてから消える', () => {
  const yaml = `
object_defs:
  world:
    singleton: true
    slots:
      places: {cell: {accept: {tag: place}}}

  land:
    tags: [place]
    slots:
      # 土地は「落ちてよい物」なら何でも受け止める。
      ground: {cell: {accept: {tag: droppable}}}

  # 中に入れられるのは柔らかい物だけ。硬い物は受け取らない。
  box:
    tags: [droppable]
    slots:
      contents: {cell: {accept: {tag: soft}}}

  # 何でも入れられる袋。ただし袋自身は柔らかいのでboxにも入る。
  pouch:
    tags: [droppable, soft, carryable]
    slots:
      contents: {cell: {accept: {tag: carryable}}}

  pebble:
    tags: [droppable, carryable]

  # 袋の中にしか居られない物。落ちる先がどこにも無い。
  ghost:
    tags: [carryable]
`;

  interface Fixture {
    readonly land: WorldObject;
    readonly box: WorldObject;
    readonly pouch: WorldObject;
    readonly codex: WorldCodex;
    readonly session: WorldSession;
  }

  /** world > land.ground > box.contents > pouch という入れ子を作る。 */
  const setUp = (): Fixture => {
    const loader = new WorldCodexYamlLoader();
    loader.load('spill.yaml', yaml);
    const codex = loader.build();
    const session = new WorldSession(codex);
    const spawn = (name: string): WorldObject => session.createObject(codex.objectNames.getId(name));

    const world = spawn('world');
    const land = spawn('land');
    expect(land.moveToSlotOrRejection(world.getSlot(codex.slotNames.getId('places')))).toBeUndefined();

    const box = spawn('box');
    expect(box.moveToSlotOrRejection(land.getSlot(codex.slotNames.getId('ground')))).toBeUndefined();

    const pouch = spawn('pouch');
    expect(pouch.moveToSlotOrRejection(box.getSlot(codex.slotNames.getId('contents')))).toBeUndefined();

    return { land, box, pouch, codex, session };
  };

  const spawnInto = (fixture: Fixture, name: string, host: WorldObject): WorldObject => {
    const object = fixture.session.createObject(fixture.codex.objectNames.getId(name));
    expect(
      object.moveToSlotOrRejection(host.getSlot(fixture.codex.slotNames.getId('contents'))),
      `${name} を置けなかった`,
    ).toBeUndefined();
    return object;
  };

  it('受け取れる親がすぐ上にいれば、そこで止まる', () => {
    const fixture = setUp();
    const cushion = spawnInto(fixture, 'pouch', fixture.pouch);

    fixture.pouch.destroy();

    expect(cushion.parent, 'softなのでboxが受け取る').toBe(fixture.box);
  });

  it('親が受け取らなければ、その親まで落ちる', () => {
    const fixture = setUp();
    const pebble = spawnInto(fixture, 'pebble', fixture.pouch);

    fixture.pouch.destroy();

    // boxはsoftしか受け取らないので石は入らない。落ちた先はboxの親である土地。
    expect(pebble.parent, 'boxを飛ばしてlandまで落ちる').toBe(fixture.land);
  });

  it('どこにも入らなければ世界から消える', () => {
    const fixture = setUp();
    const ghost = spawnInto(fixture, 'ghost', fixture.pouch);

    fixture.pouch.destroy();

    // box（soft限定）もland（droppable限定）も受け取らず、その上のworldにも枠が無い。
    expect(ghost.parent, '押し込まれずに失われる').toBeUndefined();
    expect(fixture.land.getSlot(fixture.codex.slotNames.getId('ground')).contents).not.toContain(ghost);
  });

  it('落ちた物の中身は、そこからまた同じように落ちる', () => {
    const fixture = setUp();
    const carrier = spawnInto(fixture, 'pouch', fixture.pouch);
    const pebble = spawnInto(fixture, 'pebble', carrier);

    // carrierごとboxへ落ちるので、中身は運ばれたまま。
    fixture.pouch.destroy();

    expect(carrier.parent).toBe(fixture.box);
    expect(pebble.parent, '運ばれた側は動かない').toBe(carrier);

    // そのcarrierも消えると、中の石はboxに入れずlandまで落ちる。
    carrier.destroy();

    expect(pebble.parent).toBe(fixture.land);
  });
});
