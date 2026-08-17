import { describe, expect, it } from 'vitest';
import { buildCraftingNetwork } from '../../src/codex-viewer/craftingGraph';
import type { CraftingStep } from '../../src/domain/defs/CraftingStep';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * 工程の抽出（CraftingStep）の検証。actions・combinations・recipesという文法の違いが
 * 「入力 → 工程 → 出力」の同じ形に均されること、消費される入力とされない入力（道具）が
 * 区別されること、そして所要時間と分岐（pickの候補と重み）がそのまま残ることを確かめる。
 */
describe('クラフト工程の抽出（craftingSteps）', () => {
  const YAML = `
object_defs:
  beach:
    tags: [location]
    actions:
      explore:
        duration: 15
        pick:
          - weight: 3
            spawn: {object: coconut, count: 2, into: self}
          - weight: 1
            spawn:
              - {object: coconut, into: self}
              - {object: twig, into: self}
      rest: {}

  coconut:
    tags: [item]
    combinations:
      husk:
        with: {tag: cutting_tool}
        destroy: self
        spawn:
          - {object: husked_coconut}
          - {object: husk}

  husked_coconut: {tags: [item]}
  husk: {tags: [item]}
  twig: {tags: [item]}
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

  it('何も生み出さないアクションも工程になる', () => {
    const steps = stepsOf('beach');

    expect(steps.map((step) => step.name)).toEqual(['explore', 'rest']);
    expect(steps[0].kind).toBe('action');
    // restは値もオブジェクトも動かさないので、何も起きない分岐が1つだけある。
    expect(steps[1].outputs).toEqual([]);
    expect(steps[1].outcomes).toEqual([{ probability: 1, spawns: [], deltas: [] }]);
  });

  it('クラフトネットワークは、出力を持つ工程だけを描く', () => {
    const network = buildCraftingNetwork(
      [...Array(codex.objects.count).keys()].map((globalId) => codex.objects.get(globalId)),
      codex,
    );

    const stepNames = network.nodes.filter((node) => node.kind === 'step').map((node) => node.stepName);
    expect(stepNames).toContain('explore');
    expect(stepNames).not.toContain('rest');
  });

  it('探索の出力はpickの候補すべてで、個数は出現した値をすべて持つ', () => {
    const [explore] = stepsOf('beach');

    // 土地は探索で消えない＝消費されない入力。
    expect(explore.inputs).toEqual([{ kind: 'object', objectGlobalId: id('beach'), consumed: false }]);
    // coconutは候補ごとに×2と×1で出る。twigは×1のみ。
    expect(explore.outputs).toEqual([
      { objectGlobalId: id('coconut'), counts: [2, 1] },
      { objectGlobalId: id('twig'), counts: [1] },
    ]);
  });

  it('工程は所要時間と、weightから解いた確率つきの分岐を持つ', () => {
    const [explore] = stepsOf('beach');

    // プレイヤーが手を止めている工程なので、払う時間と経過する時間は等しい。
    expect(explore.laborMinutes).toBe(15);
    expect(explore.elapsedMinutes).toBe(15);
    expect(explore.hasUnresolvedReferences).toBe(false);
    expect(explore.outcomes).toEqual([
      { probability: 0.75, spawns: [{ objectGlobalId: id('coconut'), count: 2 }], deltas: [] },
      {
        probability: 0.25,
        spawns: [
          { objectGlobalId: id('coconut'), count: 1 },
          { objectGlobalId: id('twig'), count: 1 },
        ],
        deltas: [],
      },
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

  it('tick毎に減る値がrangeの端で戻る仕掛けは、周期を持つ工程になる', () => {
    const YAML_TRAP = `
object_defs:
  rat: {tags: [item]}
  snare:
    tags: [item]
    props:
      catch_remaining:
        value: 16
        range: {min: 1, max: 16}
        passives:
          - add: {self: {catch_remaining: -1}}
        on_shortfall:
          add: {self: {catch_remaining: 16}}
          pick:
            - weight: 3
            - weight: 1
              spawn: {object: rat, into: self}
      durability:
        value: 960
        range: {min: 1, max: 960}
        passives:
          - add: {self: {durability: -1}}
        on_shortfall:
          destroy: self
`;
    const trapCodex = new WorldCodexYamlLoader().load('trap.yaml', YAML_TRAP).build();
    const snare = trapCodex.objects.get(trapCodex.objectNames.getId('snare'));
    const cycles = snare.rangeCycles();

    // 16 tick で1周（16 × 15分）。プレイヤーは何も払わないので、労働時間は0。
    const [judgement, lifetime] = cycles;
    expect(judgement.repeats).toBe(true);
    expect(judgement.minutes).toBe(240);
    expect(judgement.step.laborMinutes).toBe(0);
    expect(judgement.step.elapsedMinutes).toBe(240);
    expect(judgement.step.outcomes).toEqual([
      {
        probability: 0.75,
        spawns: [],
        deltas: [{ target: 'self', propertyGlobalId: expect.any(Number), amount: 16 }],
      },
      {
        probability: 0.25,
        spawns: [{ objectGlobalId: trapCodex.objectNames.getId('rat'), count: 1 }],
        deltas: [{ target: 'self', propertyGlobalId: expect.any(Number), amount: 16 }],
      },
    ]);

    // 値が戻らず自分が消える側は寿命（960 tick = 10日）。
    expect(lifetime.repeats).toBe(false);
    expect(lifetime.destroysSelf).toBe(true);
    expect(lifetime.minutes).toBe(960 * 15);
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
