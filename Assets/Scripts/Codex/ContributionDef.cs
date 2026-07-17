namespace UnmappedIsland.Codex
{
    /// <summary>
    /// 効果の対象（8.1節の self/parent/child）。値そのものは登録時にしか使わず、
    /// 読み取り側（WorldObject.GetEffectiveValue/Tick）はこの区別を一切見ない。
    /// </summary>
    public enum ContributionTarget
    {
        Self,
        Parent,
        Child,
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
    public enum ContributionKind
    {
        Modify,
        Accumulate,
    }

    public enum ContributionGateKind
    {
        /// <summary>常時有効（when省略）。</summary>
        Always,

        /// <summary>SlotBearer が特定のスロットに入っている間だけ有効（`when: <スロット名>`）。</summary>
        WhenSlot,

        /// <summary>Declarer 自身の特定プロパティが特定stageにある間だけ有効。</summary>
        WhenOwnStage,
    }

    /// <summary>
    /// 効果の発動条件。Kind に応じて使うフィールドが変わる。
    ///
    /// SlotGlobalId はグローバルIDのまま持つ（WhenSlot は「今の親のスロット構成」に対して都度ローカル化する
    /// 必要がある。効果を宣言した側のObjectDefは、将来どんな親に取り付けられるか分からないため）。
    /// PropertyLocalId/Stage は Declarer 自身の ObjectDef に対してビルド時に確定できるため、ローカルID・
    /// PropertyStage参照をそのまま持てる（Declarer は常にこの ContributionDef を宣言した ObjectDef の
    /// インスタンスになることが登録経路上で保証されているため）。
    /// </summary>
    public sealed class ContributionGate
    {
        public ContributionGateKind Kind;
        public int SlotGlobalId;
        public int PropertyLocalId;
        public PropertyStage Stage;

        public static readonly ContributionGate Always = new ContributionGate { Kind = ContributionGateKind.Always };
    }

    /// <summary>
    /// 1つの ObjectDef が宣言する、1つの効果（8節）。ObjectDef.Contributions の要素。
    /// Target が Self/Parent/Child のどれであっても、Kind が Modify/Accumulate のどちらであっても構造は同じで、
    /// 違いは登録時にどこへ・誰の状態と紐付けて置くか（Target）と、どちらの評価経路が読むか（Kind）だけに閉じる
    /// （Runtime.WorldObject.GetEffectiveValue / Tick 参照）。
    /// </summary>
    public sealed class ContributionDef
    {
        public ContributionTarget Target { get; }
        public ContributionKind Kind { get; }
        public int TargetPropertyGlobalId { get; }
        public int Amount { get; }
        public ContributionGate Gate { get; }

        public ContributionDef(
            ContributionTarget target,
            ContributionKind kind,
            int targetPropertyGlobalId,
            int amount,
            ContributionGate gate)
        {
            Target = target;
            Kind = kind;
            TargetPropertyGlobalId = targetPropertyGlobalId;
            Amount = amount;
            Gate = gate;
        }
    }
}
