import type { GenerationScopeDef } from './GenerationScopeDef';
import { IslandEdge } from './IslandMap';
import type { Site } from './IslandMap';

type WeightedEdge = { readonly a: number; readonly b: number; readonly distance: number };

/** 移動時間の下限（分）。どんなに近い土地の間でも最低これだけはかかる。 */
const MIN_TRAVEL_MINUTES = 15;

/**
 * パスネットワークの確定（TerrainGeneration.md 3.5節）。Delaunay辺を土台に、
 *
 * 1. 最小全域木（MST、Kruskal法）を必ず残す — 全土地への到達性の保証
 * 2. MST以外のDelaunay辺を距離の短い順に走査し、「現在のグラフでの2点間最短距離が
 *    直結距離のextraEdgeDetourFactor%を超える」（＝大回りを強いられている）辺だけを
 *    近道・分岐として復活させる
 *
 * の2段で間引く。復活辺もDelaunay辺の部分集合であるため、グラフは常に交差なし（平面）のまま。
 *
 * 各辺のtravelMinutes（移動時間）は
 *     距離 × baseMinutesPerDistance × 両端のmoveCostの平均
 * で確定する。距離と移動難易度は保持せず、移動時間に代表させる。
 */
export function build(
  sites: readonly Site[],
  delaunayEdges: readonly (readonly [number, number])[],
  scope: GenerationScopeDef,
): IslandEdge[] {
  const ordered: WeightedEdge[] = delaunayEdges
    .map(([a, b]) => ({ a, b, distance: sites[a].distanceTo(sites[b]) }))
    .sort((x, y) => x.distance - y.distance || x.a - y.a || x.b - y.b);

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
  const detourFactor = scope.extraEdgeDetourFactor;
  for (const edge of rest) {
    const viaGraph = shortestPathDistance(sites.length, chosen, edge.a, edge.b);
    if (viaGraph > edge.distance * detourFactor) chosen.push(edge);
  }

  return chosen.map(
    (e) => new IslandEdge(e.a, e.b, e.distance, travelMinutes(sites, e.a, e.b, e.distance, scope)),
  );
}

function travelMinutes(
  sites: readonly Site[],
  a: number,
  b: number,
  distance: number,
  scope: GenerationScopeDef,
): number {
  const moveCostAverage = (sites[a].type!.moveCost + sites[b].type!.moveCost) / 2;
  let minutes = Math.round(distance * scope.baseMinutesPerDistance * moveCostAverage);
  // tick（minutes_per_tick）単位の粗い時間経過と噛み合うよう、15分刻みへ丸める。
  minutes = Math.max(MIN_TRAVEL_MINUTES, Math.round(minutes / 15) * 15);
  return minutes;
}

/** 現在の辺集合でのa→bの最短距離（Dijkstra。ノード数が高々20のため素朴な実装で十分）。
 * 到達不能ならinfinity（MSTが全域を繋ぐため実際には起こらない）。 */
function shortestPathDistance(
  nodeCount: number,
  edges: readonly WeightedEdge[],
  from: number,
  to: number,
): number {
  const adjacency: { to: number; distance: number }[][] = Array.from({ length: nodeCount }, () => []);
  for (const { a, b, distance } of edges) {
    adjacency[a].push({ to: b, distance });
    adjacency[b].push({ to: a, distance });
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
