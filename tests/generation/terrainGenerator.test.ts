import { beforeAll, describe, expect, it } from 'vitest';
import { activityHoursOf } from '../../src/analysis/activityHours';
import { buildBalanceTables } from '../../src/analysis/balanceTables';
import {
  dailyBudgetOf,
  dailyPhasesOf,
  locationTypeDaysOf,
  OUTDOOR_WINDOW_MINUTES,
} from '../../src/analysis/dailyPhases';
import { SEASON_CLIMATE } from '../../src/analysis/seasonalRain';
import { generateIsland } from '../../src/domain/generation/TerrainGenerator';
import type { IslandEdge, IslandMap } from '../../src/domain/generation/IslandMap';
import type { GenerationScopeDef } from '../../src/domain/generation/GenerationScopeDef';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';
import { placeSites } from '../../src/domain/generation/SitePlacer';
import { Pcg32 } from '../../src/domain/Pcg32';

/** 不変条件の検証に使うシード群。特別な意味は無く、多様なレイアウトを試すための個数。 */
const SEEDS = Array.from({ length: 25 }, (_, i) => i);

const COAST_TYPES = ['sandy_beach', 'rocky_coast', 'cliff_coast'];

type Point = { x: number; y: number };

describe('地形生成パイプライン(TerrainGenerator)', () => {
  let codex: WorldCodex;
  /** SEEDSの島。不変条件の検証はどれも同じ島の集合を見るので、生成は一度だけにする。 */
  let islands: ReadonlyMap<number, IslandMap>;

  beforeAll(() => {
    codex = bundledCodex();
    islands = new Map(SEEDS.map((seed) => [seed, generate(seed)]));
  });

  function generate(seed: number): IslandMap {
    return generateIsland(codex.generation, 'island', seed);
  }

  function scope(): GenerationScopeDef {
    return codex.generation!.scopes.get('island')!;
  }

  it('生成結果は、実体化された土地との対応を持たない', () => {
    // `IslandMap` の doc が名乗る「WorldObjectを1つも持たない」の、数の側を見る
    // （輸入の側は tests/architecture/layers.test.ts）。**対応表は数の配列でも書けるので、
    // 輸入の検査だけでは issue #1957 の形（siteInstanceIds: number[]）が戻ってきても落ちない。**
    //
    // 欄が増えたらここが落ちる。増やす欄が「種と定義だけから決まるもの」かを、そのとき確かめる
    // ——実体化された土地を指す欄は SpawnedIsland が持つ。
    expect(Object.keys(islands.get(0)!).sort()).toEqual(['edges', 'scopeName', 'seed', 'sites']);
  });

  it('同じシードなら同じ島を生成する（決定性）', () => {
    for (const seed of [0, 7, 12345]) {
      const first = fingerprint(generate(seed));
      const second = fingerprint(generate(seed));
      expect(second, `シード${seed}: 同じシードなら同じ島（決定性）`).toBe(first);
    }
  });

  it('異なるシードは異なる島を生成する', () => {
    expect(fingerprint(generate(1)), '異なるシードは（実際上）異なる島を生む').not.toBe(
      fingerprint(generate(2)),
    );
  });

  it('土地数は10〜20の範囲に収まり、両端まで出る', () => {
    for (const [seed, map] of islands) {
      const count = map.sites.length;
      expect(count, `シード${seed}`).toBeGreaterThanOrEqual(10);
      expect(count, `シード${seed}`).toBeLessThanOrEqual(20);
    }

    // site_countのmaxは含む値。抽選は半開区間（Pcg32.nextInt）なので+1して引いており、
    // それを落とすと上端の島が一度も出なくなる——配置だけを100シード引いて両端を確かめる。
    const counts = new Set(
      Array.from({ length: 100 }, (_, seed) => placeSites(scope(), Pcg32.forPurpose(seed, 'sites')).length),
    );
    expect(counts, '下端の島が出る').toContain(10);
    expect(counts, '上端の島が出る').toContain(20);
  });

  it('島には必ず山(mountain_peak)が1つ以上ある', () => {
    for (const [seed, map] of islands) {
      const mountainCount = map.sites.filter((s) => s.type!.name === 'mountain_peak').length;
      expect(mountainCount, `シード${seed}: 島には必ず山がある（guarantees）`).toBeGreaterThanOrEqual(1);
    }
  });

  it('島は海岸に囲まれ、海岸過多にはならない', () => {
    for (const [seed, map] of islands) {
      for (const site of map.sites) {
        if (site.onCoastRing)
          expect(
            COAST_TYPES,
            `シード${seed}: 外周リングのサイト${site.index}は海岸型（島は海岸に囲まれる）`,
          ).toContain(site.type!.name);
        else
          expect(COAST_TYPES, `シード${seed}: 内陸のサイト${site.index}は海岸型にならない`).not.toContain(
            site.type!.name,
          );
      }

      const coastCount = map.sites.filter((s) => COAST_TYPES.includes(s.type!.name)).length;
      expect(coastCount, `シード${seed}: 島を囲む最低限の海岸がある`).toBeGreaterThanOrEqual(4);
      expect(coastCount, `シード${seed}: 海岸は全体の半数を超えない（海岸過多の防止）`).toBeLessThanOrEqual(
        Math.trunc(map.sites.length / 2),
      );
    }
  });

  it('湿度軸が内陸の多様性（草原・密林など）を生み出す', () => {
    // 乾燥度(湿り気)軸が実際に配置を分けていることの粗い検証: 複数シードを合算すれば、
    // 草原・密林・(荒野または森林)のような湿度帯の異なる内陸型がそれぞれ出現する。
    const seen = new Set<string>();
    for (const map of islands.values()) for (const site of map.sites) seen.add(site.type!.name);

    expect(seen).toContain('grassland');
    expect(seen).toContain('jungle');
    expect(seen.has('wasteland') || seen.has('forest')).toBe(true);
  });

  it('すべての土地が道で連結する（MST保証）', () => {
    for (const [seed, map] of islands) {
      const adjacency: number[][] = Array.from({ length: map.sites.length }, () => []);
      for (const edge of map.edges) {
        adjacency[edge.a].push(edge.b);
        adjacency[edge.b].push(edge.a);
      }

      const visited = new Array<boolean>(map.sites.length).fill(false);
      const queue: number[] = [0];
      visited[0] = true;
      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const next of adjacency[current])
          if (!visited[next]) {
            visited[next] = true;
            queue.push(next);
          }
      }

      expect(
        visited.every((v) => v),
        `シード${seed}: すべての土地へ道で到達できる（MST保証）`,
      ).toBe(true);
    }
  });

  it('道同士は交差しない（Delaunay部分集合）', () => {
    for (const [seed, map] of islands) {
      for (let i = 0; i < map.edges.length; i++)
        for (let j = i + 1; j < map.edges.length; j++)
          expect(
            edgesProperlyIntersect(map, map.edges[i], map.edges[j]),
            `シード${seed}: 道${i}と道${j}は交差しない（Delaunay部分集合）`,
          ).toBe(false);
    }
  });

  it('移動時間は15分刻みの正の値になる', () => {
    for (const [seed, map] of islands)
      for (const edge of map.edges) {
        expect(edge.travelMinutes, `シード${seed}`).toBeGreaterThanOrEqual(15);
        expect(edge.travelMinutes % 15, `シード${seed}: 移動時間は15分刻み`).toBe(0);
      }
  });

  // 宣言した値域が実際に出るかは「どこにサイトが置かれたか」で決まり、ジェネレータの式だけでは
  // 保証できない（3.1節のstretch_sites_to_range）。メートルで宣言した以上、宣言と実測がずれれば
  // 宣言のほうが嘘になるので、両端が出ることを島ごとに見張る。
  it('標高は、宣言した両端（海面0mと最高点）が島ごとに実際に出る', () => {
    const island = scope();
    const metersPerElevationUnit = codex.generation!.metersPerElevationUnit(island);

    for (const [seed, map] of islands) {
      const meters = map.sites.map(
        (site) => site.axisValues.get(island.elevationAxis)! * metersPerElevationUnit,
      );
      expect(Math.min(...meters), `シード${seed}: 島の最低点は海面`).toBe(0);
      expect(Math.max(...meters), `シード${seed}: 島の最高点`).toBe(island.elevationTopMeters);
    }
  });

  // 「海に接する土地が海面近くにある」も、両端が出ることとは別に崩れうる（両端だけなら、いちばん低い
  // 1つが0mでも残りの海岸が高いままでありうる）。線は分布の調整値ではなく「海岸と呼べる高さか」で、
  // 実測（500シード）の上限68mに対して余裕を持たせてある。
  it('海岸帯の土地は海面近くに出る', () => {
    const island = scope();
    const metersPerElevationUnit = codex.generation!.metersPerElevationUnit(island);

    for (const [seed, map] of islands)
      for (const site of map.sites)
        if (COAST_TYPES.includes(site.type!.name))
          expect(
            site.axisValues.get(island.elevationAxis)! * metersPerElevationUnit,
            `シード${seed}: ${site.type!.name}の海抜`,
          ).toBeLessThan(100);
  });

  // 砂浜と岸壁を分ける高さ（TerrainGeneration.md 3.5.3節）が効いていることの見張り。**同じ高さに
  // 出ないことを見る**ので、どちらかのhard_limitsを外しても、線を重ねても赤くなる。型ごとの海抜の
  // 分布はstats/terrain.yamlのsite_elevation_by_location。
  it('砂浜と岸壁は、同じ高さには出ない', () => {
    const island = scope();
    const metersPerElevationUnit = codex.generation!.metersPerElevationUnit(island);
    const metersOf = (name: string): number[] =>
      [...islands.values()].flatMap((map) =>
        map.sites
          .filter((site) => site.type!.name === name)
          .map((site) => site.axisValues.get(island.elevationAxis)! * metersPerElevationUnit),
      );

    const beaches = metersOf('sandy_beach');
    const cliffs = metersOf('cliff_coast');
    expect(beaches.length, '砂浜が出る島で確かめる').toBeGreaterThan(0);
    expect(cliffs.length, '岸壁が出る島で確かめる').toBeGreaterThan(0);
    expect(Math.max(...beaches), '最も高い砂浜は、最も低い岸壁より低い').toBeLessThan(Math.min(...cliffs));
  });

  // 「今の島は端から端まで日帰りで届く」（ContentSkeleton.md 8.3.1節【確定】、GameEndings.md 9.2節）
  // ことの見張り。**回り道の量（extra_edge_detour_factor）を上げると最短経路が伸びて破れる**ので、
  // 生成パラメータを動かしたときにここが赤くなる。実測の分布はstats/terrain.yamlの
  // base_farthest_round_trip。
  it('どの島でも、拠点から最も遠い土地まで日帰りで往復できる', () => {
    const budget = dailyBudgetOf(buildBalanceTables(codex, SAMPLE_CHARACTER));
    const locationDays = locationTypeDaysOf(
      codex,
      activityHoursOf(
        codex,
        SEASON_CLIMATE.map((season) => ({
          seasonName: season.name,
          durationDays: season.durationDays,
          hoursByWeather: new Map(Object.entries(season.hoursByWeather)),
        })),
      ),
    );
    // 往復に使えるのは、屋外の枠から1日を賄う生存の採取を引いた残り（TerrainStats.md「局面ごとの1日」）。
    const reachMinutes = OUTDOOR_WINDOW_MINUTES - budget.survivalGatheringMinutes;

    // **届かない島は稀にしか出ない**（回り道を3倍へ広げても数百島に1つ）ので、不変条件の検証に使う
    // SEEDSでは取りこぼす。見張りとして働く数まで回す。
    for (const seed of Array.from({ length: 500 }, (_, i) => i)) {
      const base = dailyPhasesOf(generate(seed), locationDays, budget).bestBase;
      expect(2 * base.farthestOneWayMinutes, `シード${seed}: 最も遠い土地への往復`).toBeLessThanOrEqual(
        reachMinutes,
      );
    }
  });

  // 移動時間が「距離 ÷ 速さ」で出ていること自体を見張る（TerrainGeneration.md 3.5節）。分布は
  // TerrainStats.mdの鮮度が見ているが、そちらは再生成すれば緑に戻るので、**導出の向きが逆に
  // 戻された**ことは捕まえられない。宣言だけから組み直した値と突き合わせる。
  it('移動時間は、宣言した縮尺と速さだけから組み直せる', () => {
    const island = scope();
    const metersPerElevationUnit = codex.generation!.metersPerElevationUnit(island);
    const elevationOf = (site: { axisValues: ReadonlyMap<string, number> }): number =>
      site.axisValues.get(island.elevationAxis)!;

    for (const [seed, map] of islands)
      for (const edge of map.edges) {
        const a = map.sites[edge.a];
        const b = map.sites[edge.b];
        const moveCostAverage = (a.type!.moveCost + b.type!.moveCost) / 2;
        const walkMinutes = ((edge.distanceMeters * moveCostAverage) / island.walkMetersPerHour) * 60;
        const climbMinutes =
          ((Math.abs(elevationOf(a) - elevationOf(b)) * metersPerElevationUnit) / island.climbMetersPerHour) *
          60;

        expect(edge.travelMinutes, `シード${seed}: 道${edge.a}-${edge.b}`).toBe(
          Math.max(1, Math.round((walkMinutes + climbMinutes) / 15)) * 15,
        );
      }
  });

  // 「水平移動だけで説明できる時間」との差を見る。距離とmove_costの効果はその基準値に入っているので、
  // 残る差は高低差の項しか作れない（両群の比を見るだけでは、山ほどmove_costが高いという相関を
  // 高低差の効果と取り違える）。
  it('高低差は移動時間に効く', () => {
    const island = scope();
    const flat: number[] = [];
    const steep: number[] = [];
    for (const map of islands.values())
      for (const edge of map.edges) {
        const a = map.sites[edge.a];
        const b = map.sites[edge.b];
        const moveCostAverage = (a.type!.moveCost + b.type!.moveCost) / 2;
        const walkOnlyMinutes = ((edge.distanceMeters * moveCostAverage) / island.walkMetersPerHour) * 60;
        const gap = Math.abs(
          a.axisValues.get(island.elevationAxis)! - b.axisValues.get(island.elevationAxis)!,
        );
        (gap <= 5 ? flat : steep).push(edge.travelMinutes - walkOnlyMinutes);
      }

    const mean = (values: readonly number[]): number => values.reduce((s, v) => s + v, 0) / values.length;
    expect(flat.length, '高低差のほとんど無い道が標本にある').toBeGreaterThan(20);
    expect(steep.length, '高低差のある道が標本にある').toBeGreaterThan(20);
    expect(Math.abs(mean(flat)), '高低差の無い道は、水平移動だけの時間で説明が付く').toBeLessThan(5);
    expect(mean(steep), '高低差のある道には、その分の時間が乗る').toBeGreaterThan(5);
  });

  // 上限は置けるかどうかの条件ではなく、hard_limitsを満たす型が全部上限に達したサイトは上限を
  // 無視して選び直す（TerrainGeneration.md 3.4節）。**その逃げ道が常用されていないこと**まで見る
  // ——超えるのが普通になれば、上限は何も抑えていない。海岸に高さの線を引いた（3.5.3節）ぶん、
  // 海岸帯のサイトが選べる型は2つに減っているので、逃げ道は実際に使われる。
  it('同じ地形が並びすぎず、上限を外れるのは例外に留まる', () => {
    const max = scope().maxSitesPerType;
    expect(max, '上限を設けたスコープで確かめる').toBeGreaterThan(0);

    // 例外の頻度を見るので、不変条件の検証に使うSEEDSより多く回す（生成は1島1ミリ秒に満たない）。
    const seeds = Array.from({ length: 500 }, (_, i) => i);
    let overCapIslands = 0;
    for (const seed of seeds) {
      const counts = new Map<string, number>();
      for (const site of generate(seed).sites)
        counts.set(site.type!.name, (counts.get(site.type!.name) ?? 0) + 1);

      for (const [name, count] of counts)
        expect(count, `シード${seed}: ${name}は、外れても上限+1まで`).toBeLessThanOrEqual(max + 1);
      if ([...counts.values()].some((count) => count > max)) overCapIslands++;
    }

    expect(overCapIslands / seeds.length, '上限を外れる島は例外に留まる').toBeLessThan(0.1);
  });

  it('上限は島の地形の種類を増やす', () => {
    // 上限が無いと、軸空間の中央付近に理想点を持つ型が大半のサイトを取り、端に寄った型が
    // ほとんど出ない（TerrainGeneration.md 3.4節）。実測値はTerrainStats.md。
    const seen = new Map<string, number>();
    for (const map of islands.values()) {
      const types = new Set(map.sites.map((s) => s.type!.name));
      for (const name of types) seen.set(name, (seen.get(name) ?? 0) + 1);
    }

    expect(seen.size, 'どの地形も、25島のうちのどこかには出る').toBe(codex.generation!.locationTypes.length);
  });

  it('土地の名前は割り当てられ、重複しない', () => {
    for (const [seed, map] of islands) {
      const names = map.sites.map((s) => s.name);
      expect(
        names.every((n) => n !== undefined),
        `シード${seed}`,
      ).toBe(true);
      expect(new Set(names.map((n) => n!.key)).size, `シード${seed}: 土地の名前は重複しない`).toBe(
        map.sites.length,
      );
    }
  });

  it('土地の名前は、その型が1つだけなら型そのもの、複数なら亜種から配られる', () => {
    for (const [seed, map] of islands) {
      const counts = new Map<string, number>();
      for (const site of map.sites) counts.set(site.type!.name, (counts.get(site.type!.name) ?? 0) + 1);

      for (const site of map.sites) {
        const type = site.type!;
        const name = site.name!;
        expect(name.typeName, `シード${seed}`).toBe(type.name);
        expect(name.variantId, `シード${seed}: ${type.name}は名前と亜種が一致する`).toBe(site.variant?.id);

        if (counts.get(type.name) === 1) {
          expect(name.variantId, `シード${seed}: 1つだけの型に亜種は付かない`).toBeUndefined();
          expect(name.ordinal).toBeUndefined();
        } else if (name.variantId !== undefined) {
          expect(
            type.variants.map((v) => v.id),
            `シード${seed}`,
          ).toContain(name.variantId);
        } else {
          expect(name.ordinal, `シード${seed}: 亜種が尽きた分は通し番号で埋まる`).toBeGreaterThan(0);
        }
      }
    }
  });
});

/** 生成結果の完全な指紋（決定性の比較用）。 */
function fingerprint(map: IslandMap): string {
  const lines: string[] = [];
  for (const site of map.sites) {
    const axisKeys = [...site.axisValues.keys()].sort();
    const axes = axisKeys.map((key) => `${key}=${site.axisValues.get(key)}`).join(',');
    lines.push(
      `site ${site.index}: (${site.x.toFixed(6)},${site.y.toFixed(6)}) ring=${site.onCoastRing} ${site.type!.name} '${site.name}' [${axes}]`,
    );
  }
  for (const edge of [...map.edges].sort((a, b) => a.a - b.a || a.b - b.b))
    lines.push(`edge ${edge.a}-${edge.b}: ${edge.distanceMeters.toFixed(6)}m ${edge.travelMinutes}min`);
  return lines.join('\n');
}

/** 2つの辺が「真に」交差するか（端点の共有は交差とみなさない）。 */
function edgesProperlyIntersect(map: IslandMap, e1: IslandEdge, e2: IslandEdge): boolean {
  if (e1.a === e2.a || e1.a === e2.b || e1.b === e2.a || e1.b === e2.b) return false;

  const p1 = point(map, e1.a);
  const p2 = point(map, e1.b);
  const q1 = point(map, e2.a);
  const q2 = point(map, e2.b);

  const d1 = cross(q1, q2, p1);
  const d2 = cross(q1, q2, p2);
  const d3 = cross(p1, p2, q1);
  const d4 = cross(p1, p2, q2);

  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function point(map: IslandMap, index: number): Point {
  return { x: map.sites[index].x, y: map.sites[index].y };
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}
