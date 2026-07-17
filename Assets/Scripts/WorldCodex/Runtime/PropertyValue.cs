namespace UnmappedIsland.Codex.Runtime
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
    /// props の実行時の値。PropertyDef.DefaultValue（ロード時の初期値）にも、WorldObjectが保持する
    /// 現在値にも使う、いずれも「ある時点でのプロパティの値」という同じ実行時概念。
    /// </summary>
    public readonly struct PropertyValue
    {
        public readonly PropertyValueKind Kind;
        public readonly int Number;
        public readonly int Symbol;

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

        /// <summary>数値へ delta を加減算した新しい値を返す（加減算はNumber専用、不変オブジェクトのため新規生成）。</summary>
        public PropertyValue Add(int delta) => FromNumber(Number + delta);

        public override string ToString() => Kind == PropertyValueKind.Number ? Number.ToString() : $"symbol:{Symbol}";
    }
}
