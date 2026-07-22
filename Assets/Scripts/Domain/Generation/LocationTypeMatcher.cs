using System;
using System.Collections.Generic;
using System.Linq;
using UnmappedIsland.Domain.Defs.Generation;

namespace UnmappedIsland.Domain.Generation
{
    /// <summary>
    /// 各サイトへのLocationTypeの割り当て（TerrainGeneration.md 3.2〜3.4節）。
    ///
    /// 1. guarantees（島全体のバランス保証、3.4節）: 「指定軸が最大/最小のサイトへ強制割当」を
    ///    最近傍マッチングより先に行う（例: 最高標高のサイトは必ず山頂）。軸カバレッジの事後検証+
    ///    再生成ではなく、決定的な強制割当で保証する（再生成はシード再現性と停止性を複雑にするため）。
    /// 2. 最近傍マッチング（3.2節）: 正規化した重み付き距離
    ///        D = sqrt( Σ w_i * ((v_i - ideal_i) / tolerance_i)^2 / Σ w_i )
    ///    の最小の型を選ぶ。言及した軸だけをΣw_iで正規化するため、言及軸が少ない型が構造的に
    ///    有利になる次元数バイアスは無い。toleranceは距離のスケールであり、除外はhard_limitsのみが
    ///    担う（ドキュメントで未確定だった意味論の一義化）。同点は宣言順で先の型が勝つ（決定的）。
    /// 3. フォールバック（3.3節）: hard_limitsで全型が弾かれたサイトは、is_fallbackの型のうち
    ///    priority最大のものが受ける（フォールバックは最後の受け皿のため、自身のhard_limitsも無視する）。
    /// </summary>
    public static class LocationTypeMatcher
    {
        public static void AssignTypes(GenerationDefs defs, GenerationScopeDef scope, IReadOnlyList<Site> sites)
        {
            List<LocationTypeDef> types = defs.LocationTypes.Where(t => t.AppliesTo(scope.Name)).ToList();
            if (types.Count == 0)
                throw new InvalidOperationException($"スコープ'{scope.Name}'に適用できるlocation_typeが1つもありません。");

            var forced = new HashSet<Site>();

            foreach (GuaranteeDef guarantee in scope.Guarantees)
            {
                LocationTypeDef type = types.FirstOrDefault(t => t.Name == guarantee.LocationType);
                if (type == null)
                    throw new InvalidOperationException(
                        $"guaranteesのlocation_type '{guarantee.LocationType}' はスコープ'{scope.Name}'に適用できません。");

                // hard_limitsを満たすサイトを優先し、足りなければ全サイトから補う（保証は絶対のため）。
                foreach (Site site in OrderForGuarantee(sites.Where(s => !forced.Contains(s)), guarantee, type)
                             .Take(guarantee.Count))
                {
                    site.Type = type;
                    forced.Add(site);
                }
            }

            foreach (Site site in sites)
            {
                if (forced.Contains(site)) continue;
                site.Type = MatchNearest(types, site);
            }
        }

        private static IEnumerable<Site> OrderForGuarantee(IEnumerable<Site> candidates, GuaranteeDef guarantee, LocationTypeDef type)
        {
            List<Site> ordered = candidates.ToList();
            // 指定軸の最大/最小順（同値はIndex順で決定的に）。
            ordered.Sort((a, b) =>
            {
                int byAxis = a.AxisValues[guarantee.Axis].CompareTo(b.AxisValues[guarantee.Axis]);
                if (guarantee.Pick == GuaranteePick.Max) byAxis = -byAxis;
                return byAxis != 0 ? byAxis : a.Index.CompareTo(b.Index);
            });

            // hard_limitsを満たすサイトを先に。
            return ordered.Where(s => PassesHardLimits(type, s))
                .Concat(ordered.Where(s => !PassesHardLimits(type, s)));
        }

        private static LocationTypeDef MatchNearest(IReadOnlyList<LocationTypeDef> types, Site site)
        {
            LocationTypeDef best = null;
            double bestDistance = double.MaxValue;

            foreach (LocationTypeDef type in types)
            {
                if (type.Preferences.Count == 0) continue;      // 全軸無関心の型はフォールバック専用
                if (!PassesHardLimits(type, site)) continue;

                double distance = NormalizedDistance(type, site);
                if (distance < bestDistance)                     // 同点は宣言順で先の型が勝つ
                {
                    bestDistance = distance;
                    best = type;
                }
            }

            if (best != null) return best;

            LocationTypeDef fallback = types.Where(t => t.IsFallback)
                .OrderByDescending(t => t.Priority)
                .FirstOrDefault();
            if (fallback == null)
                throw new InvalidOperationException(
                    $"サイト{site.Index}（{FormatAxes(site)}）にマッチするlocation_typeが無く、is_fallbackの型もありません。");
            return fallback;
        }

        /// <summary>正規化した重み付きユークリッド距離（3.2節）。言及した軸だけをΣweightで正規化する。</summary>
        public static double NormalizedDistance(LocationTypeDef type, Site site)
        {
            double sum = 0;
            double weightSum = 0;
            foreach (AxisPreference preference in type.Preferences)
            {
                double deviation = (site.AxisValues[preference.Axis] - preference.Ideal) / (double)preference.Tolerance;
                sum += preference.Weight * deviation * deviation;
                weightSum += preference.Weight;
            }

            return Math.Sqrt(sum / weightSum);
        }

        private static bool PassesHardLimits(LocationTypeDef type, Site site)
        {
            foreach (AxisLimit limit in type.HardLimits)
                if (!limit.Allows(site.AxisValues[limit.Axis]))
                    return false;
            return true;
        }

        private static string FormatAxes(Site site) =>
            string.Join(", ", site.AxisValues.Select(kv => $"{kv.Key}={kv.Value}"));
    }
}
