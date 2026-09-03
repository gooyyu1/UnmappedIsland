import { describe, expect, it } from 'vitest';
import type { CraftingStep, StepOutcome } from '../../src/analysis/CraftingStep';
import { craftingStepsOf } from '../../src/analysis/craftingSteps';
import { externalTickDeltasOf, rangeCyclesOf } from '../../src/analysis/rangeCycles';
import { buildCraftingNetwork } from '../../src/codex-viewer/craftingGraph';
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
    interactions:
      explore:
        trigger: menu
        duration: 15
        pick:
          - weight: 3
            spawn: {object: coconut, count: 2, into: self}
          - weight: 1
            spawn:
              - {object: coconut, into: self}
              - {object: twig, into: self}
      rest: {trigger: menu}

  coconut:
    tags: [item]
    interactions:
      husk:
        trigger: {drag: {tag: cutting_tool}}
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

  const codex = new WorldCodexYamlLoader().load('test.yaml', YAML).buildAndReset();
  const id = (name: string) => codex.objectNames.getId(name);
  const stepsOf = (name: string): readonly CraftingStep[] =>
    craftingStepsOf(codex, codex.objects.get(id(name)));

  it('何も生み出さないアクションも工程になる', () => {
    const steps = stepsOf('beach');

    expect(steps.map((step) => step.name)).toEqual(['explore', 'rest']);
    expect(steps[0].kind).toBe('interaction');
    // restは値もオブジェクトも動かさないので、何も起きない分岐が1つだけある。
    expect(steps[1].outputs).toEqual([]);
    expect(steps[1].outcomes).toEqual([{ probability: 1, spawns: [], deltas: [], assignments: [] }]);
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
    expect(explore.inputs).toEqual([
      { kind: 'object', objectGlobalId: id('beach'), consumed: false, count: 1 },
    ]);
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
      {
        probability: 0.75,
        spawns: [{ objectGlobalId: id('coconut'), count: 2 }],
        deltas: [],
        assignments: [],
      },
      {
        probability: 0.25,
        spawns: [
          { objectGlobalId: id('coconut'), count: 1 },
          { objectGlobalId: id('twig'), count: 1 },
        ],
        deltas: [],
        assignments: [],
      },
    ]);
  });

  it('combinationはselfとwithタグが入力になり、destroyの有無が消費を決める', () => {
    const [husk] = stepsOf('coconut');

    expect(husk.kind).toBe('interaction');
    expect(husk.inputs).toEqual([
      // selfはdestroyされるので消費。
      { kind: 'object', objectGlobalId: id('coconut'), consumed: true, count: 1 },
      // 刃物（instrument）はdestroyされないので道具＝消費されない。
      { kind: 'tag', tagGlobalId: codex.tagNames.getId('cutting_tool'), consumed: false, count: 1 },
    ]);
    expect(husk.outputs.map((output) => output.objectGlobalId)).toEqual([id('husked_coconut'), id('husk')]);
  });

  it('レシピの要求個数が入力に載る（1個ぶんで数えないため）', () => {
    const [woven] = stepsOf('basket');

    // 6枚の皮から編む。入力を1個ぶんで数えると、総コストが桁ごと変わる。
    expect(woven.inputs.map((input) => input.count)).toEqual([6, 1]);
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
        range: {min: 0, max: 16}
        passives:
          - add: {self: {catch_remaining: -1}}
        on_min:
          add: {self: {catch_remaining: 16}}
          pick:
            - weight: 3
            - weight: 1
              spawn: {object: rat, into: self}
      durability:
        value: 960
        range: {min: 0, max: 960}
        passives:
          - add: {self: {durability: -1}}
        on_min:
          destroy: self
`;
    const trapCodex = new WorldCodexYamlLoader().load('trap.yaml', YAML_TRAP).buildAndReset();
    const snare = trapCodex.objects.get(trapCodex.objectNames.getId('snare'));
    const cycles = rangeCyclesOf(snare);

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
        assignments: [],
      },
      {
        probability: 0.25,
        spawns: [{ objectGlobalId: trapCodex.objectNames.getId('rat'), count: 1 }],
        deltas: [{ target: 'self', propertyGlobalId: expect.any(Number), amount: 16 }],
        assignments: [],
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
      { kind: 'object', objectGlobalId: id('husk'), consumed: true, count: 6 },
      { kind: 'object', objectGlobalId: id('knife'), consumed: false, count: 1 },
    ]);
    expect(woven.outputs).toEqual([{ objectGlobalId: id('basket'), counts: [1] }]);
  });

  /**
   * 外から押されて起こるrangeイベントの検証。炉が子を焼くのも、刺さった傷が持ち主の血を奪うのも、
   * 一撃で血を空にするのも、「値が端を割れば置き換わる」という同じ仕掛けの入口違い。
   */
  describe('外から押されて起こるrangeイベント', () => {
    const YAML_HUNT = `
object_defs:
  hearth:
    tags: [fixture]
    slots:
      fire:
        cell: {accept: {tag: roastable}}
    props:
      heat:
        value: 0
        stages:
          - {name: out}
          - name: lit
            min: 1
            passives:
              - add: {child: {cooking_progress: 3, heat_soak: 3}}

  stone:
    tags: [item, roastable]
    props:
      heat_soak:
        value: 0
        range: {min: 0, max: 12}
        passives:
          # 冷めるのは炉の外に居る間だけ。押し手（炉）と同時には効かない。
          - conditions:
              - not: {subject: ancestor, prop: heat, gt: 0}
            add: {self: {heat_soak: -3}}
        on_max:
          destroy: self
          spawn: {object: hot_stone}

  hot_stone: {tags: [item]}

  raw_meat:
    tags: [item, roastable]
    props:
      cooking_progress:
        value: 0
        range: {min: 0, max: 24}
        on_max:
          destroy: self
          spawn: {object: roasted_meat}

  roasted_meat: {tags: [item, roastable]}

  wound:
    tags: [injury]
    bound_to_owner: true
    props:
      bleeding:
        value: 100
        range: {min: 0, max: 100}
        passives:
          - add: {self: {bleeding: -25}}
    passives:
      - conditions: [{prop: bleeding, gte: 1}]
        add: {parent: {blood: -15}}

  rat:
    tags: [item]
    slots:
      injuries:
        cell: {accept: {tag: injury}}
    props:
      blood:
        value: 6
        range: {min: 0, max: 6}
        on_min:
          destroy: self
          spawn: {object: rat_carcass}

  boar:
    tags: [item]
    slots:
      injuries:
        cell: {accept: {tag: injury}}
    props:
      blood:
        value: 4600
        range: {min: 0, max: 4600}
        on_min:
          destroy: self
          spawn: {object: boar_carcass}
    interactions:
      strike:
        trigger: {drag: {tag: weapon}}
        duration: 15
        pick:
          - weight: 19
          - weight: 1
            set: {self: {blood: 0}}

  rat_carcass: {tags: [item]}
  boar_carcass: {tags: [item]}
  club: {tags: [item, weapon]}
`;
    const huntCodex = new WorldCodexYamlLoader().load('hunt.yaml', YAML_HUNT).buildAndReset();
    const huntId = (name: string) => huntCodex.objectNames.getId(name);
    const defOf = (name: string) => huntCodex.objects.get(huntId(name));
    const drivers = (source: string, root: 'parent' | 'child') => externalTickDeltasOf(defOf(source), root);

    it('炉が進める加熱は、炉を道具に要る1回きりの周期になる', () => {
      const [cooking] = rangeCyclesOf(defOf('raw_meat'), undefined, drivers('hearth', 'child'));

      // maxちょうどでon_maxが起きる（6.3節）ので、届くべき距離は24。3/tickなので8 tick。
      expect(cooking.minutes).toBeCloseTo((24 / 3) * 15);
      expect(cooking.repeats).toBe(false);
      expect(cooking.drivenBy).toBe(huntId('hearth'));
      expect(cooking.step.laborMinutes).toBe(0);
      expect(cooking.step.inputs).toEqual([
        { kind: 'object', objectGlobalId: huntId('raw_meat'), consumed: true, count: 1 },
        { kind: 'object', objectGlobalId: huntId('hearth'), consumed: false, count: 1 },
      ]);
      expect(cooking.step.outputs).toEqual([{ objectGlobalId: huntId('roasted_meat'), counts: [1] }]);
    });

    it('押されている間は、自分の条件つきの増減を数えない', () => {
      // 石が冷めるのは炉の外に居る間の宣言（-3/tick）。押し手（+3/tick）へ足すと向きが消えて、
      // 熱を溜め切る周期そのものが立たなくなる。12 ÷ 3 = 4 tick で焼け石になる。
      const [soaking] = rangeCyclesOf(defOf('stone'), undefined, drivers('hearth', 'child'));

      expect(soaking.minutes).toBeCloseTo((12 / 3) * 15);
      expect(soaking.drivenBy).toBe(huntId('hearth'));
      expect(soaking.step.outputs).toEqual([{ objectGlobalId: huntId('hot_stone'), counts: [1] }]);
    });

    it('出血で死ぬのは、傷が固まるまでに奪える血の量が足りる獲物だけ', () => {
      // 100 ÷ 25 = 4 tick で固まるので、奪えるのは合計60mL。
      expect(drivers('wound', 'parent')).toEqual([
        {
          sourceGlobalId: huntId('wound'),
          propertyGlobalId: expect.any(Number),
          slowest: -15,
          fastest: -15,
          maxTotal: 60,
        },
      ]);

      expect(rangeCyclesOf(defOf('rat'), undefined, drivers('wound', 'parent'))).toHaveLength(1);
      expect(rangeCyclesOf(defOf('boar'), undefined, drivers('wound', 'parent'))).toEqual([]);
    });

    it('一撃で値を端の外へ押す工程は、そこで起こることまで含めて1つの工程になる', () => {
      const [strike] = craftingStepsOf(huntCodex, defOf('boar'));

      // 20回に1回しか仕留められないので、1回の実行で要る獲物もその確率ぶん。
      expect(strike.inputs).toEqual([
        { kind: 'object', objectGlobalId: huntId('boar'), consumed: true, count: 0.05 },
        { kind: 'tag', tagGlobalId: expect.any(Number), consumed: false, count: 1 },
      ]);
      expect(strike.outputs).toEqual([{ objectGlobalId: huntId('boar_carcass'), counts: [1] }]);
      expect(strike.outcomes.find((outcome) => outcome.spawns.length > 0)?.probability).toBe(0.05);
    });
  });

  /**
   * 軸に沿って型が変わる工程（`become`、9.9節）の検証。同じ個体が続くので何も湧かないが、
   * **変わった先の型はそこで手に入る**——雨を受け始めた空の容器は、そこで水入りの容器になる。
   */
  describe('軸に沿って型が変わる工程', () => {
    const YAML_LIQUID = `
traits:
  liquid:
    tags: [liquid]

  water_liquid:
    tags: [water]

object_defs:
  jar:
    tags: [item]
    props:
      fill:
        value: 0
        range: {min: 0, max: 4000}
      weight: {value: 1200}
    variation_axes:
      content: {of: {tag: liquid}}
    interactions:
      collect_rain:
        trigger: menu
        become: {content: water_liquid}
        set: {self: {fill: 1}}

  bowl:
    tags: [item]
    props:
      fill:
        value: 0
        range: {min: 0, max: 250}
      weight: {value: 200}
    variation_axes:
      content: {of: {tag: liquid}}

  hot_stone:
    tags: [item]
    interactions:
      boil:
        trigger: {drag: {tag: water}}
        duration: 5
        become: {subject: instrument, content: hot_water_liquid}

  water_liquid:
    traits: [liquid, water_liquid]

  hot_water_liquid:
    traits: [liquid]
`;
    const liquidCodex = new WorldCodexYamlLoader().load('liquid.yaml', YAML_LIQUID).buildAndReset();
    const liquidId = (name: string) => liquidCodex.objectNames.getId(name);

    it('becomeの行き先が産出になり、変わる前の型は使い切られる', () => {
      const [collectRain] = craftingStepsOf(liquidCodex, liquidCodex.objects.get(liquidId('jar')));

      expect(collectRain.name).toBe('collect_rain');
      expect(collectRain.outputs).toEqual([
        { objectGlobalId: liquidId('jar__content_water_liquid'), counts: [1] },
      ]);
      // 空の容器はここで水入りの容器になるので、その型のままでは残らない。
      expect(collectRain.inputs).toEqual([
        { kind: 'object', objectGlobalId: liquidId('jar'), consumed: true, count: 1 },
      ]);
    });

    it('相手をタグで指したbecomeは、相手の型ごとに別の工程になる', () => {
      const steps = craftingStepsOf(liquidCodex, liquidCodex.objects.get(liquidId('hot_stone')));

      // 甕の水とヤシの器の水では沸いた先の型が違うので、タグのまま1つの工程にすると行き先が定まらず、
      // 湯の入った容器の作り方がどこにも無くなる。軸を持たない`water_liquid`そのものは候補にしない
      // ——行き先を解けない相手を並べても、産物の無い工程が増えるだけ。
      expect(steps.map((step) => step.inputs[1])).toEqual([
        { kind: 'object', objectGlobalId: liquidId('jar__content_water_liquid'), consumed: true, count: 1 },
        { kind: 'object', objectGlobalId: liquidId('bowl__content_water_liquid'), consumed: true, count: 1 },
      ]);
      expect(steps.flatMap((step) => step.outputs)).toEqual([
        { objectGlobalId: liquidId('jar__content_hot_water_liquid'), counts: [1] },
        { objectGlobalId: liquidId('bowl__content_hot_water_liquid'), counts: [1] },
      ]);
    });
  });

  /**
   * 条件（14節）が定義だけから偽と分かる操作を立てない検証。中身入りの容器が雨を受け始められない
   * ことは、`fill`が0でその型でなくなる（空の容器へ戻る）ことから決まる——宣言された初期値は
   * 空の容器と同じ0なので、初期値だけを見ても分からない。
   */
  describe('起こりえない操作', () => {
    const YAML_CONDITIONS = `
traits:
  liquid:
    tags: [liquid]

  water_liquid:
    tags: [water]

object_defs:
  jar:
    tags: [item]
    props:
      fill:
        value: 0
        range: {min: 0, max: 4000}
        on_min:
          become: {content: none}
      weight: {value: 1200}
    variation_axes:
      content: {of: {tag: liquid}}
    interactions:
      collect_rain:
        trigger: menu
        conditions:
          - {subject: ancestor, prop: ambient_brightness, lt: 5}
          - {subject: self, prop: fill, eq: 0}
        become: {content: water_liquid}
        set: {self: {fill: 1}}
      overflow:
        trigger: menu
        conditions:
          - {subject: self, prop: fill, gt: 4000}
        set: {self: {fill: 0}}

  water_liquid:
    traits: [liquid, water_liquid]
`;
    const conditionCodex = new WorldCodexYamlLoader()
      .load('conditions.yaml', YAML_CONDITIONS)
      .buildAndReset();
    const stepNamesOf = (name: string): readonly string[] =>
      craftingStepsOf(conditionCodex, conditionCodex.objects.get(conditionCodex.objectNames.getId(name))).map(
        (step) => step.name,
      );

    it('range全体が外れる条件を持つ操作は立たない', () => {
      // fillの上限が4000なので、4000より大きいことを求める操作はどの個体でも起こせない。
      expect(stepNamesOf('jar')).not.toContain('overflow');
    });

    it('端でその型でなくなる値を求める操作は、その型では立たない', () => {
      // 中身入りの容器はfillが0になった瞬間に空の容器へ戻るので、0であることを求められない。
      expect(stepNamesOf('jar__content_water_liquid')).not.toContain('collect_rain');
    });

    it('同じ条件でも、その端に留まれる型では立つ', () => {
      // 空の容器のon_minは自分自身へ戻るだけなので、fillが0のままでいられる。
      expect(stepNamesOf('jar')).toContain('collect_rain');
    });
  });

  /**
   * 仕込んだ在庫を重みにした抽選の読み方の検証。**候補が自分の重みの値を自分で減らしている**なら、
   * その値はつまみではなくプレイヤーが仕込む在庫で、宣言された初期値は「まだ何も仕込んでいない
   * 状態」でしかない。そこで重みを読むと、設備が何を返すかを一度も数えないことになる。
   */
  describe('仕込んだ在庫を重みにした抽選', () => {
    const YAML_STOCK = `
object_defs:
  salt: {tags: [item]}
  shell: {tags: [item]}

  pan:
    tags: [fixture]
    props:
      # 仕込んだ在庫。汲むたびに増え、干し上がるたびに減るので初期値は空。
      brine: {value: 0, range: {min: 0, max: 8}}
      # 仕込む物ではないつまみ。宣言された値そのものが答えになる。
      shell_weight: {value: 3}
      drying_remaining:
        value: 24
        range: {min: 0, max: 24}
        passives:
          - add: {self: {drying_remaining: -1}}
        on_min:
          add: {self: {drying_remaining: 24}}
          pick:
            - weight: 0
            - weight: {prop: shell_weight}
              spawn: {object: shell, into: self}
            - weight: {prop: brine}
              add: {self: {brine: -1}}
              spawn: {object: salt, into: self}
`;
    const stockCodex = new WorldCodexYamlLoader().load('stock.yaml', YAML_STOCK).buildAndReset();
    const pan = stockCodex.objects.get(stockCodex.objectNames.getId('pan'));
    const [drying] = rangeCyclesOf(pan);
    const spawnedIn = (outcome: StepOutcome): string[] =>
      outcome.spawns.map((spawn) => stockCodex.objectNames.getName(spawn.objectGlobalId));

    it('在庫を減らす候補は、1回ぶん仕込んであるとして重みを読む', () => {
      const salt = drying.step.outcomes.find((outcome) => spawnedIn(outcome).includes('salt'));

      // 在庫の重みは1杯ぶんの1、つまみは3で、何も起きない回の0と合わせて4。
      expect(salt?.probability).toBeCloseTo(1 / 4);
    });

    it('在庫を減らさない候補の重みは、宣言値のまま読む', () => {
      const shell = drying.step.outcomes.find((outcome) => spawnedIn(outcome).includes('shell'));

      expect(shell?.probability).toBeCloseTo(3 / 4);
    });
  });

  /**
   * 行っている人（agent）を指す参照（craftingStepsのwithHighestDeclaredAgent）。**呼び出し側が文脈を
   * 渡さなくても解ける唯一の起点**で、これが無いと腕前が掛かる重み（docs/world/Skills.md 5節）が
   * 0になり、その候補は起こらないものとして数えられる。
   */
  describe('行っている人を指す重み', () => {
    const YAML_AGENT = `
object_defs:
  medic:
    tags: [character]
    props:
      quarry_sense: {value: 2}

  captain:
    tags: [character]
    props:
      quarry_sense: {value: 3}

  grassland:
    tags: [location]
    props:
      rat_find: {value: 2}
    interactions:
      explore:
        trigger: menu
        duration: 15
        pick:
          - weight: 8
          - weight: {prop: rat_find, times: {subject: agent, prop: quarry_sense}}
            spawn: {object: rat, into: self}
      listen:
        trigger: menu
        duration: 15
        pick:
          - weight: 8
          - weight: {prop: rat_find, times: {subject: agent, prop: keen_ear}}
            spawn: {object: rat, into: self}

  rat: {tags: [item]}
`;
    const agentCodex = new WorldCodexYamlLoader().load('agent.yaml', YAML_AGENT).buildAndReset();
    const ratId = agentCodex.objectNames.getId('rat');
    const stepNamed = (name: string): CraftingStep =>
      craftingStepsOf(agentCodex, agentCodex.objects.get(agentCodex.objectNames.getId('grassland'))).find(
        (step) => step.name === name,
      )!;
    const ratChance = (step: CraftingStep): number | undefined =>
      step.outcomes.find((outcome) => outcome.spawns.some((spawn) => spawn.objectGlobalId === ratId))
        ?.probability;

    it('キャラクタが宣言している値で解ける（候補が消えない）', () => {
      // 宣言が個体で分かれるときは最も高い1人に合わせる（船長の3）ので、重みは2×3＝6、
      // 何も起きない回の8と合わせて14。
      expect(ratChance(stepNamed('explore'))).toBeCloseTo(6 / 14);
      expect(stepNamed('explore').hasUnresolvedReferences).toBe(false);
    });

    it('どのキャラクタも宣言していない値は解けないまま、印が立つ', () => {
      // 埋められるのは宣言されているものだけ。解けない参照は0として数え、そのぶん配分が歪むことを
      // 読み手へ告げる（CraftingStep.hasUnresolvedReferences）。
      expect(ratChance(stepNamed('listen'))).toBe(0);
      expect(stepNamed('listen').hasUnresolvedReferences).toBe(true);
    });
  });
});
