using System;
using System.Collections.Generic;
using UnmappedIsland.Domain.Defs.Generation;

namespace UnmappedIsland.Domain.Generation
{
    /// <summary>
    /// Site（TerrainGeneration.md 1節）: 座標と軸ベクトルを持つ、生成途中のノード。
    /// パイプラインが進むにつれてLocationType・名前が確定し、最終的にIslandSpawnerが
    /// Location（object_defのWorldObjectインスタンス）として実体化する。
    /// </summary>
    public sealed class Site
    {
        public int Index { get; }
        public double X { get; }
        public double Y { get; }

        /// <summary>島の外周リング（海岸帯へクランプされる配置枠）として置かれたサイトか。</summary>
        public bool OnCoastRing { get; }

        /// <summary>軸名→軸値（0〜100等、AxisDef.Rangeへ量子化済みの整数）。</summary>
        public Dictionary<string, int> AxisValues { get; } = new Dictionary<string, int>();

        /// <summary>マッチング（LocationTypeMatcher）で確定するLocationType。</summary>
        public LocationTypeDef Type { get; set; }

        /// <summary>命名処理（NameAssigner）で確定する表示名（例: 「東の草原」）。</summary>
        public string Name { get; set; }

        public Site(int index, double x, double y, bool onCoastRing)
        {
            Index = index;
            X = x;
            Y = y;
            OnCoastRing = onCoastRing;
        }

        public double DistanceTo(Site other)
        {
            double dx = X - other.X;
            double dy = Y - other.Y;
            return Math.Sqrt(dx * dx + dy * dy);
        }
    }

    /// <summary>土地同士を繋ぐ道1本（無向辺）。TravelMinutesは距離と両端の移動コストから確定済み。</summary>
    public sealed class IslandEdge
    {
        public int A { get; }
        public int B { get; }
        public double Distance { get; }
        public int TravelMinutes { get; }

        public IslandEdge(int a, int b, double distance, int travelMinutes)
        {
            A = a;
            B = b;
            Distance = distance;
            TravelMinutes = travelMinutes;
        }
    }

    /// <summary>
    /// 地形生成の結果（サイト・型・命名・パスネットワーク）を表す不変のデータ。
    /// TerrainGenerator.Generateの出力であり、WorldObjectには一切触れない純粋な計算結果。
    /// 世界への実体化（spawn）はIslandSpawnerがこのデータを読んで行い、その際に
    /// SiteInstanceIds（サイトIndex→生成されたWorldObject.InstanceId）を書き込む。
    /// </summary>
    public sealed class IslandMap
    {
        public string ScopeName { get; }
        public int Seed { get; }
        public IReadOnlyList<Site> Sites { get; }
        public IReadOnlyList<IslandEdge> Edges { get; }

        /// <summary>サイトIndex→実体化されたLocationのWorldObject.InstanceId（IslandSpawnerが埋める。
        /// 未実体化なら0）。</summary>
        public int[] SiteInstanceIds { get; }

        public IslandMap(string scopeName, int seed, IReadOnlyList<Site> sites, IReadOnlyList<IslandEdge> edges)
        {
            ScopeName = scopeName;
            Seed = seed;
            Sites = sites;
            Edges = edges;
            SiteInstanceIds = new int[sites.Count];
        }
    }
}
