using System.Collections.Generic;

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

        /// <summary>実行時インスタンス生成（WorldObject構築）時に、この定義に属する新しいPropertyValueへ
        /// 渡す初期値。定義自身が「初期値がどうあるべきか」を知っているため、テンプレートとなる
        /// PropertyValueインスタンスをCloneするのではなく、この数値からPropertyValue.Createで直接作る。</summary>
        public int DefaultNumber { get; }

        /// <summary>value: {min, max} による毎tick再ロール（6.2節）。使わない場合は null。</summary>
        public PropertyRange? RerollRange { get; }

        /// <summary>取りうる値域（6.3節）。on_overflow/on_shortfall/on_min/on_maxを使う場合は必須。使わない場合は null。</summary>
        public PropertyRange? Range { get; }

        /// <summary>
        /// on_overflow（6.3節）: 値がRange.Maxを超えた際に、selfへ一度だけ適用するactive内容。ActiveEffectを
        /// そのまま流用し、適用もWorldObject.ApplyActiveEffectをそのまま呼ぶだけで済ませる（オーバーフロー
        /// 専用の適用ロジックはWorldObject側に一切持たない）。対象プロパティ（Adds/Sets）は自分自身
        /// （折り返し）でも、他のプロパティ（繰り上げ先）でも構わない。
        ///
        /// Rangeが定義されていて著者が明示的にon_overflowを書かなかった場合、ここには「自分自身をRange.Max
        /// へsetする」という既定のActiveEffectがビルド時に自動生成されて入る（Loader.ObjectDefYamlConverter参照）。
        /// これにより、著者はレンジ型プロパティの上限クランプを、on_overflowを書かずに`range`を書くだけで
        /// 実現できる。Range自体が未定義の場合のみnull（上限の仕組み自体を持たない）。
        /// </summary>
        public ActiveEffect OnOverflow { get; }

        /// <summary>
        /// on_shortfall（6.3節）: on_overflowの下限側の鏡像。値がRange.Minを下回った際に、selfへ一度だけ
        /// 適用するactive内容。Rangeが定義されていて著者が明示的にon_shortfallを書かなかった場合、
        /// 「自分自身をRange.Minへsetする」という既定のActiveEffectがビルド時に自動生成される
        /// （Loader.ObjectDefYamlConverter参照）。Range自体が未定義の場合のみnull。
        /// </summary>
        public ActiveEffect OnShortfall { get; }

        /// <summary>順不同で構わない（ResolveStage が min の値そのもので判定するため）。空なら stages なし。</summary>
        public IReadOnlyList<PropertyStage> Stages { get; }

        /// <summary>
        /// on_min（6.5節、旧on_zero）。値がRange.Min以下である間、毎tick実行されるactive内容。0ではなく
        /// Range.Minとの比較に一般化したもの（destroyのような「底を突いた」判定を、0以外の下限を持つ
        /// プロパティにも使えるようにする）。on_overflow/on_shortfallとは異なり、著者が明示的に書かない
        /// 限り既定の自動生成は行わない（null なら on_min を持たない）。Rangeが必須。
        /// </summary>
        public ActiveEffect OnMin { get; }

        /// <summary>
        /// on_max（6.6節）。値がRange.Max以上である間、毎tick実行されるactive内容。on_minの上限側の鏡像。
        /// on_overflow/on_shortfallとは異なり、著者が明示的に書かない限り既定の自動生成は行わない
        /// （null なら on_max を持たない）。Rangeが必須。
        /// </summary>
        public ActiveEffect OnMax { get; }

        /// <summary>
        /// inherit: 自分の直接の親から遡り、この名前のプロパティを定義している最初の祖先（Runtime.
        /// WorldObject.FindAncestorWithProperty参照）の実効値を、自分の実効値に加算するか
        /// （GetEffectiveValue、PropertyValue参照）。該当する祖先が見つからない場合、寄与は0
        /// （既存の「見つからなければ0」規約と同じ）。parent固定ではなくancestor固定なのは、直接の親が
        /// このプロパティを持たない場合に備えるため（例: アイテムの直接の親はプレイヤーだが、
        /// temperatureは部屋が持つ）。
        /// </summary>
        public bool Inherit { get; }

        public PropertyDef(
            int globalId,
            string name,
            int defaultNumber,
            PropertyRange? rerollRange,
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
            DefaultNumber = defaultNumber;
            RerollRange = rerollRange;
            Range = range;
            OnOverflow = onOverflow;
            Stages = stages;
            OnMin = onMin;
            OnShortfall = onShortfall;
            OnMax = onMax;
            Inherit = inherit;
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
