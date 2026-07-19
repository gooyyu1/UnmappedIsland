using System;
using System.Collections.Generic;
using UnmappedIsland.Codex;

namespace UnmappedIsland.Runtime
{
    /// <summary>
    /// props の実行時の値。数値（32bit整数、6節）のみを扱う。WorldObjectが保持する現在値、および
    /// FromNumberで作る単発の値（テスト等でのSetProperty用）の両方に使う。PassiveEffectの影響先は
    /// 「オブジェクト」ではなく「プロパティ」であるため、登録済み効果の一覧・tick毎の反映・実効値の算出は、
    /// いずれもWorldObjectではなくこの値自身が持つ。
    ///
    /// 値の変更（Add/SetNumber）とrangeイベントの判定（CheckRangeEvents）はこのクラス自身が完結して行う。
    /// WorldObjectはローカルID解決のみを担い、値の変更に伴って何を判定・実行すべきかには一切関与しない
    /// （自分のことは自分でする、というOOPの原則。CLAUDE.md参照）。判定・実行に必要な自分自身のPropertyDef
    /// （range・on_overflow等）と、それを保持するWorldObject（on_overflow等の適用先解決に使う）は、
    /// いずれもこのインスタンス自身が保持し（Create時に紐付ける）、呼び出しのたびに引数で受け取り直す
    /// ことはしない。
    /// </summary>
    public sealed class PropertyValue
    {
        public int Number { get; private set; }

        /// <summary>インスタンス化された時点（Create）で確定し、以後変わらない関係のため readonly で強制する。</summary>
        private readonly PropertyDef def;
        private readonly WorldObject owner;

        private readonly List<RegisteredPassiveEffect> incoming = new List<RegisteredPassiveEffect>();

        /// <summary>GetEffectiveValue計算中かどうか（再入検出用）。conditions（14節）がGetEffectiveValueを
        /// 読むようになったことで、あるプロパティのmodifyのゲートが（直接・間接を問わず）自分自身の実効値に
        /// 依存してしまう循環参照が起こりうる。生の値と異なり実効値は計算結果そのものに依存しうるため、
        /// この保証は自動では成立しない。放置するとStackOverflowException（catch不能、プロセスごと落ちる）
        /// になるため、再入を検出した時点でGetEffectiveValue自身が分かりやすい例外を投げる。</summary>
        private bool isComputingEffectiveValue;

        private PropertyValue(int number)
        {
            Number = number;
        }

        private PropertyValue(int number, PropertyDef def, WorldObject owner)
        {
            Number = number;
            this.def = def;
            this.owner = owner;
        }

        public static PropertyValue FromNumber(int value) => new PropertyValue(value);

        public int AsNumber() => Number;

        /// <summary>WorldObject構築時に、1つのプロパティ用の新しいインスタンスを作る（Incomingは空で始まる）。
        /// defは、このプロパティが実際に属することになるPropertyDef（range・on_overflow等）、ownerはそれを
        /// 保持するWorldObjectを紐付ける。</summary>
        internal static PropertyValue Create(int number, PropertyDef def, WorldObject owner) => new PropertyValue(number, def, owner);

        /// <summary>SetProperty用。登録済みのIncomingはそのまま、値の中身だけを差し替える。</summary>
        internal void CopyValueFrom(PropertyValue other)
        {
            Number = other.Number;
        }

        /// <summary>
        /// 数値を加減算し（不可逆）、値が変わった直後にon_overflow・on_shortfall・on_min・on_max
        /// （6.3節・6.5節・6.6節）を自分自身で判定・実行する（CheckRangeEvents参照）。判定に使うPropertyDef・
        /// 適用先のWorldObjectはいずれも自分自身が保持するものを使うため、呼び出し側（WorldObject）から
        /// 渡してもらう必要はない。
        ///
        /// sessionがnullの場合は判定を行わない（呼び出し側が明示的に後でTick()を呼んで判定させたい場合の
        /// 後方互換。WorldObject.AddNumber参照）。
        ///
        /// deltaが0の場合は何もしない。これは、on_overflow等の既定の補正（値をrangeの境界へsetする）が
        /// ちょうど境界に着地した後にも自分自身を再度setし直すことで、Add→CheckRangeEvents→
        /// ApplyActiveEffect→SetNumber→Addという呼び出しが無限に連鎖するのを防ぐガードを兼ねる。
        /// </summary>
        internal void Add(int delta, WorldSession session)
        {
            if (delta == 0) return;

            Number += delta;
            if (session != null)
                CheckRangeEvents(session);
        }

        /// <summary>絶対値代入（set）。実体はAddへの委譲（差分=value-現在値を加算する）ため、range判定は
        /// Add側に一本化される。</summary>
        internal void SetNumber(int value, WorldSession session)
        {
            Add(value - Number, session);
        }

        internal void RegisterPassiveEffect(RegisteredPassiveEffect effect) => incoming.Add(effect);

        internal void UnregisterPassiveEffectsFrom(WorldObject declarer) => incoming.RemoveAll(c => c.Declarer == declarer);

        /// <summary>現在登録されている全寄与（modify/accumulate両方）。UIで「何が影響しているか」を表示する用途。</summary>
        internal IReadOnlyList<RegisteredPassiveEffect> Incoming => incoming;

        /// <summary>
        /// modify（Kind.Modify）とinherit（自分の直接の親から遡った祖先からの継承）を加味した実効値
        /// （8.3節）。可逆な寄与であり、実体値そのものは書き換えない。
        ///
        /// conditions（14節）はこの実効値を読む（ConditionEvaluator参照）ため、他のmodifyのゲート判定・
        /// inheritの祖先探索から再入する可能性がある。isComputingEffectiveValueで、この呼び出し自身への
        /// 再入（＝循環参照）を検出し、スタックオーバーフローになる前に分かりやすい例外を投げる
        /// （inherit自体は木構造が循環しない前提のため無限再帰にはならないが、他のmodifyのゲート経由の
        /// 循環参照は依然としてこのガードが必要）。
        /// </summary>
        internal int GetEffectiveValue()
        {
            if (isComputingEffectiveValue)
                throw new InvalidOperationException(
                    $"プロパティ'{def?.Name}'の実効値計算中に循環参照を検出しました" +
                    "（modifyのconditionsが、直接・間接を問わず自分自身の実効値に依存しています）。");

            isComputingEffectiveValue = true;
            try
            {
                int sum = Number;

                foreach (var c in incoming)
                    if (c.Def.Kind == PassiveEffectKind.Modify && c.IsActive())
                        sum += c.Def.Amount;

                if (def.Inherit)
                {
                    WorldObject ancestor = owner.FindAncestorWithProperty(def.GlobalId);
                    if (ancestor != null)
                        sum += ancestor.GetEffectiveValue(def.GlobalId);
                }

                return def.Range.HasValue ? def.Range.Value.Clamp(sum) : sum;
            }
            finally
            {
                isComputingEffectiveValue = false;
            }
        }

        /// <summary>
        /// accumulate（Kind.Accumulate）を実体値へ加減算し（8.4節、不可逆）、その結果自分の値が変わった
        /// タイミングで、on_overflow・on_shortfall・on_min・on_max（6.3節・6.5節・6.6節）を自分自身で判定・実行する
        /// （CheckRangeEvents参照）。ゲームループから1tickにつき1回、WorldObject.Tick経由で
        /// 全プロパティに対して呼ばれる想定。
        /// </summary>
        internal void Tick(WorldSession session)
        {
            foreach (var c in incoming)
            {
                if (c.Def.Kind != PassiveEffectKind.Accumulate) continue;
                if (!c.IsActive()) continue;
                Number += c.Def.Amount;
            }

            CheckRangeEvents(session);
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
        /// ビルド時に合成された既定のset、Loader.ObjectDefYamlConverter参照）を適用する。
        /// この適用自体がAdd/SetNumberを通るため、その場でCheckRangeEventsが再評価され、1回のTick()・
        /// AddNumber呼び出しの中で複数span分の溢れ・繰り上げ先自身のさらなる溢れ（分→時→日の連鎖）が
        /// 宣言順に関わらず連鎖的に解決される。
        ///
        /// on_minは、値がrangeの下限以下である間、毎tick著者が指定した内容を実行する（destroyのような
        /// 「底を突いた」判定に使う）。on_maxは、値がrangeの上限以上である間、毎tick著者が指定した内容を実行する
        /// （on_minの上限側の鏡像）。on_overflow/on_shortfallとは異なり既定の自動生成は行われない
        /// （nullなら何もしない）。
        /// </summary>
        internal void CheckRangeEvents(WorldSession session)
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

        /// <summary>
        /// transfer（9.5節）で、このプロパティ自身から実際に出せる量の上限。rangeがあれば、range.Minを
        /// 下回った分は出せないとみなす（on_shortfallの既定クランプにより実運用でNumberがMinを下回ることは
        /// 無いが、念のためMinを下限とする）。rangeが無ければ現在値そのまま。
        /// </summary>
        internal int AvailableToTransferOut() => def.Range.HasValue ? Math.Max(0, Number - def.Range.Value.Min) : Number;

        /// <summary>
        /// transfer（9.5節）でallow_overflow: falseの場合に、このプロパティへ実際に受け取れる量の上限。
        /// rangeが無ければ上限なし。
        /// </summary>
        internal int RemainingTransferCapacity() => def.Range.HasValue ? Math.Max(0, def.Range.Value.Max - Number) : int.MaxValue;

        public override string ToString() => Number.ToString();
    }
}
