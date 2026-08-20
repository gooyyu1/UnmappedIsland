import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { NewGameSession } from '../../src/domain/generation/NewGame';
import { start as startNewGame } from '../../src/domain/generation/NewGame';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { craftingActions, craftingMaterials } from '../../src/game/view/craftingView';
import { inProgressObjectName, MATERIALS_SLOT } from '../../src/loader/inProgressObjects';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { SeededRng } from '../support/SeededRng';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 製作中オブジェクトが出す操作と、材料の枠が要求しているもの（craftingView）の自動テスト。
 *
 * **画面を作らずに確かめられる**のがこの層の値打ちで、押せるか・理由は何か・あと何が要るかを
 * ワールドの状態から直に見る。
 */
describe('製作中オブジェクトの操作と材料の枠', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
  });

  /** 編み籠を作りかけの状態で足元に置いた世界（woven: 編んだ葉6枚で120分）。 */
  function startWeaving(): { game: NewGameSession; wip: WorldObject } {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const wip = game.session.spawn(codex.objectNames.getId(inProgressObjectName('woven_basket', 'woven')));
    expect(wip.moveToSlot(game.startLocation.instance, codex.slotNames.getId('items'))).toBeUndefined();
    return { game, wip };
  }

  /** その型をcount個、手持ちへ入れる。 */
  function intoHand(game: NewGameSession, name: string, count: number): void {
    for (let i = 0; i < count; i += 1) {
      const object = game.session.spawn(codex.objectNames.getId(name));
      expect(object.moveToSlot(game.player.instance, codex.slotNames.getId('hand'))).toBeUndefined();
    }
  }

  const materialsIn = (wip: WorldObject): readonly WorldObject[] =>
    wip.tryGetSlot(codex.slotNames.getId(MATERIALS_SLOT))?.contents ?? [];

  it('製作中でない物は、操作も材料の枠も持たない', () => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const stone = game.session.spawn(codex.objectNames.getId('stone'));

    expect(craftingActions(stone, codex, game)).toEqual([]);
    expect(craftingMaterials(stone, codex)).toBeUndefined();
  });

  it('操作は自動補充・作業する・中断の3つで、素材が足りなければ作業できない', () => {
    const { game, wip } = startWeaving();

    const actions = craftingActions(wip, codex, game);
    expect(actions.map((action) => action.name)).toEqual(['自動補充', '作業する', '中断']);

    const work = actions[1];
    expect(work.minutes, 'かかるのは今の工程のぶん').toBe(120);
    expect(work.enabled).toBe(false);
    expect(work.reason).toBe('素材が足りない。');
  });

  it('自動補充は手持ちから素材を入れ、揃えば作業できるようになる', () => {
    const { game, wip } = startWeaving();
    intoHand(game, 'woven_leaf', 6);

    craftingActions(wip, codex, game)[0].execute();

    expect(materialsIn(wip), '要求されている6枚が入る').toHaveLength(6);
    expect(
      game.player.hand.filter((object) => object !== undefined),
      '手持ちからは出ていく',
    ).toHaveLength(0);
    expect(craftingActions(wip, codex, game)[1].enabled, '揃ったので作業できる').toBe(true);
  });

  it('作業すると工程が進み、出来上がると同じ札が完成品になる', () => {
    const { game, wip } = startWeaving();
    intoHand(game, 'woven_leaf', 6);
    craftingActions(wip, codex, game)[0].execute();

    craftingActions(wip, codex, game)[1].execute();

    expect(
      game.startLocation.items.some((object) => object.def.name === 'woven_basket'),
      '1工程しかないレシピなので、1回の作業で編み籠になる',
    ).toBe(true);
    expect(wip.def.name, '作りかけの札がそのまま編み籠になる（become、9.9節）').toBe('woven_basket');
  });

  it('中断すると作りかけは消え、入れてあった素材はその場へこぼれる', () => {
    const { game, wip } = startWeaving();
    intoHand(game, 'woven_leaf', 6);
    craftingActions(wip, codex, game)[0].execute();

    craftingActions(wip, codex, game)[2].execute();

    expect(game.startLocation.items, '作りかけはもう無い').not.toContain(wip);
    expect(
      game.startLocation.items.filter((object) => object.def.name === 'woven_leaf'),
      '入れてあった素材は足元へ',
    ).toHaveLength(6);
  });

  it('材料の枠は、要求している型と、あと何個要るか・今何個入っているかを答える', () => {
    const { game, wip } = startWeaving();
    intoHand(game, 'woven_leaf', 2);
    craftingActions(wip, codex, game)[0].execute();

    const materials = craftingMaterials(wip, codex);

    expect(materials).toHaveLength(1);
    expect(materials?.[0]).toMatchObject({
      objectGlobalIds: [codex.objectNames.getId('woven_leaf')],
      needed: 6,
      held: 2,
      inCurrentStep: true,
    });
  });

  it('後の工程が要求する型も枠を持つが、今の工程のものとは区別する', () => {
    // 実際のレシピはどれも1工程なので、2工程のレシピを持つ小さな世界で確かめる。
    const twoSteps = new WorldCodexYamlLoader()
      .load(
        'hut.yaml',
        `
object_defs:
  hut:
    tags: [item]
    recipes:
      built:
        steps:
          - requires: [{object: post, count: 2, consume: true}]
            duration: 30
          - requires: [{object: leaf, count: 3, consume: true}]
            duration: 60
  post: {tags: [item]}
  leaf: {tags: [item]}
`,
      )
      .build();
    const session = new WorldSession(twoSteps);
    const wip = session.spawn(twoSteps.objectNames.getId(inProgressObjectName('hut', 'built')));

    const materials = craftingMaterials(wip, twoSteps);

    expect(
      materials?.map((material) => material.inCurrentStep),
      '並びは要求の順',
    ).toEqual([true, false]);
    expect(materials?.map((material) => material.needed)).toEqual([2, 3]);
  });
});
