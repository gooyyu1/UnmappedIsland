import { beforeEach, describe, expect, it } from 'vitest';
import { autoFillMaterials } from '../../src/domain/autoFill';
import { remainingRequirements } from '../../src/domain/crafting';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { inProgressObjectName } from '../../src/loader/inProgressObjects';
import type { WorldCodex } from '../../src/domain/WorldCodex';

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
  torch:
    tags: [item]
    recipes:
      lit:
        steps:
          - requires: [{object: reed, count: 2, consume: true}]
            duration: 60
          - requires: [{tag: item, count: 1, consume: true}]
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
    codex = new WorldCodexYamlLoader().load('core.yaml', YAML).buildAndReset();
    session = new WorldSession(codex);

    ground = new WorldObject(0, codex.objects.get(idOf('ground')), session);
    player = session.createObject(idOf('character'));
    wip = session.createObject(idOf(inProgressObjectName('basket', 'woven')));
    wip.moveToSlotOrRejection(ground.getSlot(slotOf('items')));
  });

  /** 素材をn個、指定の親のスロットへ置く。 */
  function place(objectName: string, count: number, parent: WorldObject, slotName: string): void {
    for (let i = 0; i < count; i += 1)
      session.createObject(idOf(objectName)).moveToSlotOrRejection(parent.getSlot(slotOf(slotName)));
  }

  /** 製作中オブジェクトの材料スロットに入っている物の識別子。 */
  function inBox(): string[] {
    return (wip.tryGetSlot(codex.vocabulary.engine.materialsSlotId)?.contents ?? []).map(
      (object) => object.def.name,
    );
  }

  const fill = () =>
    autoFillMaterials(
      wip,
      codex.vocabulary.engine.materialsSlotId,
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
    const basket = session.createObject(idOf('basket'));
    basket.moveToSlotOrRejection(player.getSlot(slotOf('hand')));
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

  /**
   * 工程が進むと、済んだ工程の枠は表示から消える。そこへ入れた物は取り出せなくなるので、残りの
   * 工程が要求する枠だけを埋める。`reed`は`item`タグを持つので、2つの工程の枠がどちらも受け入れる。
   */
  describe('残りの工程が要求する枠だけ埋める', () => {
    let torch: WorldObject;

    /** 1つ目の工程（reed×2）が済んだところから、残りの要求だけを渡して自動補充する。 */
    function fillRemaining(): number {
      const recipe = codex.objects.get(idOf('torch')).recipesProducingThis[0];
      return autoFillMaterials(
        torch,
        codex.vocabulary.engine.materialsSlotId,
        [player.tryGetSlot(slotOf('hand'))?.contents ?? []],
        codex,
        remainingRequirements(recipe, recipe.steps[0].durationMinutes),
      );
    }

    /** 材料スロットの枠ごとの中身を'reed×2'の形で（空き枠はundefined）。 */
    function cells(): (string | undefined)[] {
      return (torch.tryGetSlot(codex.vocabulary.engine.materialsSlotId)?.cells ?? []).map((cell) =>
        cell.stack === undefined
          ? undefined
          : `${cell.stack.members[0].def.name}×${cell.stack.members.length}`,
      );
    }

    beforeEach(() => {
      torch = session.createObject(idOf(inProgressObjectName('torch', 'lit')));
      torch.moveToSlotOrRejection(ground.getSlot(slotOf('items')));
    });

    it('済んだ工程の枠は、その型を受け入れても埋めない', () => {
      place('reed', 3, player, 'hand');

      expect(fillRemaining(), '残っているのはitem×1の工程だけ').toBe(1);
      expect(cells(), 'reedの枠は空のまま、itemの枠に1つ').toEqual([undefined, 'reed×1']);
    });

    it('残りの要求を渡さなければ、全ての枠を埋める', () => {
      place('reed', 3, player, 'hand');

      const moved = autoFillMaterials(
        torch,
        codex.vocabulary.engine.materialsSlotId,
        [player.tryGetSlot(slotOf('hand'))?.contents ?? []],
        codex,
      );

      expect(moved).toBe(3);
      expect(cells(), '選んだ枠へ入る（reedの枠に2つ、itemの枠に1つ）').toEqual(['reed×2', 'reed×1']);
    });
  });
});
