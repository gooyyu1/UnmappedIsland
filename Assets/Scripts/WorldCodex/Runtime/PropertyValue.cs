using System.Collections.Generic;
using UnmappedIsland.Codex.Defs;

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
        /// accumulate（Kind.Accumulate）を実体値へ加減算する（8.4節、不可逆）。ゲームループから
        /// 1tickにつき1回、WorldObject.Tick経由で全プロパティに対して呼ばれる想定。
        /// </summary>
        internal void Tick()
        {
            foreach (var c in incoming)
            {
                if (c.Def.Kind != ContributionKind.Accumulate) continue;
                if (!c.IsActive()) continue;
                Number += c.Def.Amount;
            }
        }

        /// <summary>
        /// on_zero（6.5節）の判定。armed（onZero != null）かつ現在値が0以下なら、発火すべき効果を返す。
        /// 実際にdestroy/spawn等を実行するにはWorldObject/Containmentの協力が要るため、ここでは
        /// 「発火すべきか」の判定だけを自分自身の責務として持つ。
        /// </summary>
        internal ActiveEffect PostTick(ActiveEffect onZero) => onZero != null && AsNumber() <= 0 ? onZero : null;

        public override string ToString() => Kind == PropertyValueKind.Number ? Number.ToString() : $"symbol:{Symbol}";
    }
}
