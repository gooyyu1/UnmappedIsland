using System.Collections.Generic;
using UnmappedIsland.Runtime;

namespace UnmappedIsland.Codex
{
    public readonly struct PropertyRange
    {
        public readonly int Min;
        public readonly int Max;

        public PropertyRange(int min, int max)
        {
            Min = min;
            Max = max;
        }

        /// <summary>値をこの範囲内に収める（GameElementDefinition.md 6.3節）。</summary>
        public int Clamp(int value)
        {
            if (value < Min) return Min;
            if (value > Max) return Max;
            return value;
        }
    }

    /// <summary>6.4節の stages の1段。区間は下限のみで表す半開区間。</summary>
    public sealed class PropertyStage
    {
        public string Name { get; }

        /// <summary>下限。null は最下段（それより下の残り全ての値を拾う、6.4節）。</summary>
        public int? Min { get; }

        public PropertyStage(string name, int? min)
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

        /// <summary>取りうる値域（6.3節）。on_overflowを使う場合は必須。使わない場合は null。</summary>
        public PropertyRange? Range { get; }

        /// <summary>
        /// on_overflow（6.3節）: 値がRange.Maxを超えた際に、selfへ一度だけ適用するactive内容。on_zero
        /// と全く同じ型（ActiveEffect）をそのまま流用し、適用もWorldObject.ApplyActiveEffectをそのまま
        /// 呼ぶだけで済ませる（オーバーフロー専用の適用ロジックはWorldObject側に一切持たない）。
        /// null ならon_overflowを持たない。対象プロパティ（Adds）は自分自身（折り返し）でも、
        /// 他のプロパティ（繰り上げ先）でも構わない。
        /// </summary>
        public ActiveEffect OnOverflow { get; }

        /// <summary>順不同で構わない（ResolveStage が min の値そのもので判定するため）。空なら stages なし。</summary>
        public IReadOnlyList<PropertyStage> Stages { get; }

        /// <summary>
        /// on_zero（6.5節）。値が0以下である間、毎tick実行されるactive内容。null なら on_zero を持たない。
        /// </summary>
        public ActiveEffect OnZero { get; }

        public PropertyDef(
            int globalId,
            string name,
            PropertyValue defaultValue,
            PropertyRange? rerollRange,
            PropertyRange? range,
            ActiveEffect onOverflow,
            IReadOnlyList<PropertyStage> stages,
            ActiveEffect onZero = null)
        {
            GlobalId = globalId;
            Name = name;
            DefaultValue = defaultValue;
            RerollRange = rerollRange;
            Range = range;
            OnOverflow = onOverflow;
            Stages = stages;
            OnZero = onZero;
        }

        /// <summary>
        /// 現在値が該当する段階を返す。min:null の段階は「他のどの段階にも該当しない場合」のフォールバックであり、
        /// リスト中の位置には依存しない（11.2節のサンプルでは broken(min:null) が intact(min:1) より後に書かれている）。
        /// </summary>
        public PropertyStage ResolveStage(int currentValue)
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
