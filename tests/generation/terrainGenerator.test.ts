import { beforeAll, describe, expect, it } from 'vitest';
import { generate as generateTerrain } from '../../src/domain/generation/TerrainGenerator';
import type { IslandEdge, IslandMap } from '../../src/domain/generation/IslandMap';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/** 不変条件の検証に使うシード群。特別な意味は無く、多様なレイアウトを試すための個数。 */
const SEEDS = Array.from({ length: 25 }, (_, i) => i);

const COAST_TYPES = ['sandy_beach', 'rocky_coast', 'cliff_coast'];

type Point = { x: number; y: number };

describe('地形生成パイプライン(TerrainGenerator)', () => {
  let codex: WorldCodex;
  /** SEEDSの島。不変条件の検証はどれも同じ島の集合を見るので、生成は一度だけにする。 */
  let islands: ReadonlyMap<number, IslandMap>;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
    islands = new Map(SEEDS.map((seed) => [seed, generate(seed)]));
  });

  function generate(seed: number): IslandMap {
    return generateTerrain(codex.generation, 'island', seed);
  }

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

  it('土地数は10〜20の範囲に収まる', () => {
    for (const [seed, map] of islands) {
      const count = map.sites.length;
      expect(count, `シード${seed}`).toBeGreaterThanOrEqual(10);
      expect(count, `シード${seed}`).toBeLessThanOrEqual(20);
    }
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

  it('同じ地形が並びすぎない（max_sites_per_type）', () => {
    const max = codex.generation!.scopes.get('island')!.maxSitesPerType;
    expect(max, '上限を設けたスコープで確かめる').toBeGreaterThan(0);

    for (const [seed, map] of islands) {
      const counts = new Map<string, number>();
      for (const site of map.sites) counts.set(site.type!.name, (counts.get(site.type!.name) ?? 0) + 1);

      for (const [name, count] of counts) expect(count, `シード${seed}: ${name}`).toBeLessThanOrEqual(max);
    }
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
    lines.push(`edge ${edge.a}-${edge.b}: ${edge.distance.toFixed(6)} ${edge.travelMinutes}min`);
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
