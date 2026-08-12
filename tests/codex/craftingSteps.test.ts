import { describe, expect, it } from 'vitest';
import type { CraftingStep } from '../../src/domain/defs/CraftingStep';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * クラフト工程の抽出（CraftingStep、クラフトネットワークの元データ）の検証。
 * actions・combinations・recipesという文法の違いが「入力 → 工程 → 出力」の同じ形に均されること、
 * 消費される入力とされない入力（道具）が区別されることを確かめる。
 */
describe('クラフト工程の抽出（craftingSteps）', () => {
  const YAML = `
object_defs:
  beach:
    tags: [location]
    actions:
      explore:
        pick:
          - weight: 3
            spawn: {object: coconut, count: 2, into: self}
          - weight: 1
            spawn:
              - {object: coconut, into: self}
              - {object: branch, into: self}
      rest: {}

  coconut:
    tags: [item]
    combinations:
      husk:
        with: cutting_tool
        destroy: self
        spawn:
          - {object: husked_coconut}
          - {object: husk}

  husked_coconut: {tags: [item]}
  husk: {tags: [item]}
  branch: {tags: [item]}
  knife: {tags: [item, cutting_tool]}

  basket:
    tags: [item]
    recipes:
      woven:
        steps:
          - requires:
              - {object: husk, count: 6, consume: true}
              - {object: knife, count: 1, consume: false}
            duration: 60
`;

  const codex = new WorldCodexYamlLoader().load('test.yaml', YAML).build();
  const id = (name: string) => codex.objectNames.getId(name);
  const stepsOf = (name: string): readonly CraftingStep[] => codex.objects.get(id(name)).craftingSteps();

  it('アクションは、何かを生み出すものだけが工程になる', () => {
    const steps = stepsOf('beach');

    // restは何も生まないので工程ではない。
    expect(steps.map((step) => step.name)).toEqual(['explore']);
    expect(steps[0].kind).toBe('action');
  });

  it('探索の出力はpickの候補すべてで、個数は出現した値をすべて持つ', () => {
    const [explore] = stepsOf('beach');

    // 土地は探索で消えない＝消費されない入力。
    expect(explore.inputs).toEqual([{ kind: 'object', objectGlobalId: id('beach'), consumed: false }]);
    // coconutは候補ごとに×2と×1で出る。branchは×1のみ。
    expect(explore.outputs).toEqual([
      { objectGlobalId: id('coconut'), counts: [2, 1] },
      { objectGlobalId: id('branch'), counts: [1] },
    ]);
  });

  it('combinationはselfとwithタグが入力になり、destroyの有無が消費を決める', () => {
    const [husk] = stepsOf('coconut');

    expect(husk.kind).toBe('combination');
    expect(husk.inputs).toEqual([
      // selfはdestroyされるので消費。
      { kind: 'object', objectGlobalId: id('coconut'), consumed: true },
      // 刃物（dragged）はdestroyされないので道具＝消費されない。
      { kind: 'tag', tagGlobalId: codex.tagNames.getId('cutting_tool'), consumed: false },
    ]);
    expect(husk.outputs.map((output) => output.objectGlobalId)).toEqual([id('husked_coconut'), id('husk')]);
  });

  it('レシピは素材・道具が入力、完成品が出力になる', () => {
    const [woven] = stepsOf('basket');

    expect(woven.kind).toBe('recipe');
    expect(woven.inputs).toEqual([
      { kind: 'object', objectGlobalId: id('husk'), consumed: true },
      { kind: 'object', objectGlobalId: id('knife'), consumed: false },
    ]);
    expect(woven.outputs).toEqual([{ objectGlobalId: id('basket'), counts: [1] }]);
  });
});
