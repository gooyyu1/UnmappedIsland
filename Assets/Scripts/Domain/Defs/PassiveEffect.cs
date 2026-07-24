using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain.Defs
{
    /// <summary>
    /// 効果の発動条件。判別子は持たず、各フィールドの有無が「何をチェックすべきか」を表す
    /// （StageName非null→WhenOwnStage判定、Conditions非null→conditions判定、両方非null=AND、両方null=常時有効）。
    ///
    /// 参照はグローバルIDのまま持ち、評価のたびにローカル化する（変換コストは1 tick=15分の時間スケールに
    /// 対して無視できるため、ビルド時の2段階パースを避ける）。
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
    /// 1つの ObjectDef が宣言する、1つの持続効果（8節）。ObjectDef.Passives の要素。
    ///
    /// modify（条件が真の間だけ実効値へ寄与＝可逆）とaccumulate（条件が真の間tick毎に実体値へ加減算＝不可逆）は
    /// 別クラスで表し、判別enumは持たない。唯一の差は「PropertyValueのどちらのincomingへ登録されるか」で、
    /// RegisterIntoの実装で表現する。
    ///
    /// 登録先の解決と登録/解除はtargetの種別に応じて自分で行い、呼び出し側（WorldObject）はライフサイクルの
    /// 契機で登録/解除を依頼するだけで、どのtargetがどこへ紐付くかは知らない。
    ///
    /// アクション/combination/pickの一時的な `add`（実行の瞬間に1回だけ効く）は、持続するゲート判定が不要な
    /// ため、この登録の仕組みには乗らない。
    /// </summary>
    public abstract class PassiveEffect
    {
        private readonly ReferenceRoot target;
        private readonly int targetPropertyGlobalId;
        private readonly int amount;
        private readonly PassiveEffectGate gate;

        protected PassiveEffect(
            ReferenceRoot target,
            int targetPropertyGlobalId,
            int amount,
            PassiveEffectGate gate)
        {
            this.target = target;
            this.targetPropertyGlobalId = targetPropertyGlobalId;
            this.amount = amount;
            this.gate = gate;
        }

        /// <summary>この効果（registration）を、対象プロパティ値（target）のmodify用/accumulate用incomingの
        /// うち具象クラスに応じた側へ登録する。</summary>
        public abstract void RegisterInto(PropertyValue target, RegisteredPassiveEffect registration);

        /// <summary>declarer/slotBearerの現在の文脈でゲート（8.2節）が有効ならAmountを、無効なら0を返す。
        /// modifyでもaccumulateでも同じ量。</summary>
        public int ActiveAmount(WorldObject declarer, WorldObject slotBearer) =>
            gate.IsSatisfied(declarer, slotBearer) ? amount : 0;

        /// <summary>
        /// 相手（related）がownerから直接辿れる関係（Self/Parent/Ancestor）の登録/解除。相手はowner自身から
        /// 解決するため、呼び出し側がrelationとrelatedに矛盾した組を渡す余地が無い。
        ///
        /// Ancestorは、ツリー構造が変わる前に解除・変わった後に登録という順序を呼び出し側
        /// （WorldObject.RegisterAncestorTargetedRecursively）が守る前提で、「今この瞬間の祖先」を毎回辿るだけで
        /// よく、前回の登録先を憶えない。
        ///
        /// Childは相手（どの子か）がownerから一意に辿れないため、ここでは扱わずRegisterChildを使う。
        /// </summary>
        public void RegisterRelation(WorldObject owner, ReferenceRoot relation, bool register)
        {
            WorldObject related =
                relation == ReferenceRoot.Self ? owner :
                relation == ReferenceRoot.Parent ? owner.Parent :
                relation == ReferenceRoot.Ancestor ? owner.FindAncestorWithProperty(targetPropertyGlobalId) :
                null;
            RegisterRelation(owner, relation, related, register);
        }

        /// <summary>
        /// childがparentに付く/離れる際に、parent（owner）側のtarget=Child効果を、その付いた/離れた子(child)へ
        /// 登録/解除する。Childは相手がownerから一意に辿れない唯一の関係のため、childを明示的に受け取る。
        /// </summary>
        public void RegisterChild(WorldObject owner, WorldObject child, bool register) =>
            RegisterRelation(owner, ReferenceRoot.Child, child, register);

        /// <summary>
        /// 内部共通処理: この効果の対象がrelationと一致するときだけrelatedの対象プロパティへ登録/解除する。
        /// gateのself（＝slotBearer）はエッジの子側（Child対象なら子=related、それ以外はowner）。
        /// relationとrelatedに矛盾した組を外部から渡せないよう非公開。
        /// </summary>
        private void RegisterRelation(WorldObject owner, ReferenceRoot relation, WorldObject related, bool register)
        {
            if (target != relation) return;
            WorldObject slotBearer = relation == ReferenceRoot.Child ? related : owner;
            if (register) Register(related, declarer: owner, slotBearer: slotBearer);
            else Unregister(related, declarer: owner);
        }

        /// <summary>この効果を、targetOwnerの対象プロパティへ1件登録する（そのプロパティを持たなければ
        /// 何もしない）。</summary>
        private void Register(WorldObject targetOwner, WorldObject declarer, WorldObject slotBearer)
        {
            if (targetOwner == null) return;
            targetOwner.RegisterPassiveEffect(
                targetPropertyGlobalId, new RegisteredPassiveEffect(declarer, slotBearer, this));
        }

        /// <summary>targetOwnerの対象プロパティから、declarerが宣言した登録を解除する。</summary>
        private void Unregister(WorldObject targetOwner, WorldObject declarer)
        {
            if (targetOwner == null) return;
            targetOwner.UnregisterPassiveEffectsFrom(declarer, targetPropertyGlobalId);
        }
    }

    /// <summary>
    /// 条件が真の間だけ、都度導出される実効値に寄与する持続効果（可逆、8.3節）。実体値そのものは
    /// 書き換えない。PropertyValueのmodify用incomingへ登録され、WorldObject.GetEffectiveValueが走査する。
    /// </summary>
    public sealed class ModifyEffect : PassiveEffect
    {
        public ModifyEffect(ReferenceRoot target, int targetPropertyGlobalId, int amount, PassiveEffectGate gate)
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
        public AccumulateEffect(ReferenceRoot target, int targetPropertyGlobalId, int amount, PassiveEffectGate gate)
            : base(target, targetPropertyGlobalId, amount, gate) { }

        public override void RegisterInto(PropertyValue target, RegisteredPassiveEffect registration) =>
            target.RegisterAccumulate(registration);
    }
}
