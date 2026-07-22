using System;
using System.Collections.Generic;
using System.Linq;

namespace UnmappedIsland.Domain.Generation
{
    /// <summary>
    /// Delaunay三角形分割（Bowyer-Watsonの逐次挿入法）。辺が交差しないという数学的性質を利用して、
    /// 交差なしのパスネットワークの土台を作る（TerrainGeneration.md 3.5節）。サイト数は高々20のため、
    /// 素朴なO(n²)実装で十分。出力は重複のない無向辺（A &lt; B に正規化、(A, B)の辞書順）のリスト。
    /// </summary>
    public static class DelaunayTriangulator
    {
        public static List<(int A, int B)> Triangulate(IReadOnlyList<Site> sites)
        {
            if (sites.Count < 2) return new List<(int, int)>();
            if (sites.Count == 2) return new List<(int, int)> { (0, 1) };

            // すべてのサイト（半径IslandRadius以内）を確実に内包するスーパートライアングル。
            // 頂点はsites.Count以降のindexで表す。
            double m = SitePlacer.IslandRadius * 20;
            var points = sites.Select(s => (s.X, s.Y)).ToList();
            int superA = points.Count; points.Add((0, 3 * m));
            int superB = points.Count; points.Add((-3 * m, -3 * m));
            int superC = points.Count; points.Add((3 * m, -3 * m));

            var triangles = new List<(int, int, int)> { (superA, superB, superC) };

            for (int p = 0; p < sites.Count; p++)
            {
                // 外接円にpを含む三角形（bad triangles）を除去し、その穴の境界辺でpと再三角形化する。
                var bad = triangles.Where(t => InCircumcircle(points, t, p)).ToList();

                var boundary = new Dictionary<(int, int), int>();
                foreach (var (a, b, c) in bad)
                {
                    CountEdge(boundary, a, b);
                    CountEdge(boundary, b, c);
                    CountEdge(boundary, c, a);
                }

                triangles.RemoveAll(bad.Contains);
                foreach (var (edge, count) in boundary.Select(kv => (kv.Key, kv.Value)))
                {
                    if (count != 1) continue;   // 2つのbad triangleで共有された辺は穴の内部
                    triangles.Add((edge.Item1, edge.Item2, p));
                }
            }

            // スーパートライアングルの頂点を含む三角形を落とし、残りから無向辺を集める。
            var edges = new SortedSet<(int, int)>();
            foreach (var (a, b, c) in triangles)
            {
                if (a >= sites.Count || b >= sites.Count || c >= sites.Count) continue;
                edges.Add(Normalize(a, b));
                edges.Add(Normalize(b, c));
                edges.Add(Normalize(c, a));
            }

            return edges.ToList();
        }

        private static (int, int) Normalize(int a, int b) => a < b ? (a, b) : (b, a);

        private static void CountEdge(Dictionary<(int, int), int> boundary, int a, int b)
        {
            (int, int) key = Normalize(a, b);
            boundary[key] = boundary.TryGetValue(key, out int count) ? count + 1 : 1;
        }

        /// <summary>点pが三角形(a,b,c)の外接円の内部にあるか（行列式による判定）。</summary>
        private static bool InCircumcircle(IReadOnlyList<(double X, double Y)> points, (int A, int B, int C) triangle, int p)
        {
            var (a, b, c) = triangle;
            // 反時計回りに揃える（行列式判定は向きに依存するため）。
            double orientation = Cross(points[a], points[b], points[c]);
            if (orientation < 0) (b, c) = (c, b);

            double ax = points[a].X - points[p].X, ay = points[a].Y - points[p].Y;
            double bx = points[b].X - points[p].X, by = points[b].Y - points[p].Y;
            double cx = points[c].X - points[p].X, cy = points[c].Y - points[p].Y;

            double det =
                (ax * ax + ay * ay) * (bx * cy - cx * by) -
                (bx * bx + by * by) * (ax * cy - cx * ay) +
                (cx * cx + cy * cy) * (ax * by - bx * ay);

            return det > 0;
        }

        private static double Cross((double X, double Y) o, (double X, double Y) p, (double X, double Y) q) =>
            (p.X - o.X) * (q.Y - o.Y) - (p.Y - o.Y) * (q.X - o.X);
    }
}
