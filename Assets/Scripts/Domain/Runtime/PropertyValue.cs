using System;
using System.Collections.Generic;
using UnmappedIsland.Domain.Defs;

namespace UnmappedIsland.Domain.Runtime
{
    /// <summary>
    /// props の実行時の値。数値（32bit整数、6節）のみを扱う。WorldObjectが保持する現在値として使う。
    /// PassiveEffectの影響先は
    /// 「オブジェクト」ではなく「プロパティ」であるため、登録済み効果の一覧・tick毎の反映・実効値の算出は、
    /// いずれもWorldObjectではなくこの値自身が持つ。
    ///
    /// 値の変更（Add/SetNumber）はこのクラス自身が完結して行い、値が変わった直後に、自分のPropertyDefへ
    /// rangeイベントの判定を委譲する（def.CheckRangeEvents）。どのon_*をいつ発火するかという規則はrange・
    /// on_*の定義を持つPropertyDef本人の責務であり、こちらは「値が変わった」とだけ通知する（自分のことは
    /// 自分でする、というOOPの原則。CLAUDE.md参照）。WorldObjectはローカルID解決のみを担い、値の変更に
    /// 伴って何を判定・実行すべきかには一切関与しない。判定の委譲先である自分自身のPropertyDefと、その適用先
    /// となるWorldObjectは、いずれもこのインスタンス自身が保持し（Create時に紐付ける）、呼び出しのたびに
    /// 引数で受け取り直すことはしない。
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

        private PropertyValue(int number, PropertyDef def, WorldObject owner)
        {
            Number = number;
            this.def = def;
            this.owner = owner;
        }

        /// <summary>WorldObject構築時に、1つのプロパティ用の新しいインスタンスを作る（Incomingは空で始まる）。
        /// defは、このプロパティが実際に属することになるPropertyDef（range・on_overflow等）、ownerはそれを
        /// 保持するWorldObjectを紐付ける。</summary>
        internal static PropertyValue Create(int number, PropertyDef def, WorldObject owner) => new PropertyValue(number, def, owner);

        /// <summary>SetProperty用。登録済みのIncomingはそのまま、値の中身だけを差し替える。</summary>
        internal void CopyValueFrom(int number)
        {
            Number = number;
        }

        /// <summary>
        /// 数値を加減算し（不可逆）、値が変わった直後にon_overflow・on_shortfall・on_min・on_max
        /// （6.3節・6.5節・6.6節）の判定を自分のPropertyDefへ委譲する（def.CheckRangeEvents参照）。委譲先の
        /// PropertyDefと、その適用先のWorldObjectはいずれも自分自身が保持するものを使うため、呼び出し側
        /// （WorldObject）から渡してもらう必要はない。
        ///
        /// sessionがnullの場合は判定を行わない（呼び出し側が明示的に後でTick()を呼んで判定させたい場合の
        /// 後方互換。WorldObject.AddNumber参照）。
        ///
        /// deltaが0の場合は何もしない。これは、on_overflow等の既定の補正（値をrangeの境界へsetする）が
        /// ちょうど境界に着地した後にも自分自身を再度setし直すことで、Add→def.CheckRangeEvents→
        /// ApplyActiveEffect→SetNumber→Addという呼び出しが無限に連鎖するのを防ぐガードを兼ねる。
        /// </summary>
        internal void Add(int delta, WorldSession session)
        {
            if (delta == 0) return;

            Number += delta;
            if (session != null)
                def.CheckRangeEvents(Number, owner, session);
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
        /// conditions（14節）はこの実効値を読む（ConditionNode.Evaluate参照）ため、他のmodifyのゲート判定・
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
        /// タイミングで、on_overflow・on_shortfall・on_min・on_max（6.3節・6.5節・6.6節）の判定を自分の
        /// PropertyDefへ委譲する（def.CheckRangeEvents参照）。ゲームループから1tickにつき1回、WorldObject.Tick
        /// 経由で全プロパティに対して呼ばれる想定。
        /// </summary>
        internal void Tick(WorldSession session)
        {
            foreach (var c in incoming)
            {
                if (c.Def.Kind != PassiveEffectKind.Accumulate) continue;
                if (!c.IsActive()) continue;
                Number += c.Def.Amount;
            }

            def.CheckRangeEvents(Number, owner, session);
        }

        /// <summary>
        /// 今まさに指定した名前のstage（6.4節）に該当しているか（WhenOwnStageゲート専用、8節）。実効値
        /// （GetEffectiveValue）を見る。conditions（14節）と同じ理由で、modifyだけで決まる派生プロパティ
        /// （例: weather/hourから決まるsunlight）自身のstagesも判定できる（生の値だけを読むと、そのプロパティ
        /// 自身に一切accumulate/set/addが無い場合、常に初期値のまま判定されてしまう）。循環参照の検出は
        /// GetEffectiveValue自身が行う。
        /// </summary>
        internal bool IsInStage(string stageName)
        {
            PropertyStage stage = def.ResolveStage(GetEffectiveValue());
            return stage != null && stage.Name == stageName;
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
