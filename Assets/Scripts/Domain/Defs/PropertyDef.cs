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
    ///
    /// Min: 区間は下限のみで表す半開区間。値の大小関係を前提にした数値プロパティ向け。
    /// Eq: 完全一致判定。シンボル型プロパティ（6.8節）のように、内部で保持する整数値の大小関係が
    /// 著者にとって意味を持たない（NameRegistryへの登録順で決まるだけの）値に対して使う。
    /// どちらも未指定なら最下段（それ以外のどの段にも該当しない場合のフォールバック、6.4節）。
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

        // 段階ごとの passive/active（8節）はこの検討の対象外。フィールドを足すだけで済み、
        // Property配列のレイアウト（ObjectDef.propertyDefs / WorldObjectのproperties配列）には影響しない。
    }

    /// <summary>
    /// 1つの ObjectDef が持つ、1つのプロパティの定義（6節）。ObjectDef.propertyDefs の1要素として、
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
        /// へsetする」という既定のActiveEffectがビルド時に自動生成されて入る（Loader.WorldCodexYamlLoader.ParseProp参照）。
        /// これにより、著者はレンジ型プロパティの上限クランプを、on_overflowを書かずに`range`を書くだけで
        /// 実現できる。Range自体が未定義の場合のみnull（上限の仕組み自体を持たない）。
        ///
        /// どのイベントをいつ発火するかという判定はこのPropertyDef自身の責務であり（CheckRangeEvents参照）、
        /// 値を保持するRuntime.PropertyValueは「値が変わった」とだけ通知する。そのため個々のon_*は外部へ
        /// 公開せずprivateに閉じる。
        /// </summary>
        private readonly ActiveEffect onOverflow;

        /// <summary>
        /// on_shortfall（6.3節）: on_overflowの下限側の鏡像。値がRange.Minを下回った際に、selfへ一度だけ
        /// 適用するactive内容。Rangeが定義されていて著者が明示的にon_shortfallを書かなかった場合、
        /// 「自分自身をRange.Minへsetする」という既定のActiveEffectがビルド時に自動生成される
        /// （Loader.WorldCodexYamlLoader.ParseProp参照）。Range自体が未定義の場合のみnull。
        /// </summary>
        private readonly ActiveEffect onShortfall;

        /// <summary>順不同で構わない（ResolveStage が min の値そのもので判定するため）。空なら stages なし。</summary>
        public IReadOnlyList<PropertyStage> Stages { get; }

        /// <summary>Stages中のmin:null・eq:null（フォールバック）の段。Stagesはコンストラクタ以降不変のため、
        /// currentValueに依らず一度だけ求めれば済み、ResolveStageの呼び出し毎に走査し直す必要が無い。
        /// 該当が無ければnull（フォールバックを持たないプロパティ、シンボル型プロパティ等）。</summary>
        private readonly PropertyStage fallbackStage;

        /// <summary>
        /// on_min（6.5節、旧on_zero）。値がRange.Min以下である間、毎tick実行されるactive内容。0ではなく
        /// Range.Minとの比較に一般化したもの（destroyのような「底を突いた」判定を、0以外の下限を持つ
        /// プロパティにも使えるようにする）。on_overflow/on_shortfallとは異なり、著者が明示的に書かない
        /// 限り既定の自動生成は行わない（null なら on_min を持たない）。Rangeが必須。
        /// </summary>
        private readonly ActiveEffect onMin;

        /// <summary>
        /// on_max（6.6節）。値がRange.Max以上である間、毎tick実行されるactive内容。on_minの上限側の鏡像。
        /// on_overflow/on_shortfallとは異なり、著者が明示的に書かない限り既定の自動生成は行わない
        /// （null なら on_max を持たない）。Rangeが必須。
        /// </summary>
        private readonly ActiveEffect onMax;

        /// <summary>
        /// inherit: 自分の直接の親から遡り、この名前のプロパティを定義している最初の祖先（Runtime.
        /// WorldObject.FindAncestorWithProperty参照）の実効値を、自分の実効値に加算するか
        /// （GetEffectiveValue、PropertyValue参照）。該当する祖先が見つからない場合、寄与は0
        /// （既存の「見つからなければ0」規約と同じ）。parent固定ではなくancestor固定なのは、直接の親が
        /// このプロパティを持たない場合に備えるため（例: アイテムの直接の親はプレイヤーだが、
        /// ambient_temperatureは部屋が持つ）。
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
            this.onOverflow = onOverflow;
            Stages = stages;
            this.onMin = onMin;
            this.onShortfall = onShortfall;
            this.onMax = onMax;
            Inherit = inherit;

            foreach (var stage in Stages)
            {
                if (!stage.Eq.HasValue && stage.Min == null)
                {
                    fallbackStage = stage;
                    break;
                }
            }
        }

        /// <summary>
        /// number（このプロパティを保持するownerの、変更直後の実体値）に対して、on_max・on_min・on_overflow・
        /// on_shortfall（6.3節・6.5節・6.6節）を判定し、該当するものをowner自身へ適用する。どのイベントを
        /// いつ発火するかはこのPropertyDef（range・on_*の定義を持つ本人）の責務であり、値を保持する
        /// Runtime.PropertyValueは「値が変わった」とだけ通知してこの判定を委譲する（自分のことは自分でする、
        /// CLAUDE.md参照）。適用はowner.ApplyActiveEffect（actions/combinationsと全く同じ適用経路）を
        /// そのまま呼ぶだけで、専用の適用ロジックは一切持たない。Rangeが未定義なら何もしない。
        ///
        /// 判定順はon_max→on_min→on_overflow→on_shortfall。on_max/on_minは「レベルトリガーの観測者」
        /// （値を書き換えず、境界に達している事実をそのまま報告する）、on_overflow/on_shortfallは
        /// 「値を書き換える補正者」（circular/wrapするプロパティの折り返し）という役割の違いがあるため、
        /// 観測者を先に、補正者を後に評価する。
        ///
        /// この順序が重要な理由: 循環する(自身をラップして戻す)プロパティが一度にrangeの幅を飛び越えた場合、
        /// on_overflow/on_shortfallの折り返しは境界ちょうどには着地しないことが多い（例: 0-100を循環する
        /// プロパティが150まで加算された場合、on_overflowの折り返しは50に着地し、100ちょうどにはならない）。
        /// もしon_max/on_minを補正の後に判定すると、値は既にrange内へ戻ってしまっており、「この瞬間確かに
        /// 境界へ到達していた」という事実そのものを見逃してしまう。観測者を先に評価することで、折り返しの
        /// 有無や着地点によらず、on_max/on_minは境界へ到達した瞬間を必ず捉える。
        ///
        /// on_overflow/on_shortfallの適用自体がowner側のAdd/SetNumberを通るため、その場で本メソッドが
        /// 再度呼ばれ、1回のTick()・AddNumber呼び出しの中で複数span分の溢れ・繰り上げ先自身のさらなる
        /// 溢れ（分→時→日の連鎖）が宣言順に関わらず連鎖的に解決される。
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
        /// 現在値が該当する段階を返す。eq指定の段階（完全一致）が優先され、次にmin指定の段階（半開区間、
        /// 最も高いminを採用）、どちらにも該当しなければfallbackStage（他のどの段階にも該当しない場合の
        /// フォールバック、6.4節）を返す。min:null（eq未指定時）の段階はリスト中の位置に依存しない
        /// （11.2節のサンプルでは broken(min:null) が intact(min:1) より後に書かれている）。
        ///
        /// eq指定の段階は「一致するかしないか」の二択であり、min指定の段階のような「より良い一致」
        /// （より高いminを持つ段）という概念が無いため、一致した時点で他の段を見ずに返してよい
        /// （min側は全段を見て最も高いminを採用する必要があるため、こちらは最後まで走査する）。
        ///
        /// シンボル型プロパティ（Loader.WorldCodexYamlLoader.ParseStageが常にeqをnameから自動導出するため、
        /// フォールバックの段を作る手段が無い）には、そもそもフォールバックという概念自体が存在しない。
        /// 数値型プロパティも著者がフォールバック段階（min省略）を書かなければ同様にnullを返し得る。
        /// 理由は異なるが、いずれにせよResolveStageの戻り値はnullになり得るものとして扱い、呼び出し側
        /// （IsInStage等）が常にnullチェックする前提とする。
        /// </summary>
        public PropertyStage ResolveStage(int currentValue)
        {
            PropertyStage best = null;

            foreach (var stage in Stages)
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
    }
}
