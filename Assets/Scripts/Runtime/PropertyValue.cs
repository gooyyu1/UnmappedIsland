using System.Collections.Generic;
using UnmappedIsland.Codex;

namespace UnmappedIsland.Runtime
{
    /// <summary>
    /// props の値の種別。数値（重量・耐久値など、6.1〜6.3節）と、"clear"/"bright" のような
    /// 列挙的な文字列値（9節の weather、light_stage 等）の両方を同じ配列に格納できるようにするための
    /// タグ付きunion。文字列値はそのままでは配列に敷き詰めにくいため、プロパティ名とは別の
    /// シンボル用 NameRegistry を介して int 化したものを保持する。
    /// </summary>
    public enum PropertyValueKind : byte
    {
        Number,
        Symbol,
    }

    /// <summary>
    /// props の実行時の値。PropertyDef.DefaultValue（ロード時の初期値テンプレート）にも、
    /// WorldObjectが保持する現在値にも使う。Contributionの影響先は「オブジェクト」ではなく
    /// 「プロパティ」であるため、登録済み効果の一覧・tick毎の反映・実効値の算出は、いずれも
    /// WorldObjectではなくこの値自身が持つ。
    ///
    /// PropertyDef.DefaultValue は全 WorldObject で共有される1つのテンプレートなので、
    /// WorldObject 構築時は必ず Clone() で複製したものを使う（直接共有すると、ある WorldObject への
    /// 加減算・効果登録が他の WorldObject にも及んでしまう）。
    /// </summary>
    public sealed class PropertyValue
    {
        public PropertyValueKind Kind { get; private set; }
        public int Number { get; private set; }
        public int Symbol { get; private set; }

        private readonly List<ActiveContribution> incoming = new List<ActiveContribution>();

        private PropertyValue(PropertyValueKind kind, int number, int symbol)
        {
            Kind = kind;
            Number = number;
            Symbol = symbol;
        }

        public static PropertyValue FromNumber(int value) => new PropertyValue(PropertyValueKind.Number, value, 0);

        /// <summary>symbolGlobalId はシンボル専用 NameRegistry（"clear"/"rain"等の語彙）上のグローバルID。</summary>
        public static PropertyValue FromSymbol(int symbolGlobalId) => new PropertyValue(PropertyValueKind.Symbol, 0, symbolGlobalId);

        /// <summary>数値として読む。Symbol値であれば fallback を返す（呼び出し側でKindを判定させない）。</summary>
        public int AsNumber(int fallback = 0) => Kind == PropertyValueKind.Number ? Number : fallback;

        /// <summary>このテンプレートから、1つの WorldObject 専用の新しいインスタンスを作る（Incomingは空で始まる）。</summary>
        internal PropertyValue Clone() => new PropertyValue(Kind, Number, Symbol);

        /// <summary>SetProperty用。登録済みのIncomingはそのまま、値の中身だけを差し替える。</summary>
        internal void CopyValueFrom(PropertyValue other)
        {
            Kind = other.Kind;
            Number = other.Number;
            Symbol = other.Symbol;
        }

        internal void Add(int delta) => Number += delta;

        /// <summary>set（絶対値代入）。Kindを強制的にNumberへ切り替える。</summary>
        internal void SetNumber(int value)
        {
            Kind = PropertyValueKind.Number;
            Number = value;
        }

        internal void RegisterContribution(ActiveContribution contribution) => incoming.Add(contribution);

        internal void UnregisterContributionsFrom(WorldObject declarer) => incoming.RemoveAll(c => c.Declarer == declarer);

        /// <summary>現在登録されている全寄与（modify/accumulate両方）。UIで「何が影響しているか」を表示する用途。</summary>
        internal IReadOnlyList<ActiveContribution> Incoming => incoming;

        /// <summary>
        /// modify（Kind.Modify）のみを加味した実効値（8.3節）。可逆な寄与であり、実体値そのものは書き換えない。
        /// </summary>
        internal int GetEffectiveValue(PropertyRange? range)
        {
            int sum = AsNumber();

            foreach (var c in incoming)
                if (c.Def.Kind == ContributionKind.Modify && c.IsActive())
                    sum += c.Def.Amount;

            return range.HasValue ? range.Value.Clamp(sum) : sum;
        }

        /// <summary>
        /// accumulate（Kind.Accumulate）を実体値へ加減算し（8.4節、不可逆）、その結果自分の値が変わった
        /// タイミングで、on_overflow・on_shortfall・on_min（6.3節・6.5節）を自分自身で判定・実行する
        /// （CheckRangeEvents参照）。ゲームループから1tickにつき1回、WorldObject.Tick経由で
        /// 全プロパティに対して呼ばれる想定。
        /// </summary>
        internal void Tick(PropertyDef def, WorldObject owner, WorldSession session)
        {
            foreach (var c in incoming)
            {
                if (c.Def.Kind != ContributionKind.Accumulate) continue;
                if (!c.IsActive()) continue;
                Number += c.Def.Amount;
            }

            CheckRangeEvents(def, owner, session);
        }

        /// <summary>
        /// 自分の値が変わった直後に呼ぶ、on_overflow・on_shortfall・on_minの自己判定。いずれもWorldObject.
        /// ApplyActiveEffect（actions/combinationsと全く同じ適用経路）をそのまま呼ぶだけで、専用の適用
        /// ロジックは一切持たない。
        ///
        /// 判定順はon_overflow→on_shortfall→on_min。on_overflow/on_shortfallでrangeの境界へ値を戻して
        /// から、その戻した後の値でon_minの「下限以下か」を判定するため、この順序が必要（例えば
        /// on_shortfallが自分をRange.Minへ戻した場合、続くon_minの判定はその戻り値に対して行われる）。
        ///
        /// on_overflow/on_shortfallは、rangeの外側にはみ出していれば、著者が指定した内容（未指定なら
        /// ビルド時に合成された既定のset、ObjectDefBuilder.BuildOverflowSideEffect参照）を1回だけ適用する。
        /// ループはしないため、1tickで複数span分はみ出した場合や、繰り上げ先自身がさらにはみ出す場合
        /// （分→時→日の連鎖）は、このプロパティ・繰り上げ先プロパティが宣言順に「後で」Tickされる限り
        /// 同じtick内で連鎖するが、そうでなければ次tick以降に持ち越される（accumulateの通常の反映と
        /// 同じく、宣言順どおりに1回ずつ処理が進む）。
        ///
        /// on_minは、値がrangeの下限以下である間、毎tick著者が指定した内容を実行する（destroyのような
        /// 「底を突いた」判定に使う）。on_overflow/on_shortfallとは異なり既定の自動生成は行われない
        /// （nullなら何もしない）。
        /// </summary>
        internal void CheckRangeEvents(PropertyDef def, WorldObject owner, WorldSession session)
        {
            if (def.OnOverflow != null && def.Range.HasValue && AsNumber() > def.Range.Value.Max)
                owner.ApplyActiveEffect(def.OnOverflow, session, actor: null, dragged: null);

            if (def.OnShortfall != null && def.Range.HasValue && AsNumber() < def.Range.Value.Min)
                owner.ApplyActiveEffect(def.OnShortfall, session, actor: null, dragged: null);

            if (def.OnMin != null && def.Range.HasValue && AsNumber() <= def.Range.Value.Min)
                owner.ApplyActiveEffect(def.OnMin, session, actor: null, dragged: null);
        }

        public override string ToString() => Kind == PropertyValueKind.Number ? Number.ToString() : $"symbol:{Symbol}";
    }
}
