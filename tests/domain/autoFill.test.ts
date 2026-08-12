import { beforeEach, describe, expect, it } from 'vitest';
import { autoFillMaterials } from '../../src/domain/runtime/autoFill';
import { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { inProgressObjectName, MATERIALS_SLOT } from '../../src/loader/inProgressObjects';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';

/** 製作中オブジェクトへの自動補充（RecipeSystem.md 4節）。 */
describe('自動補充', () => {
  const YAML = `
object_defs:
  ground:
    slots:
      items:
        cell: {accept: {tag: item}}
  character:
    slots:
      hand:
        cell: {accept: {tag: item}}
  woven_leaf:
    tags: [item]
  reed:
    tags: [item]
  basket:
    tags: [item]
    recipes:
      woven:
        steps:
          - requires: [{object: woven_leaf, count: 3, consume: true}]
            duration: 60
`;

  let codex: WorldCodex;
  let session: WorldSession;
  let ground: WorldObject;
  let player: WorldObject;
  let wip: WorldObject;

  const idOf = (name: string) => codex.objectNames.getId(name);
  const slotOf = (name: string) => codex.slotNames.getId(name);

  beforeEach(() => {
    codex = new WorldCodexYamlLoader().load('core.yaml', YAML).build();
    session = new WorldSession(codex);

    ground = new WorldObject(0, codex.objects.get(idOf('ground')), session);
    player = session.spawn(idOf('character'));
    wip = session.spawn(idOf(inProgressObjectName('basket', 'woven')));
    wip.moveToSlot(ground, slotOf('items'));
  });

  /** 素材をn個、指定の親のスロットへ置く。 */
  function place(objectName: string, count: number, parent: WorldObject, slotName: string): void {
    for (let i = 0; i < count; i += 1) session.spawn(idOf(objectName)).moveToSlot(parent, slotOf(slotName));
  }

  /** 製作中オブジェクトの材料スロットに入っている物の識別子。 */
  function inBox(): string[] {
    return (wip.tryGetSlot(slotOf(MATERIALS_SLOT))?.contents ?? []).map((object) => object.def.name);
  }

  const fill = () =>
    autoFillMaterials(
      wip,
      slotOf(MATERIALS_SLOT),
      [player.tryGetSlot(slotOf('hand'))?.contents ?? [], ground.tryGetSlot(slotOf('items'))?.contents ?? []],
      codex,
    );

  it('手持ちから必要な数だけ入る', () => {
    place('woven_leaf', 5, player, 'hand');

    expect(fill()).toBe(3);
    expect(inBox()).toEqual(['woven_leaf', 'woven_leaf', 'woven_leaf']);
    expect(player.tryGetSlot(slotOf('hand'))!.contents, '余りは手元に残る').toHaveLength(2);
  });

  it('手持ちを使い切ってから足元を探す', () => {
    place('woven_leaf', 1, player, 'hand');
    place('woven_leaf', 4, ground, 'items');

    expect(fill()).toBe(3);
    expect(inBox()).toHaveLength(3);
    expect(player.tryGetSlot(slotOf('hand'))!.contents, '手持ちが先に使われる').toHaveLength(0);
  });

  it('足りなくても、あるだけ入る', () => {
    place('woven_leaf', 2, player, 'hand');

    expect(fill()).toBe(2);
    expect(inBox()).toHaveLength(2);
  });

  it('枠が受け入れない物は入らない', () => {
    place('reed', 4, player, 'hand');

    expect(fill()).toBe(0);
    expect(inBox()).toEqual([]);
  });

  it('入れ物の中までは探さない', () => {
    // かごを手に持ち、その中に素材を入れておく。手持ちの直下ではないので対象外。
    const basket = session.spawn(idOf('basket'));
    basket.moveToSlot(player, slotOf('hand'));
    place('woven_leaf', 3, ground, 'items');

    expect(fill(), '足元のぶんだけが入る').toBe(3);
    expect(inBox()).toHaveLength(3);
  });

  it('すでに満ちている枠へは足さない', () => {
    place('woven_leaf', 5, player, 'hand');
    fill();

    expect(fill(), '2度押しても増えない').toBe(0);
    expect(inBox()).toHaveLength(3);
  });
});
