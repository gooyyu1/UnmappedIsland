using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain.Defs
{
    /// <summary>
    /// 効果の対象（8.1節の self/parent/child）。値そのものは登録時にしか使わず、
    /// 読み取り側（WorldObject.GetEffectiveValue/Tick）はこの区別を一切見ない。
    /// </summary>
    public enum PassiveEffectTarget
    {
        Self,
        Parent,
        Child,

        /// <summary>Declarer自身の直接の親から遡り、このプロパティを定義している最初の祖先（Runtime.
        /// WorldObject.FindAncestorWithProperty参照）。祖先が見つからない場合、この効果は登録されない。</summary>
        Ancestor,
    }

    /// <summary>
    /// 効果の発動条件。種別を表す判別子は持たず、各フィールドの有無そのものが「何をチェックすべきか」を
    /// 表す（StageNameが非nullならWhenOwnStage判定、Conditionsが非nullならconditions判定。両方非nullなら
    /// 両方を満たす間だけ有効=AND、両方nullなら常時有効。PassiveEffect.ActiveAmountから呼ばれる）。
    ///
    /// ConditionsもPropertyGlobalId/StageNameも、ロード時にローカルIDへ変換せずグローバルIDのまま持つ
    /// （評価のたびにDeclarer自身がRuntime.WorldObject.IsInStageでローカル化する）。グローバルID→ローカルID
    /// の変換コストは、1 tick=15分というこのゲームの時間スケールに対して無視できるほど小さいため、
    /// Declarer自身のPropertyDefがすべて出来上がるまで解決を待つビルド時の2段階パースは不要（かつては
    /// PropertyLocalId/PropertyStage参照をビルド時に確定させていたが、この理由により撤去した）。
    /// </summary>
    public sealed class PassiveEffectGate
    {
        private readonly ConditionNode conditions;
        private readonly int? propertyGlobalId;
        private readonly string stageName;

        public PassiveEffectGate(ConditionNode conditions, int? propertyGlobalId = null, string stageName = null)
        {
            this.conditions = conditions;
            this.propertyGlobalId = propertyGlobalId;
            this.stageName = stageName;
        }

        public bool IsSatisfied(WorldObject declarer, WorldObject slotBearer)
        {
            if (stageName != null)
            {
                if (!propertyGlobalId.HasValue || !declarer.IsInStage(propertyGlobalId.Value, stageName))
                    return false;
            }

            if (conditions != null && !conditions.Evaluate(root => Resolve(root, slotBearer)))
                return false;

            return true;
        }

        private static WorldObject Resolve(ReferenceRoot root, WorldObject slotBearer)
        {
            switch (root)
            {
                case ReferenceRoot.Self: return slotBearer;
                case ReferenceRoot.Parent: return slotBearer.Parent;
                default: return null;
            }
        }
    }

    /// <summary>
    /// 1つの ObjectDef が宣言する、1つの持続効果（8節）。ObjectDef.Passives の要素。共通するのは
    /// 「どのオブジェクトのどのプロパティへ紐付くか（Target/TargetPropertyGlobalId）」と「ゲートが有効な間だけ
    /// いくら効くか（ActiveAmount）」。
    ///
    /// modify（条件が真の間だけ都度導出される実効値へ寄与＝可逆）とaccumulate（条件が真の間tick毎に実体値へ
    /// 加減算＝不可逆）は、消費のされ方が本質的に異なる別物である。set/addがPropertyAssignment/PropertyDeltaに
    /// 分かれているのと同じく、ModifyEffect/AccumulateEffectという別クラスで表す（判別enumは持たない）。両者の
    /// 唯一の差は「自分がPropertyValueのどちらのincomingへ登録されるか」で、それをRegisterIntoの実装で表現する。
    ///
    /// Amount・Gate は「今いくら効いているか」というこの効果自身の内部事情であり、ActiveAmountを通してのみ
    /// 外へ出す（PropertyValueは量もゲートも意識しない、自分のことは自分でする、CLAUDE.md参照）。Targetと
    /// TargetPropertyGlobalIdは登録先を決めるWorldObject側が読むため公開する。
    ///
    /// アクション/combination/pickの効果として書かれる一時的な `add`（実行された瞬間に1回だけ効く）は、
    /// この登録の仕組みには乗らないため、ここには含まれない（持続する条件のゲート判定が不要なため）。
    /// </summary>
    public abstract class PassiveEffect
    {
        public PassiveEffectTarget Target { get; }
        public int TargetPropertyGlobalId { get; }

        private readonly int amount;
        private readonly PassiveEffectGate gate;

        protected PassiveEffect(
            PassiveEffectTarget target,
            int targetPropertyGlobalId,
            int amount,
            PassiveEffectGate gate)
        {
            Target = target;
            TargetPropertyGlobalId = targetPropertyGlobalId;
            this.amount = amount;
            this.gate = gate;
        }

        /// <summary>この効果（registration）を、対象プロパティ値（target）の適切なincomingへ登録する。
        /// modify用かaccumulate用かは具象クラスが決める（判別子は型そのもの）。</summary>
        public abstract void RegisterInto(PropertyValue target, RegisteredPassiveEffect registration);

        /// <summary>declarer/slotBearerの現在の文脈でゲート（8.2節）が有効ならAmountを、無効なら0を返す。
        /// 「今この効果はいくら効いているか」をAmountとゲート判定込みで自分で答えるため、Amount/Gateを外へ
        /// 出す必要がない。modify（実効値へ合算）でもaccumulate（tick時に実体値へ加算）でも同じ量。</summary>
        public int ActiveAmount(WorldObject declarer, WorldObject slotBearer) =>
            gate.IsSatisfied(declarer, slotBearer) ? amount : 0;
    }

    /// <summary>
    /// 条件が真の間だけ、都度導出される実効値に寄与する持続効果（可逆、8.3節）。実体値そのものは
    /// 書き換えない。PropertyValueのmodify用incomingへ登録され、WorldObject.GetEffectiveValueが走査する。
    /// </summary>
    public sealed class ModifyEffect : PassiveEffect
    {
        public ModifyEffect(PassiveEffectTarget target, int targetPropertyGlobalId, int amount, PassiveEffectGate gate)
            : base(target, targetPropertyGlobalId, amount, gate) { }

        public override void RegisterInto(PropertyValue target, RegisteredPassiveEffect registration) =>
            target.RegisterModify(registration);
    }

    /// <summary>
    /// 条件が真の間、tick毎に実体値そのものへ加減算し続ける持続効果（不可逆、8.4節）。PropertyValueの
    /// accumulate用incomingへ登録され、WorldObject.Tickが走査する。
    /// </summary>
    public sealed class AccumulateEffect : PassiveEffect
    {
        public AccumulateEffect(PassiveEffectTarget target, int targetPropertyGlobalId, int amount, PassiveEffectGate gate)
            : base(target, targetPropertyGlobalId, amount, gate) { }

        public override void RegisterInto(PropertyValue target, RegisteredPassiveEffect registration) =>
            target.RegisterAccumulate(registration);
    }
}
