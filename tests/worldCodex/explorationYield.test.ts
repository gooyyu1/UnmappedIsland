import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { Location } from '../../src/domain/runtime/views/Location';
import { World } from '../../src/domain/runtime/views/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { SeededRng } from '../support/SeededRng';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 探索1回で見つかる物の数（locations.yamlのexploreのpickテーブル）を、実際に探索を繰り返して検証する。
 *
 * 重みの合計と候補ごとの個数から期待値は手計算できるが、YAMLを読み直すテストは重みの解釈をローダーと
 * 二重に持つことになるため、実行して数える。試行回数は、期待値の推定誤差が許容幅より十分小さくなる数
 * （1回あたりの標準偏差は高々1個程度なので、1000回なら標準誤差は0.03個ほど）。
 */

const TRIALS = 1000;

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

describe('探索で見つかる物の数', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
  });

  /**
   * その土地を1つ作り、TRIALS回探索して「1回あたりに増えた物の数」の列を返す。
   *
   * 進捗は探索のたびに増えるが、rangeの上限に張り付いた後も発見物の抽選は続く（ExplorationSystem.md
   * 2節）ため、試行回数が進捗の上限を超えても数え方は変わらない。
   */
  function yieldsOf(landName: string): number[] {
    const session = new WorldSession(codex);
    const worldInstance = new WorldObject(1, codex.objects.get(codex.objectNames.getId('world')), session);
    const worldView = new World(worldInstance, codex.propertyNames);
    const explorer = new WorldSession(codex, worldView, new SeededRng(20250801));

    const instance = explorer.spawn(codex.objectNames.getId(landName));
    expect(
      instance.moveToSlot(worldInstance, codex.slotNames.getId('locations'), codex.wellKnown),
    ).toBeUndefined();
    const location = new Location(instance, codex);

    const counts: number[] = [];
    let previous = 0;
    for (let i = 0; i < TRIALS; i++) {
      expect(location.explore(undefined, explorer), `${landName}: 探索は必ず成立する`).toBe(true);
      const found = location.items.length + location.fixtures.length;
      counts.push(found - previous);
      previous = found;
    }
    return counts;
  }

  it.each([...EXPECTED_MEAN.keys()])('%s の探索はハズレが無く、1〜3個が見つかる', (landName) => {
    const counts = yieldsOf(landName);
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
});
