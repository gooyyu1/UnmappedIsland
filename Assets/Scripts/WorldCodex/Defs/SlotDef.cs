using System.Collections.Generic;

namespace UnmappedIsland.Codex.Defs
{
    /// <summary>GameElementDefinition.md 7.2節の accepts の1エントリ（型・個数の制約）。</summary>
    public sealed class SlotAcceptRule
    {
        /// <summary>受け入れ対象 ObjectDef のグローバルID。</summary>
        public int ObjectGlobalId { get; }
        public int Max { get; }
        public bool Consume { get; }

        public SlotAcceptRule(int objectGlobalId, int max, bool consume)
        {
            ObjectGlobalId = objectGlobalId;
            Max = max;
            Consume = consume;
        }
    }

    /// <summary>
    /// 1つの ObjectDef が持つ、1つのスロットの定義（GameElementDefinition.md 7.1〜7.4節）。
    /// ObjectDef.SlotDefs の1要素として、ローカルIDをそのままindexとする密配列に格納される。
    /// </summary>
    public sealed class SlotDef
    {
        public int GlobalId { get; }
        public string Name { get; }

        /// <summary>空なら無制限スロット（accepts省略時の既定、7.1節）。</summary>
        public IReadOnlyList<SlotAcceptRule> Accepts { get; }

        /// <summary>合計サイズの上限（GameElementDefinition.md 7.3節）。null なら無制限。</summary>
        public double? Capacity { get; }

        /// <summary>重さの伝播率（GameElementDefinition.md 7.4節）。既定 1.0（そのまま伝播）。</summary>
        public double WeightRate { get; }

        public SlotDef(int globalId, string name, IReadOnlyList<SlotAcceptRule> accepts, double? capacity, double weightRate)
        {
            GlobalId = globalId;
            Name = name;
            Accepts = accepts;
            Capacity = capacity;
            WeightRate = weightRate;
        }
    }
}
