using System;
using System.Collections.Generic;
using UnmappedIsland.Codex.Registry;

namespace UnmappedIsland.Codex.Defs
{
    public readonly struct PropertyRange
    {
        public readonly double Min;
        public readonly double Max;

        public PropertyRange(double min, double max)
        {
            Min = min;
            Max = max;
        }
    }

    public enum OverflowMode
    {
        None,
        Wrap,
    }

    /// <summary>6.3節の on_overflow。carry_to は同一 ObjectDef 内の別プロパティを指す。</summary>
    public sealed class OverflowRule
    {
        public OverflowMode Mode { get; }

        /// <summary>Mode.Wrap のときの繰り上げ先プロパティのローカルID（同一ObjectDef内）。Mode.None なら未使用。</summary>
        public int CarryToLocalId { get; }

        public static readonly OverflowRule None = new OverflowRule(OverflowMode.None, LocalIndexMap.Missing);

        public OverflowRule(OverflowMode mode, int carryToLocalId)
        {
            Mode = mode;
            CarryToLocalId = carryToLocalId;
        }
    }

    /// <summary>6.4節の stages の1段。区間は下限のみで表す半開区間。</summary>
    public sealed class PropertyStage
    {
        public string Name { get; }

        /// <summary>下限。null は最下段（それより下の残り全ての値を拾う、6.4節）。</summary>
        public double? Min { get; }

        public PropertyStage(string name, double? min)
        {
            Name = name;
            Min = min;
        }

        // 段階ごとの passive/active（8節）はこの検討の対象外。フィールドを足すだけで済み、
        // Property配列のレイアウト（ObjectDef.PropertyDefs / WorldObjectのproperties配列）には影響しない。
    }

    /// <summary>
    /// 1つの ObjectDef が持つ、1つのプロパティの定義（6節）。ObjectDef.PropertyDefs の1要素として、
    /// ローカルIDをそのままindexとする密配列に格納される。
    ///
    /// 同名のプロパティ（例: "durability"）でも ObjectDef ごとに range/stages/デフォルト値が異なりうるため、
    /// 定義はプロパティ名に対してグローバルに1つではなく、ObjectDefごとに個別に持つ。
    /// </summary>
    public sealed class PropertyDef
    {
        public int GlobalId { get; }
        public string Name { get; }

        public PropertyValue DefaultValue { get; }

        /// <summary>value: {min, max} による毎tick再ロール（6.2節）。使わない場合は null。</summary>
        public PropertyRange? RerollRange { get; }

        /// <summary>取りうる値域（6.3節）。使わない場合は null。</summary>
        public PropertyRange? Range { get; }

        public OverflowRule Overflow { get; }

        /// <summary>順不同で構わない（ResolveStage が min の値そのもので判定するため）。空なら stages なし。</summary>
        public IReadOnlyList<PropertyStage> Stages { get; }

        /// <summary>
        /// on_zero（新設）を持つか。正の値から0以下へ跨いだ瞬間を検出する対象にするかどうかのフラグ。
        /// 実際に何を発火するか（lifecycle等）はここでは持たず、WorldObject.Tick が検出だけを行う
        /// （8.3節: lifecycleはactive専用に戻し、耐久値のような「0になったら破棄」はon_zero経由で表現する）。
        /// </summary>
        public bool HasOnZero { get; }

        public PropertyDef(
            int globalId,
            string name,
            PropertyValue defaultValue,
            PropertyRange? rerollRange,
            PropertyRange? range,
            OverflowRule overflow,
            IReadOnlyList<PropertyStage> stages,
            bool hasOnZero = false)
        {
            GlobalId = globalId;
            Name = name;
            DefaultValue = defaultValue;
            RerollRange = rerollRange;
            Range = range;
            Overflow = overflow ?? OverflowRule.None;
            Stages = stages ?? Array.Empty<PropertyStage>();
            HasOnZero = hasOnZero;
        }

        /// <summary>
        /// 現在値が該当する段階を返す。min:null の段階は「他のどの段階にも該当しない場合」のフォールバックであり、
        /// リスト中の位置には依存しない（11.2節のサンプルでは broken(min:null) が intact(min:1) より後に書かれている）。
        /// </summary>
        public PropertyStage ResolveStage(double currentValue)
        {
            PropertyStage fallback = null;
            PropertyStage best = null;

            foreach (var stage in Stages)
            {
                if (stage.Min == null)
                {
                    fallback = stage;
                    continue;
                }
                if (currentValue >= stage.Min.Value && (best == null || stage.Min.Value > best.Min.Value))
                    best = stage;
            }

            return best ?? fallback;
        }
    }
}
