import { describe, expect, it } from 'vitest';
import type { WorldObject } from '../../src/domain/WorldObject';
import { craftingActions, craftingMaterials } from '../../src/game/view/craftingView';
import { inProgressObjectName } from '../../src/loader/inProgressObjects';
import type { MiniGame } from '../support/miniGame';
import { miniGame } from '../support/miniGame';

/**
 * 製作中オブジェクトが出す操作と、材料の枠が要求しているもの（craftingView）の自動テスト。
 *
 * **画面を作らずに確かめられる**のがこの層の値打ちで、押せるか・理由は何か・あと何が要るかを
 * ワールドの状態から直に見る。**同梱の定義は読まない**——要るのは「工程が要求している型と個数」
 * だけなので、その形のレシピをこの場で書けば足りる。
 */
describe('製作中オブジェクトの操作と材料の枠', () => {
  /** 葉6枚を120分編むと籠になる、1工程だけのレシピ。 */
  const WORLD = `
object_defs:
  leaf: {tags: [item]}
  basket:
    tags: [item]
    recipes:
      woven:
        steps:
          - requires: [{object: leaf, count: 6, consume: true}]
            duration: 120
`;

  /** 籠を作りかけの状態で足元に置いた世界。 */
  function startWeaving(): { readonly mini: MiniGame; readonly wip: WorldObject } {
    const mini = miniGame(WORLD);
    const wip = mini.createObject(inProgressObjectName('basket', 'woven'), mini.slot('items', mini.land));
    return { mini, wip };
  }

  /** 葉をcount枚、手持ちへ入れる。 */
  function leavesInHand(mini: MiniGame, count: number): void {
    for (let i = 0; i < count; i += 1) mini.createObject('leaf', mini.slot('hand'));
  }

  const materialsIn = (mini: MiniGame, wip: WorldObject): readonly WorldObject[] =>
    wip.tryGetSlot(mini.codex.vocabulary.engine.materialsSlotId)?.contents ?? [];

  const actionsOn = (mini: MiniGame, target: WorldObject) => craftingActions(target, mini.codex, mini.game);

  it('製作中でない物は、操作も材料の枠も持たない', () => {
    const mini = miniGame(WORLD);
    const leaf = mini.createObject('leaf');

    expect(actionsOn(mini, leaf)).toEqual([]);
    expect(craftingMaterials(leaf, mini.codex)).toBeUndefined();
  });

  it('操作は自動補充・作業する・中断の3つで、素材が足りなければ作業できない', () => {
    const { mini, wip } = startWeaving();

    const actions = actionsOn(mini, wip);
    expect(actions.map((action) => action.name)).toEqual(['自動補充', '作業する', '中断']);

    const work = actions[1];
    expect(work.minutes, 'かかるのは今の工程のぶん').toBe(120);
    expect(work.enabled).toBe(false);
    expect(work.reason).toBe('素材が足りない。');
  });

  it('自動補充は手持ちから素材を入れ、揃えば作業できるようになる', () => {
    const { mini, wip } = startWeaving();
    leavesInHand(mini, 6);

    actionsOn(mini, wip)[0].execute();

    expect(materialsIn(mini, wip), '要求されている6枚が入る').toHaveLength(6);
    expect(
      mini.game.player.hand.filter((object) => object !== undefined),
      '手持ちからは出ていく',
    ).toHaveLength(0);
    expect(actionsOn(mini, wip)[1].enabled, '揃ったので作業できる').toBe(true);
  });

  it('作業すると工程が進み、出来上がると同じ札が完成品になる', () => {
    const { mini, wip } = startWeaving();
    leavesInHand(mini, 6);
    actionsOn(mini, wip)[0].execute();

    actionsOn(mini, wip)[1].execute();

    expect(
      mini.game.startLocation.items.some((object) => object.def.name === 'basket'),
      '1工程しかないレシピなので、1回の作業で籠になる',
    ).toBe(true);
    expect(wip.def.name, '作りかけの札がそのまま籠になる（become、9.9節）').toBe('basket');
  });

  it('中断すると作りかけは消え、入れてあった素材はその場へこぼれる', () => {
    const { mini, wip } = startWeaving();
    leavesInHand(mini, 6);
    actionsOn(mini, wip)[0].execute();

    actionsOn(mini, wip)[2].execute();

    expect(mini.game.startLocation.items, '作りかけはもう無い').not.toContain(wip);
    expect(
      mini.game.startLocation.items.filter((object) => object.def.name === 'leaf'),
      '入れてあった素材は足元へ',
    ).toHaveLength(6);
  });

  it('材料の枠は、要求している型と、あと何個要るか・今何個入っているかを答える', () => {
    const { mini, wip } = startWeaving();
    leavesInHand(mini, 2);
    actionsOn(mini, wip)[0].execute();

    const materials = craftingMaterials(wip, mini.codex);

    expect(materials).toHaveLength(1);
    expect(materials?.[0]).toMatchObject({
      objectGlobalIds: [mini.codex.objectNames.getId('leaf')],
      needed: 6,
      held: 2,
      inCurrentStep: true,
    });
  });

  it('後の工程が要求する型も枠を持つが、今の工程のものとは区別する', () => {
    const mini = miniGame(`
object_defs:
  post: {tags: [item]}
  leaf: {tags: [item]}
  hut:
    tags: [item]
    recipes:
      withYamlContext:
        steps:
          - requires: [{object: post, count: 2, consume: true}]
            duration: 30
          - requires: [{object: leaf, count: 3, consume: true}]
            duration: 60
`);
    const wip = mini.createObject(inProgressObjectName('hut', 'withYamlContext'));

    const materials = craftingMaterials(wip, mini.codex);

    expect(
      materials?.map((material) => material.inCurrentStep),
      '並びは要求の順',
    ).toEqual([true, false]);
    expect(materials?.map((material) => material.needed)).toEqual([2, 3]);
  });
});
