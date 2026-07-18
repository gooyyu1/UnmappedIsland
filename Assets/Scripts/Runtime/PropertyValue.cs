using System.Collections.Generic;
using UnmappedIsland.Codex;

namespace UnmappedIsland.Runtime
{
    /// <summary>
    /// props の実行時の値。数値（32bit整数、6節）のみを扱う。PropertyDef.DefaultValue（ロード時の初期値
    /// テンプレート）にも、WorldObjectが保持する現在値にも使う。Contributionの影響先は「オブジェクト」ではなく
    /// 「プロパティ」であるため、登録済み効果の一覧・tick毎の反映・実効値の算出は、いずれも
    /// WorldObjectではなくこの値自身が持つ。
    ///
    /// 値の変更（Add/SetNumber）とrangeイベントの判定（CheckRangeEvents）はこのクラス自身が完結して行う。
    /// WorldObjectはローカルID解決のみを担い、値の変更に伴って何を判定・実行すべきかには一切関与しない
    /// （自分のことは自分でする、というOOPの原則。CLAUDE.md参照）。
    ///
    /// PropertyDef.DefaultValue は全 WorldObject で共有される1つのテンプレートなので、
    /// WorldObject 構築時は必ず Clone() で複製したものを使う（直接共有すると、ある WorldObject への
    /// 加減算・効果登録が他の WorldObject にも及んでしまう）。
    /// </summary>
    public sealed class PropertyValue
    {
        public int Number { get; private set; }

        private readonly List<ActiveContribution> incoming = new List<ActiveContribution>();

        private PropertyValue(int number)
        {
            Number = number;
        }

        public static PropertyValue FromNumber(int value) => new PropertyValue(value);

        public int AsNumber() => Number;

        /// <summary>このテンプレートから、1つの WorldObject 専用の新しいインスタンスを作る（Incomingは空で始まる）。</summary>
        internal PropertyValue Clone() => new PropertyValue(Number);

        /// <summary>SetProperty用。登録済みのIncomingはそのまま、値の中身だけを差し替える。</summary>
        internal void CopyValueFrom(PropertyValue other)
        {
            Number = other.Number;
        }

        /// <summary>
        /// 数値を加減算し（不可逆）、値が変わった直後にon_overflow・on_shortfall・on_min・on_max
        /// （6.3節・6.5節・6.6節）を自分自身で判定・実行する（CheckRangeEvents参照）。判定・適用にどの
        /// PropertyDef/WorldObject/WorldSessionを使うかを、呼び出し側（WorldObject）ではなくこの
        /// メソッド自身が要求することで、「値を変えたら何を判定すべきか」という責務をPropertyValue自身に
        /// 閉じ込める。
        ///
        /// sessionがnullの場合は判定を行わない（呼び出し側が明示的に後でTick()を呼んで判定させたい場合の
        /// 後方互換。WorldObject.AddNumber参照）。
        ///
        /// deltaが0の場合は何もしない。これは、on_overflow等の既定の補正（値をrangeの境界へsetする）が
        /// ちょうど境界に着地した後にも自分自身を再度setし直すことで、Add→CheckRangeEvents→
        /// ApplyActiveEffect→SetNumber→Addという呼び出しが無限に連鎖するのを防ぐガードを兼ねる。
        /// </summary>
        internal void Add(int delta, PropertyDef def, WorldObject owner, WorldSession session)
        {
            if (delta == 0) return;

            Number += delta;
            if (session != null)
                CheckRangeEvents(def, owner, session);
        }

        /// <summary>絶対値代入（set）。実体はAddへの委譲（差分=value-現在値を加算する）ため、range判定は
        /// Add側に一本化される。</summary>
        internal void SetNumber(int value, PropertyDef def, WorldObject owner, WorldSession session)
        {
            Add(value - Number, def, owner, session);
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
            int sum = Number;

            foreach (var c in incoming)
                if (c.Def.Kind == ContributionKind.Modify && c.IsActive())
                    sum += c.Def.Amount;

            return range.HasValue ? range.Value.Clamp(sum) : sum;
        }

        /// <summary>
        /// accumulate（Kind.Accumulate）を実体値へ加減算し（8.4節、不可逆）、その結果自分の値が変わった
        /// タイミングで、on_overflow・on_shortfall・on_min・on_max（6.3節・6.5節・6.6節）を自分自身で判定・実行する
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
        /// 自分の値が変わった直後に呼ぶ、on_max・on_min・on_overflow・on_shortfallの自己判定。いずれも
        /// WorldObject.ApplyActiveEffect（actions/combinationsと全く同じ適用経路）をそのまま呼ぶだけで、
        /// 専用の適用ロジックは一切持たない。Tick()からだけでなく、Add（延いてはWorldObject.AddNumber/
        /// SetNumber経由でsessionを渡したすべての呼び出し）からも直接呼ばれる。
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
        /// on_overflow/on_shortfallは、rangeの外側にはみ出していれば、著者が指定した内容（未指定なら
        /// ビルド時に合成された既定のset、ObjectDefBuilder.BuildOverflowSideEffect参照）を適用する。
        /// この適用自体がAdd/SetNumberを通るため、その場でCheckRangeEventsが再評価され、1回のTick()・
        /// AddNumber呼び出しの中で複数span分の溢れ・繰り上げ先自身のさらなる溢れ（分→時→日の連鎖）が
        /// 宣言順に関わらず連鎖的に解決される。
        ///
        /// on_minは、値がrangeの下限以下である間、毎tick著者が指定した内容を実行する（destroyのような
        /// 「底を突いた」判定に使う）。on_maxは、値がrangeの上限以上である間、毎tick著者が指定した内容を実行する
        /// （on_minの上限側の鏡像）。on_overflow/on_shortfallとは異なり既定の自動生成は行われない
        /// （nullなら何もしない）。
        /// </summary>
        internal void CheckRangeEvents(PropertyDef def, WorldObject owner, WorldSession session)
        {
            if (def.OnMax != null && def.Range.HasValue && Number >= def.Range.Value.Max)
                owner.ApplyActiveEffect(def.OnMax, session, actor: null, dragged: null);

            if (def.OnMin != null && def.Range.HasValue && Number <= def.Range.Value.Min)
                owner.ApplyActiveEffect(def.OnMin, session, actor: null, dragged: null);

            if (def.OnOverflow != null && def.Range.HasValue && Number > def.Range.Value.Max)
                owner.ApplyActiveEffect(def.OnOverflow, session, actor: null, dragged: null);

            if (def.OnShortfall != null && def.Range.HasValue && Number < def.Range.Value.Min)
                owner.ApplyActiveEffect(def.OnShortfall, session, actor: null, dragged: null);
        }

        public override string ToString() => Number.ToString();
    }
}
