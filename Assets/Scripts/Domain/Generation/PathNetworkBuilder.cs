using System;
using System.Collections.Generic;
using System.Linq;
using UnmappedIsland.Domain.Defs.Generation;

namespace UnmappedIsland.Domain.Generation
{
    /// <summary>
    /// パスネットワークの確定（TerrainGeneration.md 3.5節）。Delaunay辺を土台に、
    ///
    /// 1. 最小全域木（MST、Kruskal法）を必ず残す — 全土地への到達性の保証
    /// 2. MST以外のDelaunay辺を距離の短い順に走査し、「現在のグラフでの2点間最短距離が
    ///    直結距離のextra_edge_detour_factor%を超える」（＝大回りを強いられている）辺だけを
    ///    近道・分岐として復活させる
    ///
    /// の2段で間引く。復活辺もDelaunay辺の部分集合であるため、グラフは常に交差なし（平面）のまま。
    ///
    /// 各辺のtravel_minutes（移動時間）は
    ///     距離 × base_minutes_per_distance × (両端のmove_costの平均 / 100)
    /// で確定する。距離と移動難易度は保持せず、移動時間に代表させる。
    /// </summary>
    public static class PathNetworkBuilder
    {
        /// <summary>移動時間の下限（分）。どんなに近い土地の間でも最低これだけはかかる。</summary>
        private const int MinTravelMinutes = 15;

        public static List<IslandEdge> Build(IReadOnlyList<Site> sites, IReadOnlyList<(int A, int B)> delaunayEdges, GenerationScopeDef scope)
        {
            var ordered = delaunayEdges
                .Select(e => (e.A, e.B, Distance: sites[e.A].DistanceTo(sites[e.B])))
                .OrderBy(e => e.Distance).ThenBy(e => e.A).ThenBy(e => e.B)
                .ToList();

            // 1. Kruskal MST。
            var unionFind = new int[sites.Count];
            for (int i = 0; i < unionFind.Length; i++) unionFind[i] = i;

            int Find(int x)
            {
                while (unionFind[x] != x) x = unionFind[x] = unionFind[unionFind[x]];
                return x;
            }

            var chosen = new List<(int A, int B, double Distance)>();
            var rest = new List<(int A, int B, double Distance)>();
            foreach (var edge in ordered)
            {
                int rootA = Find(edge.A);
                int rootB = Find(edge.B);
                if (rootA != rootB)
                {
                    unionFind[rootA] = rootB;
                    chosen.Add(edge);
                }
                else
                {
                    rest.Add(edge);
                }
            }

            // 2. 迂回率が閾値を超える辺を短い順に復活させる。
            double detourFactor = scope.ExtraEdgeDetourFactor / 100.0;
            foreach (var edge in rest)
            {
                double viaGraph = ShortestPathDistance(sites.Count, chosen, edge.A, edge.B);
                if (viaGraph > edge.Distance * detourFactor)
                    chosen.Add(edge);
            }

            return chosen
                .Select(e => new IslandEdge(e.A, e.B, e.Distance, TravelMinutes(sites, e.A, e.B, e.Distance, scope)))
                .ToList();
        }

        private static int TravelMinutes(IReadOnlyList<Site> sites, int a, int b, double distance, GenerationScopeDef scope)
        {
            double moveCostAverage = (sites[a].Type.MoveCost + sites[b].Type.MoveCost) / 2.0;
            int minutes = (int)Math.Round(distance * scope.BaseMinutesPerDistance * moveCostAverage / 100.0);
            // tick（minutes_per_tick）単位の粗い時間経過と噛み合うよう、15分刻みへ丸める。
            minutes = Math.Max(MinTravelMinutes, (int)Math.Round(minutes / 15.0) * 15);
            return minutes;
        }

        /// <summary>現在の辺集合でのa→bの最短距離（Dijkstra。ノード数が高々20のため素朴な実装で十分）。
        /// 到達不能ならinfinity（MSTが全域を繋ぐため実際には起こらない）。</summary>
        private static double ShortestPathDistance(int nodeCount, List<(int A, int B, double Distance)> edges, int from, int to)
        {
            var adjacency = new List<(int To, double Distance)>[nodeCount];
            for (int i = 0; i < nodeCount; i++) adjacency[i] = new List<(int, double)>();
            foreach (var (a, b, distance) in edges)
            {
                adjacency[a].Add((b, distance));
                adjacency[b].Add((a, distance));
            }

            var best = new double[nodeCount];
            Array.Fill(best, double.PositiveInfinity);
            best[from] = 0;
            var visited = new bool[nodeCount];

            while (true)
            {
                int current = -1;
                foreach (int i in Enumerable.Range(0, nodeCount))
                    if (!visited[i] && !double.IsPositiveInfinity(best[i]) && (current == -1 || best[i] < best[current]))
                        current = i;
                if (current == -1) break;
                if (current == to) break;
                visited[current] = true;

                foreach (var (next, distance) in adjacency[current])
                    if (best[current] + distance < best[next])
                        best[next] = best[current] + distance;
            }

            return best[to];
        }
    }
}
