using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using NUnit.Framework;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Domain.Generation;
using UnmappedIsland.Loader;

namespace UnmappedIsland.Generation
{
    /// <summary>
    /// 地形生成パイプライン（TerrainGenerator）に対する自動テスト。実際のWorldCodex定義
    /// （terrain_generation.yaml + locations.yaml）を使い、複数のシードに対して生成結果の不変条件
    /// （決定性・土地数10〜20・山1つ以上・海岸に囲まれ海岸過多でない・全土地連結・辺の交差なし）を
    /// 検証する。
    /// </summary>
    [TestFixture]
    public class TerrainGeneratorTests
    {
        /// <summary>不変条件の検証に使うシード群。特別な意味は無く、多様なレイアウトを試すための個数。</summary>
        private static readonly int[] Seeds = Enumerable.Range(0, 25).ToArray();

        private static readonly string[] CoastTypes = { "sandy_beach", "rocky_coast", "cliff_coast" };

        private WorldCodex codex;

        [OneTimeSetUp]
        public void LoadWorldCodexDirectory()
        {
            string directory = FindRepoDirectory("Assets/StreamingAssets/WorldCodex");
            codex = new WorldCodexYamlLoader().LoadFromDirectory(directory).Build();
        }

        private static string FindRepoDirectory(string relativePath)
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null)
            {
                string candidate = System.IO.Path.Combine(dir.FullName, relativePath);
                if (Directory.Exists(candidate)) return candidate;
                dir = dir.Parent;
            }
            throw new DirectoryNotFoundException($"'{relativePath}' が祖先ディレクトリの中に見つかりませんでした。");
        }

        private IslandMap Generate(int seed) => TerrainGenerator.Generate(codex.Generation, "island", seed);

        [Test]
        public void Generate_SameSeed_ProducesIdenticalIsland()
        {
            foreach (int seed in new[] { 0, 7, 12345 })
            {
                string first = Fingerprint(Generate(seed));
                string second = Fingerprint(Generate(seed));
                Assert.That(second, Is.EqualTo(first), $"シード{seed}: 同じシードなら同じ島（決定性）");
            }
        }

        [Test]
        public void Generate_DifferentSeeds_ProduceDifferentIslands()
        {
            Assert.That(Fingerprint(Generate(1)), Is.Not.EqualTo(Fingerprint(Generate(2))),
                "異なるシードは（実際上）異なる島を生む");
        }

        [Test]
        public void Generate_SiteCount_IsBetween10And20()
        {
            foreach (int seed in Seeds)
                Assert.That(Generate(seed).Sites.Count, Is.InRange(10, 20), $"シード{seed}");
        }

        [Test]
        public void Generate_AlwaysHasAtLeastOneMountainPeak()
        {
            foreach (int seed in Seeds)
            {
                IslandMap map = Generate(seed);
                Assert.That(map.Sites.Count(s => s.Type.Name == "mountain_peak"), Is.GreaterThanOrEqualTo(1),
                    $"シード{seed}: 島には必ず山がある（guarantees）");
            }
        }

        [Test]
        public void Generate_IslandIsRingedByCoast_WithoutCoastExcess()
        {
            foreach (int seed in Seeds)
            {
                IslandMap map = Generate(seed);

                foreach (Site site in map.Sites)
                {
                    if (site.OnCoastRing)
                        Assert.That(CoastTypes, Does.Contain(site.Type.Name),
                            $"シード{seed}: 外周リングのサイト{site.Index}は海岸型（島は海岸に囲まれる）");
                    else
                        Assert.That(CoastTypes, Does.Not.Contain(site.Type.Name),
                            $"シード{seed}: 内陸のサイト{site.Index}は海岸型にならない");
                }

                int coastCount = map.Sites.Count(s => CoastTypes.Contains(s.Type.Name));
                Assert.That(coastCount, Is.GreaterThanOrEqualTo(4), $"シード{seed}: 島を囲む最低限の海岸がある");
                Assert.That(coastCount, Is.LessThanOrEqualTo(map.Sites.Count / 2),
                    $"シード{seed}: 海岸は全体の半数を超えない（海岸過多の防止）");
            }
        }

        [Test]
        public void Generate_InlandVariety_HumidityAxisDrivesGrasslandAndJungle()
        {
            // 乾燥度(湿り気)軸が実際に配置を分けていることの粗い検証: 複数シードを合算すれば、
            // 草原・密林・(荒野または森林)のような湿度帯の異なる内陸型がそれぞれ出現する。
            var seen = new HashSet<string>();
            foreach (int seed in Seeds)
                foreach (Site site in Generate(seed).Sites)
                    seen.Add(site.Type.Name);

            Assert.That(seen, Does.Contain("grassland"));
            Assert.That(seen, Does.Contain("jungle"));
            Assert.That(seen.Contains("wasteland") || seen.Contains("forest"), Is.True);
        }

        [Test]
        public void Generate_AllSitesAreConnected()
        {
            foreach (int seed in Seeds)
            {
                IslandMap map = Generate(seed);
                var adjacency = new List<int>[map.Sites.Count];
                for (int i = 0; i < adjacency.Length; i++) adjacency[i] = new List<int>();
                foreach (IslandEdge edge in map.Edges)
                {
                    adjacency[edge.A].Add(edge.B);
                    adjacency[edge.B].Add(edge.A);
                }

                var visited = new bool[map.Sites.Count];
                var queue = new Queue<int>();
                queue.Enqueue(0);
                visited[0] = true;
                while (queue.Count > 0)
                    foreach (int next in adjacency[queue.Dequeue()])
                        if (!visited[next])
                        {
                            visited[next] = true;
                            queue.Enqueue(next);
                        }

                Assert.That(visited, Is.All.True, $"シード{seed}: すべての土地へ道で到達できる（MST保証）");
            }
        }

        [Test]
        public void Generate_EdgesDoNotCross()
        {
            foreach (int seed in Seeds)
            {
                IslandMap map = Generate(seed);
                for (int i = 0; i < map.Edges.Count; i++)
                    for (int j = i + 1; j < map.Edges.Count; j++)
                        Assert.That(EdgesProperlyIntersect(map, map.Edges[i], map.Edges[j]), Is.False,
                            $"シード{seed}: 道{i}と道{j}は交差しない（Delaunay部分集合）");
            }
        }

        [Test]
        public void Generate_TravelMinutes_ArePositiveQuarterHourSteps()
        {
            foreach (int seed in Seeds)
                foreach (IslandEdge edge in Generate(seed).Edges)
                {
                    Assert.That(edge.TravelMinutes, Is.GreaterThanOrEqualTo(15), $"シード{seed}");
                    Assert.That(edge.TravelMinutes % 15, Is.Zero, $"シード{seed}: 移動時間は15分刻み");
                }
        }

        [Test]
        public void Generate_Names_AreAssignedAndUnique()
        {
            foreach (int seed in Seeds)
            {
                IslandMap map = Generate(seed);
                Assert.That(map.Sites.Select(s => s.Name), Is.All.Not.Null.And.All.Not.Empty, $"シード{seed}");
                Assert.That(map.Sites.Select(s => s.Name).Distinct().Count(), Is.EqualTo(map.Sites.Count),
                    $"シード{seed}: 土地の名前は重複しない");
            }
        }

        /// <summary>生成結果の完全な指紋（決定性の比較用）。</summary>
        private static string Fingerprint(IslandMap map)
        {
            var lines = new List<string>();
            foreach (Site site in map.Sites)
            {
                string axes = string.Join(",", site.AxisValues.OrderBy(kv => kv.Key, StringComparer.Ordinal)
                    .Select(kv => $"{kv.Key}={kv.Value}"));
                lines.Add(FormattableString.Invariant($"site {site.Index}: ({site.X:F6},{site.Y:F6}) ring={site.OnCoastRing} {site.Type.Name} '{site.Name}' [{axes}]"));
            }
            foreach (IslandEdge edge in map.Edges.OrderBy(e => e.A).ThenBy(e => e.B))
                lines.Add(FormattableString.Invariant($"edge {edge.A}-{edge.B}: {edge.Distance:F6} {edge.TravelMinutes}min"));
            return string.Join("\n", lines);
        }

        /// <summary>2つの辺が「真に」交差するか（端点の共有は交差とみなさない）。</summary>
        private static bool EdgesProperlyIntersect(IslandMap map, IslandEdge e1, IslandEdge e2)
        {
            if (e1.A == e2.A || e1.A == e2.B || e1.B == e2.A || e1.B == e2.B) return false;

            (double X, double Y) p1 = Point(map, e1.A), p2 = Point(map, e1.B);
            (double X, double Y) q1 = Point(map, e2.A), q2 = Point(map, e2.B);

            double d1 = Cross(q1, q2, p1);
            double d2 = Cross(q1, q2, p2);
            double d3 = Cross(p1, p2, q1);
            double d4 = Cross(p1, p2, q2);

            return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
                   ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
        }

        private static (double X, double Y) Point(IslandMap map, int index) => (map.Sites[index].X, map.Sites[index].Y);

        private static double Cross((double X, double Y) o, (double X, double Y) a, (double X, double Y) b) =>
            (a.X - o.X) * (b.Y - o.Y) - (a.Y - o.Y) * (b.X - o.X);
    }
}
