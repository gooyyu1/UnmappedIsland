namespace UnmappedIsland.Codex.Defs
{
    /// <summary>
    /// 効果の対象（8.2節の self/parent/child）。値そのものは登録時にしか使わず、
    /// 読み取り側（WorldObject.GetEffectiveValue）はこの区別を一切見ない。
    /// </summary>
    public enum ModifyTarget
    {
        Self,
        Parent,
        Child,
    }

    public enum ModifyGateKind
    {
        /// <summary>常時有効（when省略）。</summary>
        Always,

        /// <summary>SlotBearer が特定のスロットに入っている間だけ有効（`when: <スロット名>`）。</summary>
        WhenSlot,

        /// <summary>Declarer 自身の特定プロパティが特定stageにある間だけ有効。</summary>
        WhenOwnStage,
    }

    /// <summary>
    /// modify の発動条件。Kind に応じて使うフィールドが変わる。
    ///
    /// SlotGlobalId はグローバルIDのまま持つ（WhenSlot は「今の親のスロット構成」に対して都度ローカル化する
    /// 必要がある。効果を宣言した側のObjectDefは、将来どんな親に取り付けられるか分からないため）。
    /// PropertyLocalId/Stage は Declarer 自身の ObjectDef に対してビルド時に確定できるため、ローカルID・
    /// PropertyStage参照をそのまま持てる（Declarer は常にこの ModifyContributionDef を宣言した ObjectDef の
    /// インスタンスになることが登録経路上で保証されているため）。
    /// </summary>
    public sealed class ModifyGate
    {
        public ModifyGateKind Kind;
        public int SlotGlobalId;
        public int PropertyLocalId;
        public PropertyStage Stage;

        public static readonly ModifyGate Always = new ModifyGate { Kind = ModifyGateKind.Always };
    }

    /// <summary>
    /// 1つの ObjectDef が宣言する、1つの modify 効果（8.2〜8.3節）。ObjectDef.ModifyContributions の要素。
    /// Target が Self/Parent/Child のどれであっても構造は同じで、違いは登録時にどこへ・誰の状態と紐付けて
    /// 置くかだけに閉じる（Runtime.WorldObject.GetEffectiveValue 参照）。
    /// </summary>
    public sealed class ModifyContributionDef
    {
        public ModifyTarget Target { get; }
        public int TargetPropertyGlobalId { get; }
        public double Amount { get; }
        public ModifyGate Gate { get; }

        public ModifyContributionDef(ModifyTarget target, int targetPropertyGlobalId, double amount, ModifyGate gate)
        {
            Target = target;
            TargetPropertyGlobalId = targetPropertyGlobalId;
            Amount = amount;
            Gate = gate ?? ModifyGate.Always;
        }
    }
}
