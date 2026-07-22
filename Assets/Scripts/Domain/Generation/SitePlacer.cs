using System;
using System.Collections.Generic;
using UnmappedIsland.Domain.Defs.Generation;

namespace UnmappedIsland.Domain.Generation
{
    /// <summary>
    /// サイト（Site）の座標配置。半径IslandRadiusの円盤を島とみなし、次の2段で配置する。
    ///
    /// 1. 外周リング: 島を囲む海岸候補のサイトを、外周の円環（半径85〜95%）へ等間隔+ジッタで置く。
    ///    個数は全体の約35%（4〜7個に制限）。島が必ず海岸に囲まれることと、海岸が多くなり
    ///    すぎないことを、この配置枠の個数制御で同時に保証する（「島なので普通に生成すると海岸が
    ///    多くなりすぎる」ことへの対策。円盤への一様散布は面積比で外周が多数になり、凸包だけを
    ///    海岸にしても小さなサイト数では凸包が過半になってしまうため、リングを配置の段階で分ける）。
    /// 2. 内陸: 残りのサイトをベストキャンディデート法（Mitchell）で内側（半径75%以内）へ散布する。
    ///    Poisson-diskサンプリングは結果の個数が半径から決まり「10〜20個ちょうど」を直接指定
    ///    できないため、個数を直接指定できるベストキャンディデート法を使う（TerrainGeneration.md
    ///    3.5節の「Poisson-disk等」の実装上の置き換え）。interior_biasが高いほど中心へ寄せる。
    /// </summary>
    public static class SitePlacer
    {
        /// <summary>島（抽象座標系）の半径。距離・ノイズ座標の正規化の基準。</summary>
        public const double IslandRadius = 100.0;

        /// <summary>外周リングの半径の範囲（IslandRadius比）。</summary>
        private const double CoastRingMinRadius = 0.85;
        private const double CoastRingMaxRadius = 0.95;

        /// <summary>内陸サイトの最大半径（IslandRadius比）。外周リングとの間に必ず隙間を作り、
        /// 内陸サイトが海岸帯（coastal_distanceの下限）へ紛れ込まないようにする。</summary>
        private const double InteriorMaxRadius = 0.75;

        /// <summary>ベストキャンディデート法の1点あたりの候補数。</summary>
        private const int CandidatesPerSite = 10;

        public static List<Site> Place(GenerationScopeDef scope, Pcg32 rng)
        {
            int total = rng.NextInt(scope.SiteCountMin, scope.SiteCountMax);

            // 海岸（外周リング）の個数: 全体の約35%、ただし「島を囲める最低限」として4個以上、
            // 「多くなりすぎない」上限として7個以下。内陸にも最低3個は残す（山+内陸2種の余地）。
            int coastCount = Math.Clamp((int)Math.Round(total * 0.35), 4, 7);
            coastCount = Math.Min(coastCount, total - 3);

            var sites = new List<Site>();

            // 1. 外周リング: 等間隔の角度+ジッタ。
            double angleStep = 2 * Math.PI / coastCount;
            double angleOffset = rng.NextDouble() * 2 * Math.PI;
            for (int i = 0; i < coastCount; i++)
            {
                double angle = angleOffset + angleStep * (i + (rng.NextDouble() - 0.5) * 0.6);
                double radius = IslandRadius * (CoastRingMinRadius + rng.NextDouble() * (CoastRingMaxRadius - CoastRingMinRadius));
                sites.Add(new Site(sites.Count, radius * Math.Cos(angle), radius * Math.Sin(angle), onCoastRing: true));
            }

            // 2. 内陸: ベストキャンディデート法（既存サイトへの最小距離が最大の候補を採用）。
            // interior_bias(0〜100)は半径分布の指数を0.5(一様)→1.0(中心寄り)へ動かす。
            double radiusExponent = 0.5 + scope.InteriorBias / 100.0 * 0.5;
            int interiorCount = total - coastCount;
            for (int i = 0; i < interiorCount; i++)
            {
                double bestX = 0, bestY = 0, bestScore = -1;
                for (int candidate = 0; candidate < CandidatesPerSite; candidate++)
                {
                    double angle = rng.NextDouble() * 2 * Math.PI;
                    double radius = IslandRadius * InteriorMaxRadius * Math.Pow(rng.NextDouble(), radiusExponent);
                    double x = radius * Math.Cos(angle);
                    double y = radius * Math.Sin(angle);

                    double score = double.MaxValue;
                    foreach (Site existing in sites)
                    {
                        double dx = x - existing.X;
                        double dy = y - existing.Y;
                        score = Math.Min(score, dx * dx + dy * dy);
                    }

                    if (score > bestScore)
                    {
                        bestScore = score;
                        bestX = x;
                        bestY = y;
                    }
                }

                sites.Add(new Site(sites.Count, bestX, bestY, onCoastRing: false));
            }

            return sites;
        }
    }
}
