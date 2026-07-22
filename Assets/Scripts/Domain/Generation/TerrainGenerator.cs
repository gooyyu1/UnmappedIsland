using System;
using UnmappedIsland.Domain.Defs.Generation;

namespace UnmappedIsland.Domain.Generation
{
    /// <summary>
    /// 地形生成パイプラインのオーケストレータ（TerrainGeneration.md 2節）。
    ///
    ///   サイト配置（SitePlacer） → 軸サンプリング（AxisSampler） → LocationTypeマッチング
    ///   （LocationTypeMatcher、guarantees含む） → Delaunay三角形分割 → MST+復活辺の
    ///   パスネットワーク（PathNetworkBuilder） → 命名（NameAssigner）
    ///
    /// を順に実行し、結果をIslandMapとして返す。WorldObjectには一切触れない純粋な計算で、
    /// 乱数はPcg32(seed)だけに依存する（同じ定義+同じシード→常に同じIslandMap）。
    /// 世界への実体化はIslandSpawnerが担う。
    ///
    /// 生成スコープを差し替えれば同じロジックがそのまま走る（島と構造物内部で生成ロジックを
    /// 共有するという方針、3.7節。structure_interiorスコープの定義・再帰実行は今後の課題）。
    /// </summary>
    public static class TerrainGenerator
    {
        public static IslandMap Generate(GenerationDefs defs, string scopeName, int seed)
        {
            if (defs == null)
                throw new ArgumentNullException(nameof(defs), "地形生成の定義（terrain_generation.yaml）がロードされていません。");
            if (!defs.Scopes.TryGetValue(scopeName, out GenerationScopeDef scope))
                throw new ArgumentException($"生成スコープ '{scopeName}' が定義されていません。", nameof(scopeName));

            var rng = new Pcg32(seed);
            var sites = SitePlacer.Place(scope, rng);
            AxisSampler.Sample(defs.Axes, sites, seed, scope);
            LocationTypeMatcher.AssignTypes(defs, scope, sites);
            var delaunayEdges = DelaunayTriangulator.Triangulate(sites);
            var edges = PathNetworkBuilder.Build(sites, delaunayEdges, scope);
            NameAssigner.AssignNames(sites);

            return new IslandMap(scopeName, seed, sites, edges);
        }
    }
}
