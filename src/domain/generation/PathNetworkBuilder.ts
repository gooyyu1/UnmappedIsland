import type { AxisDef } from './AxisDef';
import type { GenerationScopeDef } from './GenerationScopeDef';
import { IslandEdge } from './IslandMap';
import type { Site } from './IslandMap';

type WeightedEdge = { readonly a: number; readonly b: number; readonly distanceMeters: number };

/** 移動時間の刻み（分）＝ minutes_per_tick（core.yaml）。tick単位の粗い時間経過と噛み合う粒度に揃え、
 * どんなに近い土地の間でも最低1刻みはかかるものとする。 */
const TRAVEL_MINUTES_STEP = 15;

const MINUTES_PER_HOUR = 60;

/**
 * パスネットワークの確定（TerrainGeneration.md 3.5節）。Delaunay辺を土台に、
 *
 * 1. 最小全域木（MST、Kruskal法）を必ず残す — 全土地への到達性の保証
 * 2. MST以外のDelaunay辺を距離の短い順に走査し、「現在のグラフでの2点間最短距離が
 *    直結距離のextraEdgeDetourThreshold倍を超える」（＝大回りを強いられている）辺だけを
 *    近道・分岐として復活させる
 *
 * の2段で間引く。復活辺もDelaunay辺の部分集合であるため、グラフは常に交差なし（平面）のまま。
 *
 * 各辺のtravelMinutes（移動時間）は、水平距離を歩く時間と高低差を登り下りする時間の和として
 * 確定する（travelMinutes参照）。**距離が先にあり、速さで割ると時間が出る**——縮尺と速さは
 * 別々の宣言なので、どちらも現実の値と突き合わせて検算できる。
 */
export function buildPathNetwork(
  sites: readonly Site[],
  delaunayEdges: readonly (readonly [number, number])[],
  scope: GenerationScopeDef,
  axes: ReadonlyMap<string, AxisDef>,
): IslandEdge[] {
  // 抽象座標をメートルへ直すのはここ1箇所。以降の距離はすべて現実の長さで扱う。
  const metersPerDistanceUnit = scope.metersPerDistanceUnit;
  const ordered: WeightedEdge[] = delaunayEdges
    .map(([a, b]) => ({ a, b, distanceMeters: sites[a].distanceTo(sites[b]) * metersPerDistanceUnit }))
    .sort((x, y) => x.distanceMeters - y.distanceMeters || x.a - y.a || x.b - y.b);

  // 1. Kruskal MST。
  const unionFind = sites.map((_, i) => i);

  function find(x: number): number {
    while (unionFind[x] !== x) {
      const next = unionFind[unionFind[x]];
      unionFind[x] = next;
      x = next;
    }
    return x;
  }

  const chosen: WeightedEdge[] = [];
  const rest: WeightedEdge[] = [];
  for (const edge of ordered) {
    const rootA = find(edge.a);
    const rootB = find(edge.b);
    if (rootA !== rootB) {
      unionFind[rootA] = rootB;
      chosen.push(edge);
    } else {
      rest.push(edge);
    }
  }

  // 2. 迂回率が閾値を超える辺を短い順に復活させる。
  const detourFactor = scope.extraEdgeDetourThreshold;
  for (const edge of rest) {
    const viaGraph = shortestPathDistance(sites.length, chosen, edge.a, edge.b);
    if (viaGraph > edge.distanceMeters * detourFactor) chosen.push(edge);
  }

  // 標高軸の実在はGenerationDefsが組み上がった時点で確かめている。
  const elevationRange = axes.get(scope.elevationAxis)!.range;
  const metersPerElevationUnit = scope.metersPerElevationUnit(elevationRange.max - elevationRange.min);

  return chosen.map(
    (e) =>
      new IslandEdge(
        e.a,
        e.b,
        e.distanceMeters,
        travelMinutes(sites[e.a], sites[e.b], e.distanceMeters, scope, metersPerElevationUnit),
      ),
  );
}

/**
 * 道1本の移動時間（分、TerrainGeneration.md 3.5節）。
 *
 *     水平距離(m) ÷ 歩く速さ × 両端のmove_costの平均 ＋ 高低差(m) ÷ 登り下りの速さ
 *
 * move_costはその土地を進む遅さの倍率（1.0が開けた土地）。高低差の項は**登りと下りで対称**に課す
 * ——道は両端に2つあるので向きは表せるが、行きと帰りで時間が変わると往復の勘定が全部2倍に複雑になる。
 */
function travelMinutes(
  a: Site,
  b: Site,
  distanceMeters: number,
  scope: GenerationScopeDef,
  metersPerElevationUnit: number,
): number {
  const moveCostAverage = (a.type!.moveCost + b.type!.moveCost) / 2;
  const walkMinutes = ((distanceMeters * moveCostAverage) / scope.walkMetersPerHour) * MINUTES_PER_HOUR;

  const climbMeters =
    Math.abs(a.axisValues.get(scope.elevationAxis)! - b.axisValues.get(scope.elevationAxis)!) *
    metersPerElevationUnit;
  const climbMinutes = (climbMeters / scope.climbMetersPerHour) * MINUTES_PER_HOUR;

  const steps = Math.round((walkMinutes + climbMinutes) / TRAVEL_MINUTES_STEP);
  return Math.max(1, steps) * TRAVEL_MINUTES_STEP;
}

/** 現在の辺集合でのa→bの最短距離（m。Dijkstra。ノード数が高々20のため素朴な実装で十分）。
 * 到達不能ならinfinity（MSTが全域を繋ぐため実際には起こらない）。 */
function shortestPathDistance(
  nodeCount: number,
  edges: readonly WeightedEdge[],
  from: number,
  to: number,
): number {
  const adjacency: { to: number; distance: number }[][] = Array.from({ length: nodeCount }, () => []);
  for (const { a, b, distanceMeters } of edges) {
    adjacency[a].push({ to: b, distance: distanceMeters });
    adjacency[b].push({ to: a, distance: distanceMeters });
  }

  const best = new Array<number>(nodeCount).fill(Number.POSITIVE_INFINITY);
  best[from] = 0;
  const visited = new Array<boolean>(nodeCount).fill(false);

  for (;;) {
    let current = -1;
    for (let i = 0; i < nodeCount; i++) {
      if (!visited[i] && Number.isFinite(best[i]) && (current === -1 || best[i] < best[current])) current = i;
    }
    if (current === -1) break;
    if (current === to) break;
    visited[current] = true;

    for (const { to: next, distance } of adjacency[current]) {
      if (best[current] + distance < best[next]) best[next] = best[current] + distance;
    }
  }

  return best[to];
}
