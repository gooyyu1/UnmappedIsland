namespace UnmappedIsland.Codex
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
    /// 効果の性質。どちらも self/parent/child・ゲートによる登録の仕組み（8節）を共有するが、
    /// 実体値への反映のされ方が異なる。
    ///
    /// - Modify: 条件が真の間だけ、都度導出される実効値に寄与する（可逆、WorldObject.GetEffectiveValue）
    /// - Accumulate: 条件が真の間、tick毎に実体値そのものへ加減算し続ける（不可逆、WorldObject.Tick）
    ///
    /// アクション/combination/pickの効果として書かれる一時的な `add`（実行された瞬間に1回だけ効く）は、
    /// この登録の仕組みには乗らないため、ここには含まれない（持続する条件のゲート判定が不要なため）。
    /// </summary>
    public enum PassiveEffectKind
    {
        Modify,
        Accumulate,
    }

    /// <summary>
    /// 効果の発動条件。種別を表す判別子は持たず、各フィールドの有無そのものが「何をチェックすべきか」を
    /// 表す（StageNameが非nullならWhenOwnStage判定、Conditionsが非nullならconditions判定。両方非nullなら
    /// 両方を満たす間だけ有効=AND、両方nullなら常時有効。Runtime.RegisteredPassiveEffect.IsActive参照）。
    ///
    /// ConditionsもPropertyGlobalId/StageNameも、ロード時にローカルIDへ変換せずグローバルIDのまま持つ
    /// （評価のたびにDeclarer自身がRuntime.WorldObject.IsInStageでローカル化する）。グローバルID→ローカルID
    /// の変換コストは、1 tick=15分というこのゲームの時間スケールに対して無視できるほど小さいため、
    /// Declarer自身のPropertyDefがすべて出来上がるまで解決を待つビルド時の2段階パースは不要（かつては
    /// PropertyLocalId/PropertyStage参照をビルド時に確定させていたが、この理由により撤去した）。
    /// </summary>
    public sealed class PassiveEffectGate
    {
        public ConditionNode Conditions;
        public int PropertyGlobalId;
        public string StageName;
    }

    /// <summary>
    /// 1つの ObjectDef が宣言する、1つの効果（8節）。ObjectDef.Passives の要素。
    /// Target が Self/Parent/Child のどれであっても、Kind が Modify/Accumulate のどちらであっても構造は同じで、
    /// 違いは登録時にどこへ・誰の状態と紐付けて置くか（Target）と、どちらの評価経路が読むか（Kind）だけに閉じる
    /// （Runtime.WorldObject.GetEffectiveValue / Tick 参照）。
    /// </summary>
    public sealed class PassiveEffect
    {
        public PassiveEffectTarget Target { get; }
        public PassiveEffectKind Kind { get; }
        public int TargetPropertyGlobalId { get; }
        public int Amount { get; }
        public PassiveEffectGate Gate { get; }

        public PassiveEffect(
            PassiveEffectTarget target,
            PassiveEffectKind kind,
            int targetPropertyGlobalId,
            int amount,
            PassiveEffectGate gate)
        {
            Target = target;
            Kind = kind;
            TargetPropertyGlobalId = targetPropertyGlobalId;
            Amount = amount;
            Gate = gate;
        }
    }
}
