using System;
using System.Collections.Generic;
using UnmappedIsland.Domain.Defs.Generation;

namespace UnmappedIsland.Domain.Generation
{
    /// <summary>
    /// 各サイトの軸値のサンプリング（TerrainGeneration.md 3.1節）。AxisDefのジェネレータ層
    /// （distance_field / layered_noise）を[0,1]で計算して重み平均し、AxisDef.Rangeの整数値へ
    /// 量子化してSite.AxisValuesに書き込む。
    /// </summary>
    public static class AxisSampler
    {
        /// <summary>海岸帯の判定（generation_scopesのcoast_band・hull_coast）が対象にする、
        /// 生成側が規約として知っている軸名（WellKnownPropertiesの"size"/"weight"と同じ立ち位置）。
        /// この名前の軸が定義されていなければ、海岸帯クランプは単に何もしない。</summary>
        public const string CoastalDistanceAxisName = "coastal_distance";

        public static void Sample(IReadOnlyDictionary<string, AxisDef> axes, IReadOnlyList<Site> sites, int seed, GenerationScopeDef scope)
        {
            foreach (Site site in sites)
            {
                foreach (AxisDef axis in axes.Values)
                {
                    double weighted = 0;
                    double weightSum = 0;
                    foreach (GeneratorLayer layer in axis.Layers)
                    {
                        weighted += SampleLayer(layer, site, seed) * layer.Weight;
                        weightSum += layer.Weight;
                    }

                    double normalized = weightSum > 0 ? weighted / weightSum : 0;
                    int value = axis.Range.Min + (int)Math.Round(normalized * (axis.Range.Max - axis.Range.Min));
                    site.AxisValues[axis.Name] = axis.Range.Clamp(value);
                }

                // 外周リングのサイトを海岸帯へクランプし、島が必ず海岸（の型しかマッチしない領域）で
                // 囲まれることを保証する（3.4節のバランス保証の一部を配置の構造で担う）。
                if (scope.HullCoast && site.OnCoastRing && site.AxisValues.TryGetValue(CoastalDistanceAxisName, out int coastal))
                    site.AxisValues[CoastalDistanceAxisName] = Math.Min(coastal, scope.CoastBand);
            }
        }

        /// <summary>ジェネレータ1層の[0,1]サンプル値。</summary>
        private static double SampleLayer(GeneratorLayer layer, Site site, int seed)
        {
            switch (layer.Type)
            {
                case GeneratorLayerType.DistanceField:
                    // 島の縁からの距離場: 縁=0、中心=1。
                    double radius = Math.Sqrt(site.X * site.X + site.Y * site.Y);
                    return 1.0 - Math.Min(1.0, radius / SitePlacer.IslandRadius);

                case GeneratorLayerType.LayeredNoise:
                    return ValueNoise.Sample(seed + layer.SeedOffset, site.X, site.Y, layer.Octaves, layer.Frequency);

                default:
                    throw new InvalidOperationException($"未知のジェネレータ層: {layer.Type}");
            }
        }
    }
}
