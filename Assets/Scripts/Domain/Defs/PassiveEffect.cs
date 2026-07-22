using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain.Defs
{
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
    /// 「どのオブジェクトのどのプロパティへ紐付くか（target/targetPropertyGlobalId）」と「ゲートが有効な間だけ
    /// いくら効くか（ActiveAmount）」。
    ///
    /// modify（条件が真の間だけ都度導出される実効値へ寄与＝可逆）とaccumulate（条件が真の間tick毎に実体値へ
    /// 加減算＝不可逆）は、消費のされ方が本質的に異なる別物である。set/addがSetEffect/AddEffectに
    /// 分かれているのと同じく、ModifyEffect/AccumulateEffectという別クラスで表す（判別enumは持たない）。両者の
    /// 唯一の差は「自分がPropertyValueのどちらのincomingへ登録されるか」で、それをRegisterIntoの実装で表現する。
    ///
    /// 「どこへ紐付くか」（target/targetPropertyGlobalId）も「今いくら効いているか」（amount/gate）も、この効果
    /// 自身の内部事情である。登録先の解決と登録/解除は、targetの種別に応じて自分で行う（RegisterRelation、
    /// 自分のことは自分でする、CLAUDE.md参照）。呼び出し側（WorldObject）は生成・エッジ形成/解消・トポロジ変化と
    /// いったライフサイクルの契機で「登録してほしい/解除してほしい」と依頼するだけで、どのtargetがどこへ
    /// 紐付くかは一切知らない。target=Ancestorも、ツリー構造が変わる前に解除・変わった後に登録するという順序を
    /// 呼び出し側が守るため、「今この瞬間の祖先」を毎回ownerから辿るだけでよく、前回の登録先を憶える必要はない。
    ///
    /// アクション/combination/pickの効果として書かれる一時的な `add`（実行された瞬間に1回だけ効く）は、
    /// この登録の仕組みには乗らないため、ここには含まれない（持続する条件のゲート判定が不要なため）。
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

        /// <summary>この効果（registration）を、対象プロパティ値（target）の適切なincomingへ登録する。
        /// modify用かaccumulate用かは具象クラスが決める（判別子は型そのもの）。</summary>
        public abstract void RegisterInto(PropertyValue target, RegisteredPassiveEffect registration);

        /// <summary>declarer/slotBearerの現在の文脈でゲート（8.2節）が有効ならAmountを、無効なら0を返す。
        /// 「今この効果はいくら効いているか」をAmountとゲート判定込みで自分で答えるため、Amount/Gateを外へ
        /// 出す必要がない。modify（実効値へ合算）でもaccumulate（tick時に実体値へ加算）でも同じ量。</summary>
        public int ActiveAmount(WorldObject declarer, WorldObject slotBearer) =>
            gate.IsSatisfied(declarer, slotBearer) ? amount : 0;

        /// <summary>
        /// 相手（related）がownerから直接辿れる関係（Self/Parent/Ancestor）の登録/解除。相手をowner自身から
        /// 解決してから内部の共通処理へ委譲するので、呼び出し側はrelatedを渡さなくてよい（relationとrelatedに
        /// 矛盾した組を渡す余地が無く、常に整合する）。Self→owner自身、Parent→owner.Parent、
        /// Ancestor→対象プロパティを持つ最初の祖先。
        ///
        /// Ancestorも「今この瞬間の祖先」はownerから辿れるためここで扱える。登録/解除は必ず、ツリー構造が
        /// 変わる前（＝解除、旧祖先が辿れるうち）と変わった後（＝登録、新祖先が辿れる）に分けて呼ばれるため、
        /// 「前回どこへ登録したか」を憶えておく必要がない（呼び出し側WorldObject.RegisterAncestorTargetedRecursively）。
        ///
        /// Childは相手（どの子か）がownerから一意に辿れない（親は複数の子を持ち、契機はその1人が付いた/離れた
        /// こと）ため、ここでは扱わない。専用のRegisterChildを使う。
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
        /// 登録/解除する。Childは相手（どの子か）がownerから一意に辿れない唯一の関係のため、相手childを明示的に
        /// 受け取る専用の入口を設ける（Self/Parent/AncestorはRegisterRelationのowner版でrelatedを渡さない）。
        /// </summary>
        public void RegisterChild(WorldObject owner, WorldObject child, bool register) =>
            RegisterRelation(owner, ReferenceRoot.Child, child, register);

        /// <summary>
        /// 内部共通処理: 相手(related)を確定させたうえで、この効果の対象がrelationと一致するときだけrelatedの
        /// 対象プロパティへ登録／解除する（一致しなければ無関係な契機なので何もしない）。登録先＝related、
        /// declarer＝owner（効果の宣言者）、gateのself（＝slotBearer）＝エッジの子側（Child対象なら子=related、
        /// それ以外はowner）。
        ///
        /// relationとrelatedに矛盾した組を外部から渡せないよう非公開にし、相手を確定させる責務を持つowner版
        /// （Self/Parent/Ancestor）とRegisterChild（Child）だけがここへ委譲する。
        /// </summary>
        private void RegisterRelation(WorldObject owner, ReferenceRoot relation, WorldObject related, bool register)
        {
            if (target != relation) return;
            WorldObject slotBearer = relation == ReferenceRoot.Child ? related : owner;
            if (register) Register(related, declarer: owner, slotBearer: slotBearer);
            else Unregister(related, declarer: owner);
        }

        /// <summary>この効果を、targetOwnerの対象プロパティへ1件登録する（targetOwnerがそのプロパティを
        /// 持たなければ何もしない。判定はWorldObject.RegisterPassiveEffectに閉じる）。</summary>
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
