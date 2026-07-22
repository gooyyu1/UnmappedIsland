using System.Collections.Generic;

namespace UnmappedIsland.Domain.Defs.Generation
{
    /// <summary>ある軸に対する「理想点+許容範囲」（axis_preferencesの1エントリ、TerrainGeneration.md 3.2節）。</summary>
    public sealed class AxisPreference
    {
        public string Axis { get; }

        /// <summary>理想の軸値。</summary>
        public int Ideal { get; }

        /// <summary>許容幅（距離のスケール）。軸値がidealからtolerance分ずれると正規化距離1に相当する。
        /// 「超えたら除外」のゲートではない（除外はLocationTypeDef.HardLimitsだけが担う）。</summary>
        public int Tolerance { get; }

        /// <summary>この軸の重要度（整数、100=等倍）。マッチング距離はΣweightで正規化するため、
        /// 言及する軸の数が少ない型が構造的に有利になることはない。</summary>
        public int Weight { get; }

        public AxisPreference(string axis, int ideal, int tolerance, int weight)
        {
            Axis = axis;
            Ideal = ideal;
            Tolerance = tolerance;
            Weight = weight;
        }
    }

    /// <summary>ある軸に対する絶対的な除外条件（hard_limitsの1エントリ）。範囲外のサイトには
    /// この型が絶対にマッチしない。</summary>
    public sealed class AxisLimit
    {
        public string Axis { get; }
        public int? Min { get; }
        public int? Max { get; }

        public AxisLimit(string axis, int? min, int? max)
        {
            Axis = axis;
            Min = min;
            Max = max;
        }

        public bool Allows(int value)
        {
            if (Min.HasValue && value < Min.Value) return false;
            if (Max.HasValue && value > Max.Value) return false;
            return true;
        }
    }

    /// <summary>
    /// LocationType（TerrainGeneration.md 1節・3.2節）: 「草原」「洞窟」など、配置の定義。
    /// プレイヤーには見えない設計者側の語彙で、実体（Location）はObjectDefGlobalIdが指す
    /// object_def（locations.yaml）のインスタンスとして生成される。
    /// </summary>
    public sealed class LocationTypeDef
    {
        public string Name { get; }

        /// <summary>この型が実体化するときのobject_defのグローバルID（Build時に存在検証済み）。</summary>
        public int ObjectDefGlobalId { get; }

        /// <summary>命名処理（「東の草原」等）に使う表示名。</summary>
        public string DisplayName { get; }

        /// <summary>この型が適用される生成スコープ名（3.7節）。空なら全スコープに適用される。</summary>
        public IReadOnlyList<string> ApplicableScopes { get; }

        /// <summary>移動コスト（100=等倍）。道のtravel_minutesの係数になる。</summary>
        public int MoveCost { get; }

        /// <summary>どの型もhard_limitsで弾かれたサイトの受け皿か（3.3節のフォールバック）。</summary>
        public bool IsFallback { get; }

        /// <summary>フォールバックが複数あるときの優先度（大きいほど優先）。</summary>
        public int Priority { get; }

        public IReadOnlyList<AxisPreference> Preferences { get; }
        public IReadOnlyList<AxisLimit> HardLimits { get; }

        public LocationTypeDef(
            string name, int objectDefGlobalId, string displayName,
            IReadOnlyList<string> applicableScopes, int moveCost, bool isFallback, int priority,
            IReadOnlyList<AxisPreference> preferences, IReadOnlyList<AxisLimit> hardLimits)
        {
            Name = name;
            ObjectDefGlobalId = objectDefGlobalId;
            DisplayName = displayName;
            ApplicableScopes = applicableScopes;
            MoveCost = moveCost;
            IsFallback = isFallback;
            Priority = priority;
            Preferences = preferences;
            HardLimits = hardLimits;
        }

        /// <summary>このLocationTypeが指定スコープに適用されるか（空なら全スコープ）。</summary>
        public bool AppliesTo(string scopeName)
        {
            if (ApplicableScopes.Count == 0) return true;
            foreach (string scope in ApplicableScopes)
                if (scope == scopeName) return true;
            return false;
        }
    }
}
