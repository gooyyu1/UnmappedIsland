using System.Collections.Generic;
using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain.Defs
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

    /// <summary>
    /// 6.4節の stages の1段。MinとEqはいずれか一方のみ有効（ロード時に両方の指定を拒否する）。
    /// Min: 下限のみの半開区間（数値プロパティ向け）。Eq: 完全一致判定（シンボル型プロパティ（6.8節）向け）。
    /// どちらも未指定ならフォールバック段（どの段にも該当しない場合の受け皿、6.4節）。
    /// </summary>
    public sealed class PropertyStage
    {
        public string Name { get; }

        /// <summary>下限。null は最下段（それより下の残り全ての値を拾う、6.4節）、またはEq指定時。</summary>
        public int? Min { get; }

        /// <summary>完全一致判定の対象値。null は未指定（Minまたはフォールバックとして扱う）。</summary>
        public int? Eq { get; }

        public PropertyStage(string name, int? min, int? eq = null)
        {
            Name = name;
            Min = min;
            Eq = eq;
        }
    }

    /// <summary>
    /// 1つの ObjectDef が持つ、1つのプロパティの定義（6節）。ObjectDef.propertyDefs の1要素として、
    /// ローカルIDをそのままindexとする密配列に格納される。同名プロパティでも ObjectDef ごとに
    /// range/stages/デフォルト値が異なりうるため、定義はObjectDefごとに個別に持つ。
    /// range系イベント（on_*）の発火判定・stages判定・初期値決定はこのPropertyDef自身の責務で、
    /// PropertyValueは値の変更を通知するだけ。
    /// </summary>
    public sealed class PropertyDef
    {
        public int GlobalId { get; }
        public string Name { get; }

        /// <summary>初期値（スカラー）。initialValueRangeを持つ場合は、RNGを使わない生成での
        /// フォールバック（= range.min）。</summary>
        private readonly int initialValue;

        /// <summary>value: {min, max} 記法による初期値のランダム範囲（6.2節、CreateValue参照）。無ければnull。</summary>
        private readonly PropertyRange? initialValueRange;

        /// <summary>取りうる値域（6.3節）。on_overflow/on_shortfall/on_min/on_maxを使う場合は必須。使わない場合は null。</summary>
        public PropertyRange? Range { get; }

        /// <summary>
        /// on_overflow（6.3節）: 値がRange.Maxを超えた際にselfへ一度だけ適用するactive内容。対象プロパティは
        /// 自分自身（折り返し）でも他のプロパティ（繰り上げ先）でも構わない。Rangeが定義されていて著者が
        /// 明示的に書かなかった場合、「自分自身をRange.Maxへsetする」既定のActiveEffectがビルド時に自動生成
        /// されて入る（Loader.WorldCodexYamlLoader.ParseProp参照）。Range自体が未定義の場合のみnull。
        /// </summary>
        private readonly ActiveEffect onOverflow;

        /// <summary>
        /// on_shortfall（6.3節）: on_overflowの下限側の鏡像。値がRange.Minを下回った際にselfへ一度だけ適用する。
        /// 未記述時は「自分自身をRange.Minへsetする」既定が自動生成される。Range未定義の場合のみnull。
        /// </summary>
        private readonly ActiveEffect onShortfall;

        /// <summary>順不同で構わない（ResolveStage が min の値そのもので判定するため）。空なら stages なし。</summary>
        private readonly IReadOnlyList<PropertyStage> stages;

        /// <summary>Stages中のフォールバック段（min:null・eq:null）。Stagesは不変のため一度だけ求める。
        /// 該当が無ければnull。</summary>
        private readonly PropertyStage fallbackStage;

        /// <summary>
        /// on_min（6.5節）。値がRange.Min以下である間、毎tick実行されるactive内容。on_overflow/on_shortfallと
        /// 異なり既定の自動生成は行わない（nullならon_minを持たない）。Rangeが必須。
        /// </summary>
        private readonly ActiveEffect onMin;

        /// <summary>
        /// on_max（6.6節）。値がRange.Max以上である間、毎tick実行されるactive内容。on_minの上限側の鏡像。
        /// 既定の自動生成は行わない（nullならon_maxを持たない）。Rangeが必須。
        /// </summary>
        private readonly ActiveEffect onMax;

        /// <summary>
        /// inherit: 同名プロパティを定義している最初の祖先（FindAncestorWithProperty）の実効値を、自分の
        /// 実効値に加算するか。祖先が見つからなければ寄与0。parentではなくancestorなのは、直接の親が
        /// このプロパティを持たない場合に備えるため（例: ambient_temperatureは部屋が持つ）。
        /// </summary>
        private readonly bool inherit;

        public PropertyDef(
            int globalId,
            string name,
            int initialValue,
            PropertyRange? initialValueRange,
            PropertyRange? range,
            ActiveEffect onOverflow,
            IReadOnlyList<PropertyStage> stages,
            ActiveEffect onMin = null,
            ActiveEffect onShortfall = null,
            ActiveEffect onMax = null,
            bool inherit = false)
        {
            GlobalId = globalId;
            Name = name;
            this.initialValue = initialValue;
            this.initialValueRange = initialValueRange;
            Range = range;
            this.onOverflow = onOverflow;
            this.stages = stages;
            this.onMin = onMin;
            this.onShortfall = onShortfall;
            this.onMax = onMax;
            this.inherit = inherit;

            foreach (var stage in stages)
            {
                if (!stage.Eq.HasValue && stage.Min == null)
                {
                    fallbackStage = stage;
                    break;
                }
            }
        }

        /// <summary>
        /// このプロパティ定義に属する、新しい実行時値（PropertyValue）を生成する。initialValueRangeを持つ
        /// プロパティは初期値を[min,max]の一様乱数（session.Rng）に、持たない場合は決定的なinitialValueにする（6.2節）。
        /// </summary>
        public PropertyValue CreateValue(WorldObject owner, WorldSession session)
        {
            int initial = initialValue;
            if (initialValueRange.HasValue)
            {
                int min = initialValueRange.Value.Min;
                int max = initialValueRange.Value.Max;
                // Random.Nextの上限は排他なので+1して[min,max]の閉区間にする（max==int.MaxValueのみ桁あふれ回避）。
                initial = session.Rng.Next(min, max == int.MaxValue ? max : max + 1);
            }
            return new PropertyValue(initial, this, owner);
        }

        /// <summary>
        /// number（変更直後の実体値）に対してon_max・on_min・on_overflow・on_shortfall（6.3・6.5・6.6節）を
        /// 判定し、該当するものをowner自身へ適用する。Rangeが未定義なら何もしない。
        ///
        /// 判定順はon_max→on_min→on_overflow→on_shortfall。観測者（on_max/on_min: 値を書き換えず境界到達を
        /// 報告する）を先に、補正者（on_overflow/on_shortfall: 折り返し等で値を書き換える）を後に評価する。
        /// 補正を先にすると値がrange内へ戻ってしまい、循環プロパティが一度にrange幅を飛び越えた場合など
        /// 「境界へ到達していた」事実を観測者が見逃すため、この順序は変えてはならない。
        ///
        /// on_overflow/on_shortfallの適用はowner側のAdd/SetNumberを通って本メソッドを再帰的に呼ぶため、
        /// 1回の呼び出しの中で複数span分の溢れや繰り上げ先自身のさらなる溢れ（分→時→日の連鎖）が解決される。
        /// </summary>
        public void CheckRangeEvents(int number, WorldObject owner, WorldSession session)
        {
            if (!Range.HasValue) return;
            PropertyRange range = Range.Value;

            if (onMax != null && number >= range.Max)
                owner.ApplyActiveEffect(onMax, session, actor: null, dragged: null);

            if (onMin != null && number <= range.Min)
                owner.ApplyActiveEffect(onMin, session, actor: null, dragged: null);

            if (onOverflow != null && number > range.Max)
                owner.ApplyActiveEffect(onOverflow, session, actor: null, dragged: null);

            if (onShortfall != null && number < range.Min)
                owner.ApplyActiveEffect(onShortfall, session, actor: null, dragged: null);
        }

        /// <summary>
        /// 現在値が該当する段階を返す。eq指定（完全一致、一致した時点で即返してよい）が優先、次にmin指定
        /// （最も高いminを採用するため全段を走査）、どちらも該当しなければfallbackStage（6.4節）。
        /// 段の判定はリスト中の位置に依存しない。fallbackが無ければnullを返し得るため、
        /// 呼び出し側（IsInStage等）は常にnullチェックする前提。
        /// </summary>
        private PropertyStage ResolveStage(int currentValue)
        {
            PropertyStage best = null;

            foreach (var stage in stages)
            {
                if (stage.Eq.HasValue)
                {
                    if (currentValue == stage.Eq.Value) return stage;
                    continue;
                }
                if (stage.Min.HasValue && currentValue >= stage.Min.Value && (best == null || stage.Min.Value > best.Min.Value))
                    best = stage;
            }

            return best ?? fallbackStage;
        }

        /// <summary>実効値effectiveValueのとき、このプロパティが名前stageNameの段（6.4節）に該当しているか。</summary>
        public bool IsInStage(int effectiveValue, string stageName)
        {
            PropertyStage stage = ResolveStage(effectiveValue);
            return stage != null && stage.Name == stageName;
        }

        /// <summary>inherit（6節）による、祖先からownerの実効値へ加える寄与。inheritが無効、
        /// または該当する祖先が見つからない場合は0。</summary>
        public int InheritedContribution(WorldObject owner)
        {
            if (!inherit) return 0;
            WorldObject ancestor = owner.FindAncestorWithProperty(GlobalId);
            return ancestor != null ? ancestor.GetEffectiveValue(GlobalId) : 0;
        }
    }
}
