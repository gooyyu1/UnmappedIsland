using System.Collections.Generic;

namespace UnmappedIsland.Domain.Defs.Generation
{
    /// <summary>guaranteesのpick: 保証対象のサイトを軸値のどちら側から選ぶか。</summary>
    public enum GuaranteePick
    {
        Max,
        Min,
    }

    /// <summary>
    /// 島全体のバランス保証の1エントリ（TerrainGeneration.md 3.4節・6節の「カバレッジ保証」への
    /// 実装回答）。軸の分布だけでは「山が必ず1つ」を保証できないため、「指定軸が最大/最小のサイトから
    /// Count個へ、このLocationTypeを強制割当する」という明示的な保証を、最近傍マッチングの前に行う。
    /// </summary>
    public sealed class GuaranteeDef
    {
        public string LocationType { get; }
        public int Count { get; }
        public string Axis { get; }
        public GuaranteePick Pick { get; }

        public GuaranteeDef(string locationType, int count, string axis, GuaranteePick pick)
        {
            LocationType = locationType;
            Count = count;
            Axis = axis;
            Pick = pick;
        }
    }

    /// <summary>
    /// 生成スコープ（TerrainGeneration.md 3.7節）: 島の生成と構造物内部の生成が共有する
    /// 生成ロジックへの、スコープごとのパラメータプリセット。
    /// </summary>
    public sealed class GenerationScopeDef
    {
        public string Name { get; }

        /// <summary>生成する土地の数の範囲（この範囲からシードで抽選）。</summary>
        public int SiteCountMin { get; }
        public int SiteCountMax { get; }

        /// <summary>coastal_distanceがこの値以下のサイトを「海岸帯」とみなす。</summary>
        public int CoastBand { get; }

        /// <summary>凸包上（外周）のサイトのcoastal_distanceを海岸帯へクランプするか
        /// （島が必ず海岸で囲まれることの保証）。</summary>
        public bool HullCoast { get; }

        /// <summary>サイト配置の内陸バイアス（0=一様、100=最大）。外周に張り付くサイトを減らし、
        /// 海岸が多くなりすぎないようにする。</summary>
        public int InteriorBias { get; }

        /// <summary>MST以外のDelaunay辺を復活させる迂回率の閾値（%）。現グラフでの2点間最短距離が
        /// 直結距離のこの割合を超えるなら、その辺を近道として復活させる。</summary>
        public int ExtraEdgeDetourFactor { get; }

        /// <summary>抽象座標の距離1あたりの基準移動時間（分）。</summary>
        public int BaseMinutesPerDistance { get; }

        public IReadOnlyList<GuaranteeDef> Guarantees { get; }

        public GenerationScopeDef(
            string name, int siteCountMin, int siteCountMax, int coastBand, bool hullCoast,
            int interiorBias, int extraEdgeDetourFactor, int baseMinutesPerDistance,
            IReadOnlyList<GuaranteeDef> guarantees)
        {
            Name = name;
            SiteCountMin = siteCountMin;
            SiteCountMax = siteCountMax;
            CoastBand = coastBand;
            HullCoast = hullCoast;
            InteriorBias = interiorBias;
            ExtraEdgeDetourFactor = extraEdgeDetourFactor;
            BaseMinutesPerDistance = baseMinutesPerDistance;
            Guarantees = guarantees;
        }
    }
}
