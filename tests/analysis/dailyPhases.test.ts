import { describe, expect, it } from 'vitest';
import type { LocationTypeDay } from '../../src/analysis/dailyPhases';
import { dailyPhasesOf } from '../../src/analysis/dailyPhases';
import { IslandEdge, IslandMap, Site } from '../../src/domain/generation/IslandMap';
import { LocationTypeDef } from '../../src/domain/generation/LocationTypeDef';

/**
 * 局面ごとの1日（`src/analysis/dailyPhases.ts`）が、**移動時間がどれだけ伸びても計測を続ける**こと
 * （issue #838）。
 *
 * 山の配分の組へ日帰りできない拠点は実在する（`main`でも最悪の片道は225分で、枠が尽きる228分まで
 * 3分しかない）。それを島が壊れていることとして扱うと、**移動時間を動かす変更なら何であれ**
 * `npm run stats:terrain` が例外で止まる。
 */

/** 土地の型3つ。山の配分（`WORK_SHARES`）の3つの組へ1つずつ入る。 */
const LOCATION_TYPES = ['grassland', 'forest', 'jungle'] as const;

/** 型ごとの実測。**明るさで頭打ちにならない値**を置いて、効くのを移動時間だけにする。 */
const LOCATION_DAYS: ReadonlyMap<number, LocationTypeDay> = new Map(
  LOCATION_TYPES.map((locationDefName, index) => [
    index + 1,
    { locationDefName, explorationMinutes: 600, activeMinutesPerDay: 600 },
  ]),
);

/**
 * 土地3つの島。拠点にする`grassland`から`forest`へ60分、`jungle`へ`jungleOneWayMinutes`の道が
 * 1本ずつ伸びる。
 */
function islandWithJungleAt(jungleOneWayMinutes: number): IslandMap {
  const sites = LOCATION_TYPES.map((name, index) => {
    const site = new Site(index, index, 0, false);
    site.type = new LocationTypeDef(name, index + 1, [], [], 1, true, 0, [], []);
    return site;
  });

  return new IslandMap('island', 0, sites, [
    new IslandEdge(0, 1, 1000, 60),
    new IslandEdge(0, 2, 1000, jungleOneWayMinutes),
  ]);
}

describe('定常の局面と、日帰りできない組', () => {
  it('どの組へも日帰りできる島では、組の数だけ行き先が決まる', () => {
    const phases = dailyPhasesOf(islandWithJungleAt(60), LOCATION_DAYS);

    expect(phases.bestBase.steady?.shares.map((share) => share.label)).toEqual(['開けた土地', '森', '密林']);
  });

  it('往復で屋外の枠が尽きる組がある拠点は、例外ではなく定常の局面を持たない', () => {
    const phases = dailyPhasesOf(islandWithJungleAt(600), LOCATION_DAYS);

    expect(phases.bases.map((base) => base.steady)).toEqual([undefined, undefined, undefined]);
    expect(phases.bestBase.oneWayMinutes, '島の広さは測れている').toBeGreaterThan(0);
  });
});
