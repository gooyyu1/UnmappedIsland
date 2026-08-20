import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { Location } from '../../src/domain/views/Location';
import { World } from '../../src/domain/views/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { SeededRng } from '../support/SeededRng';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

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
  ['cliff_coast', 'rat_find', 'rat'],
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

describe('探索で見つかる物', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
  });

  /**
   * その土地を1つ作り（propsを渡せばつまみを上書きして）、trials回探索して、1回ごとの発見物を返す。
   *
   * 進捗は探索のたびに増えるが、rangeの上限に張り付いた後も発見物の抽選は続く（ExplorationSystem.md
   * 2節）ため、試行回数が進捗の上限を超えても数え方は変わらない。
   */
  function findingsOf(
    landName: string,
    props: ReadonlyMap<number, number> = new Map(),
    trials: number = TRIALS,
  ): Finding[] {
    const session = new WorldSession(codex);
    const worldInstance = new WorldObject(1, codex.objects.get(codex.objectNames.getId('world')), session);
    const worldView = new World(worldInstance, codex.propertyNames, codex.symbolNames);
    const explorer = new WorldSession(codex, worldView, new SeededRng(20250801));

    const instance = explorer.spawn(codex.objectNames.getId(landName));
    for (const [propertyGlobalId, value] of props) instance.setProperty(propertyGlobalId, value);
    expect(instance.moveToSlot(worldInstance, codex.slotNames.getId('locations'))).toBeUndefined();
    const location = new Location(instance, codex);

    const findings: Finding[] = [];
    let previous: Finding = new Map();
    for (let i = 0; i < trials; i++) {
      expect(location.explore(undefined), `${landName}: 探索は必ず成立する`).toBe(true);
      const now = countByName([...location.items, ...location.fixtures]);
      findings.push(added(now, previous));
      previous = now;
    }
    return findings;
  }

  /**
   * その土地の獣のつまみを0にした上書き。**卓の当たりだけを数えるために獣を止める**——湧いた獣は
   * その後も動き、くわえた物を落として立ち去る（HuntingSystem.md 5.4・5.6節）ので、そのぶんの
   * 増減が「1回の探索で見つかった数」に混ざる。獣の候補そのものは下のテストが受け持つ。
   */
  function withoutBeasts(landName: string): ReadonlyMap<number, number> {
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

/** nowのうち、beforeから増えた分だけ。 */
function added(now: Finding, before: Finding): Finding {
  const difference = new Map<string, number>();
  for (const [name, count] of now) {
    const grew = count - (before.get(name) ?? 0);
    if (grew > 0) difference.set(name, grew);
  }
  return difference;
}

/** 発見物の合計個数。 */
function total(finding: Finding): number {
  return [...finding.values()].reduce((sum, count) => sum + count, 0);
}
