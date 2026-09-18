import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { Location } from '../../src/domain/wrappers/Location';
import { World } from '../../src/domain/wrappers/World';
import { bundledCodex } from '../support/worldCodexFiles';
import { createBrightEnoughAgent } from '../support/illumination';
import { seededRng } from '../../src/domain/Rng';
import type { PropertyGlobalId } from '../../src/domain/GlobalId';

/**
 * 探索1回で見つかる物（locations.yamlのexploreのpickテーブル）を、実際に探索を繰り返して検証する。
 *
 * 重みの合計と候補ごとの個数から期待値は手計算できるが、YAMLを読み直すテストは重みの解釈をローダーと
 * 二重に持つことになるため、実行して数える。試行回数は、期待値の推定誤差が許容幅より十分小さくなる数
 * （1回あたりの標準偏差は高々1個程度なので、300回なら標準誤差は0.06個ほどで、許容幅の±0.15より小さい）。
 */

const TRIALS = 300;

/**
 * 獣の候補を確かめるときの試行回数。**立ち去りまでの残り（`stay_remaining` = 96 tick、
 * HuntingSystem.md 5.6節）より少なくする**——1回の探索が1 tickなので、これを超えると先に湧いた獣が
 * 消え始め、増えた数が湧いた数と合わなくなる。
 */
const BEAST_TRIALS = 80;

/** 土地ごとに期待する平均個数の範囲。実りの多い土地は約2個、乏しい土地は約1.6個。 */
const EXPECTED_MEAN: ReadonlyMap<string, readonly [number, number]> = new Map([
  ['sandy_beach', [1.9, 2.2]],
  ['rocky_coast', [1.9, 2.2]],
  ['grassland', [1.9, 2.2]],
  ['forest', [1.9, 2.2]],
  ['jungle', [1.9, 2.2]],
  ['rocky_field', [1.9, 2.2]],
  ['mountainside', [1.9, 2.2]],
  ['cliff_coast', [1.4, 1.8]],
  ['wasteland', [1.4, 1.8]],
  ['mountain_peak', [1.4, 1.8]],
]);

/** 土地ごとの、出くわす獣とそのつまみ（docs/world/Animals.md 8節）。ネズミはどの土地にも居る。 */
const BEAST_FINDS: readonly (readonly [string, string, string])[] = [
  ['sandy_beach', 'rat_find', 'rat'],
  ['sandy_beach', 'monkey_find', 'monkey'],
  ['rocky_coast', 'rat_find', 'rat'],
  ['rocky_coast', 'monkey_find', 'monkey'],
  ['cliff_coast', 'rat_find', 'rat'],
  ['cliff_coast', 'monkey_find', 'monkey'],
  ['grassland', 'rat_find', 'rat'],
  ['grassland', 'junglefowl_find', 'junglefowl'],
  ['forest', 'rat_find', 'rat'],
  ['forest', 'monkey_find', 'monkey'],
  ['forest', 'wild_boar_find', 'wild_boar'],
  ['jungle', 'rat_find', 'rat'],
  ['jungle', 'junglefowl_find', 'junglefowl'],
  ['jungle', 'monkey_find', 'monkey'],
  ['jungle', 'wild_boar_find', 'wild_boar'],
  ['rocky_field', 'rat_find', 'rat'],
  ['wasteland', 'rat_find', 'rat'],
  ['mountainside', 'rat_find', 'rat'],
  ['mountain_peak', 'rat_find', 'rat'],
];

/** 1回の探索で新しく見つかった物（object_def名 → 個数）。 */
type Finding = ReadonlyMap<string, number>;

/** 1回の探索の結果。見つかった物と、探索した人の腕がその回に伸びた分。 */
interface ExploreTrial {
  readonly finding: Finding;
  readonly skillGain: number;
}

/**
 * 発見の契機（docs/engine/SkillSystem.md 3.3節）。その型が見つかった探索でだけ、その腕が伸びる。
 *
 * **土地は、その腕の契機を引ける1つを選べばよい**——契機がどの土地にも残ることは
 * `tests/world-codex/skillsYaml.test.ts` が島を生成して見張る。ここで問うのは、書いた`add`が探索した
 * 人へ本当に届いているかのほう。
 */
const DISCOVERY_GRANTS: readonly {
  readonly land: string;
  readonly skill: string;
  readonly types: readonly string[];
  /** 獣を止めて数えるか（獣が出くわす相手そのものである狩猟では止められない）。 */
  readonly silenceBeasts: boolean;
  readonly trials: number;
}[] = [
  { land: 'wasteland', skill: 'skill_knapping', types: ['stone'], silenceBeasts: true, trials: TRIALS },
  {
    land: 'jungle',
    skill: 'skill_cordage',
    types: ['palm_tree', 'coconut', 'abaca', 'banana_plant'],
    silenceBeasts: true,
    trials: TRIALS,
  },
  {
    land: 'jungle',
    skill: 'skill_woodwork',
    types: ['broadleaf_tree', 'sapling'],
    silenceBeasts: true,
    trials: TRIALS,
  },
  {
    land: 'forest',
    skill: 'skill_hunting',
    types: ['rat', 'monkey', 'wild_boar'],
    silenceBeasts: false,
    trials: BEAST_TRIALS,
  },
];

describe('探索で見つかる物', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    codex = bundledCodex();
  });

  /**
   * その土地を1つ作り（propsを渡せばつまみを上書きして）、trials回探索して、1回ごとの発見物を返す。
   * huntingSkillは探索する人の狩猟の腕で、獣のつまみが`base`の土台にする（Skills.md 5節）。
   *
   * 進捗は探索のたびに増えるが、rangeの上限に張り付いた後も発見物の抽選は続く（ExplorationSystem.md
   * 2節）ため、試行回数が進捗の上限を超えても数え方は変わらない。
   */
  function findingsOf(
    landName: string,
    props: ReadonlyMap<PropertyGlobalId, number> = new Map(),
    trials: number = TRIALS,
    huntingSkill = 0,
  ): Finding[] {
    return trialsOf(landName, props, trials, huntingSkill).map((trial) => trial.finding);
  }

  /**
   * {@link findingsOf} と同じ探索を回し、見つかった物に加えて、探索した人の腕がその回に伸びた分も返す。
   * `watchedSkill` を渡さない限り伸びは常に0（腕を読まないだけで、探索の回し方は変わらない）。
   */
  function trialsOf(
    landName: string,
    props: ReadonlyMap<PropertyGlobalId, number> = new Map(),
    trials: number = TRIALS,
    huntingSkill = 0,
    watchedSkill?: string,
  ): ExploreTrial[] {
    const session = new WorldSession(codex);
    const worldInstance = new WorldObject(1, codex.objects.get(codex.objectNames.getId('world')), session);
    const worldView = new World(worldInstance);
    const explorer = new WorldSession(codex, worldView, seededRng(20250801));

    const instance = explorer.createObject(codex.objectNames.getId(landName));
    for (const [propertyGlobalId, value] of props)
      instance.getProperty(propertyGlobalId).setNumberWithoutEvents(value);
    expect(
      instance.moveToSlotOrRejection(worldInstance.getSlot(codex.slotNames.getId('locations'))),
    ).toBeUndefined();
    const location = new Location(instance);
    // 探索には視界の明るさが要る（IlluminationSystem.md 5節）。ここで見たいのは抽選卓なので、
    // 時刻を作らずに探索者の側で明るさを満たす。
    const agent = createBrightEnoughAgent(explorer);
    agent.getProperty(codex.propertyNames.getId('skill_hunting')).setNumberWithoutEvents(huntingSkill);

    // **見つかった物は、個数の差ではなく個体で数える**——置かれた物は腐って消える（食べ物の
    // durability、DurabilitySystem.md 3節）ので、消えた数と見つかった数が打ち消し合うと、
    // 見つかっているのに0個に見える。
    const watched =
      watchedSkill === undefined ? undefined : agent.getProperty(codex.propertyNames.getId(watchedSkill));

    const results: ExploreTrial[] = [];
    const seen = new Set<WorldObject>();
    let before = watched?.getEffectiveValue() ?? 0;
    for (let i = 0; i < trials; i++) {
      expect(location.explore(agent), `${landName}: 探索は必ず成立する`).toBe(true);
      const present = [...location.items, ...location.fixtures];
      const after = watched?.getEffectiveValue() ?? 0;
      results.push({
        finding: countByName(present.filter((object) => !seen.has(object))),
        skillGain: after - before,
      });
      before = after;
      for (const object of present) seen.add(object);
    }
    return results;
  }

  /**
   * その土地の獣のつまみを0にした上書き。**卓の当たりだけを数えるために獣を止める**——湧いた獣は
   * その後も動き、くわえた物を落として立ち去る（HuntingSystem.md 5.4・5.6節）ので、そのぶんの
   * 増減が「1回の探索で見つかった数」に混ざる。獣の候補そのものは下のテストが受け持つ。
   */
  function withoutBeasts(landName: string): ReadonlyMap<PropertyGlobalId, number> {
    return new Map(
      BEAST_FINDS.filter(([land]) => land === landName).map(([, knob]) => [
        codex.propertyNames.getId(knob),
        0,
      ]),
    );
  }

  it.each([...EXPECTED_MEAN.keys()])('%s の探索はハズレが無く、1〜3個が見つかる', (landName) => {
    const counts = findingsOf(landName, withoutBeasts(landName)).map(total);
    const [low, high] = EXPECTED_MEAN.get(landName)!;
    const mean = counts.reduce((sum, v) => sum + v, 0) / counts.length;
    const multiple = counts.filter((n) => n >= 2).length / counts.length;

    expect(Math.min(...counts), `${landName}: 何も見つからない探索は無い`).toBeGreaterThanOrEqual(1);
    expect(Math.max(...counts), `${landName}: 1回で見つかるのは高々3個`).toBeLessThanOrEqual(3);
    expect(mean, `${landName}: 1回あたりの平均`).toBeGreaterThan(low);
    expect(mean, `${landName}: 1回あたりの平均`).toBeLessThan(high);
    // 「複数見つかることもある」ではなく「複数の方が普通」を狙っている。乏しい土地でも4割は超える。
    expect(multiple, `${landName}: 2個以上見つかる割合`).toBeGreaterThan(0.4);
  });

  it('発見量のつまみが、その候補の出やすさを決める', () => {
    // 亜種（TerrainGeneration.md 3.6節）は、このつまみを土地ごとに上書きして個体差を作る。
    // 重み0の候補は抽選から外れる（PickEffect）ので、上下の端は確率ではなく不変条件で確かめられる。
    const palmFindId = codex.propertyNames.getId('palm_find');
    const palmsWith = (weight: number): number =>
      findingsOf('sandy_beach', new Map([[palmFindId, weight]])).reduce(
        (sum, finding) => sum + (finding.get('palm_tree') ?? 0),
        0,
      );

    expect(palmsWith(0), '重み0なら出ない').toBe(0);
    expect(palmsWith(10000), '重みが他を圧倒すればほぼ毎回出る').toBeGreaterThan(TRIALS * 0.9);
  });

  it('狩猟の腕は、獣のつまみへ上乗せとして積まれる', () => {
    // 腕が動かすのは獣のつまみだけで、卓そのものは変わらない（docs/world/Skills.md 5節）。
    // ネズミしか居ない荒野で、つまみと腕の両側から同じ重みを作って確かめる。
    const ratFindId = codex.propertyNames.getId('rat_find');
    const rats = (ratFind: number, huntingSkill: number): number =>
      findingsOf('wasteland', new Map([[ratFindId, ratFind]]), BEAST_TRIALS, huntingSkill).reduce(
        (sum, finding) => sum + (finding.get('rat') ?? 0),
        0,
      );

    expect(rats(3, 180), 'expertはnoviceより出くわす').toBeGreaterThan(rats(3, 0));
    // **同じ重みなら同じ卓**なので、引きまでそっくり一致する。expertの上乗せは+4（Skills.md 5節）
    // なので、素の3に積んだものは、素で7のつまみと変わらない。
    expect(rats(3, 180), 'expertの素3＋4は、noviceのつまみ7と同じ卓').toBe(rats(7, 0));
  });

  it('宣言していない獣は、腕を上げても湧かない', () => {
    // 上乗せが積まれるのは**その土地が名乗ったつまみ**だけ。草地はサルを名乗っていないので、
    // 候補そのものが卓に無い（docs/engine/ExplorationSystem.md 2.1節）。
    const monkeys = findingsOf('grassland', new Map(), BEAST_TRIALS, 180).reduce(
      (sum, finding) => sum + (finding.get('monkey') ?? 0),
      0,
    );

    expect(monkeys, '草地にサルは居ない').toBe(0);
  });

  it.each(DISCOVERY_GRANTS)(
    '$land の探索は、$types が見つかった回だけ $skill を+1する',
    ({ land, skill, types, silenceBeasts, trials }) => {
      // 発見の契機（docs/engine/SkillSystem.md 3.3節）。**候補に埋めた`add`が、探索した人へ届いて
      // いるかを見る**——skillsYaml.test.tsはYAMLに書いてあることしか見ないので、効果が`agent`へ
      // 解決されていなくても、あちらは緑のまま。
      //
      // 獣を止めるのは、サルが見つけた物をくわえて立ち去るため（HuntingSystem.md 5.4・5.6節）
      // ——見つけた回と、こちらが数えた回がずれる。狩猟だけは獣が相手なので止められない。
      const results = trialsOf(land, silenceBeasts ? withoutBeasts(land) : new Map(), trials, 0, skill);
      const granted = results.filter((trial) => trial.skillGain > 0);

      expect(granted.length, `${land}: ${skill} の契機が1回も引かれない`).toBeGreaterThan(0);
      expect(
        results.filter((trial) => types.some((type) => trial.finding.has(type)) !== trial.skillGain > 0)
          .length,
        `${land}: 見つかった物と ${skill} の伸びが食い違う回`,
      ).toBe(0);
      // 契機は候補1つにつき1回。複数の候補が同時に当たることは無いので、1回の探索で2つ分は伸びない。
      expect(new Set(granted.map((trial) => trial.skillGain)), `${skill} が1回で伸びる量`).toEqual(
        new Set([1]),
      );
    },
  );

  it.each(BEAST_FINDS)('%s の %s は、獣1匹だけを湧かせる', (landName, findProp, beastName) => {
    // つまみを他の候補より圧倒的に重くすれば、抽選のほとんどがこの候補になる。獣は単独の候補なので
    // （ExplorationSystem.md 2.1節）、獣が出た回は必ず「その1匹だけ」でなければならない。
    const props = new Map([[codex.propertyNames.getId(findProp), 10000]]);
    const encounters = findingsOf(landName, props, BEAST_TRIALS).filter((finding) => finding.has(beastName));

    expect(encounters.length, `${beastName}: ほぼ毎回この候補が引かれる`).toBeGreaterThan(BEAST_TRIALS * 0.9);
    for (const finding of encounters) {
      expect(finding.get(beastName), '出くわすのは1匹').toBe(1);
      expect(total(finding), '獣以外は同時に見つからない').toBe(1);
    }
  });
});

/** object_def名ごとの個数。 */
function countByName(objects: readonly WorldObject[]): Finding {
  const counts = new Map<string, number>();
  for (const object of objects) counts.set(object.def.name, (counts.get(object.def.name) ?? 0) + 1);
  return counts;
}

/** 発見物の合計個数。 */
function total(finding: Finding): number {
  return [...finding.values()].reduce((sum, count) => sum + count, 0);
}
