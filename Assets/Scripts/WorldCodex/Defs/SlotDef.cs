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

        /// <summary>
        /// 同種オブジェクトを表示上1つの単位（スタック）としてまとめるか（既定true）。falseなら同種でも
        /// 個体ごとに別単位として数える（例: かまどの投入口。同じ種類の燃料を2つ入れても2枠消費する）。
        /// </summary>
        public bool Stackable { get; }

        /// <summary>
        /// このスロットに同時に存在できる「単位」の上限（null=無制限）。単位の意味はStackableに従う
        /// （trueなら異なるObjectDefの種類数、falseなら個体数そのもの）。既存のCapacity（サイズ合計）
        /// とは独立した、種類数/個数ベースの別軸の制約。
        /// </summary>
        public int? UnitCapacity { get; }

        /// <summary>
        /// 前詰めしないか（既定false）。trueの場合、Runtime側（Slot）が「型→固定番号」の対応表を持ち、
        /// 空いた番号を保持したまま詰めない・プレイヤーが手動で並び替え可能、という挙動になる
        /// （例: プレイヤー手持ちの6枠）。
        /// </summary>
        public bool FixedPositions { get; }

        public SlotDef(
            int globalId, string name, IReadOnlyList<SlotAcceptRule> accepts, double? capacity, double weightRate,
            bool stackable = true, int? unitCapacity = null, bool fixedPositions = false)
        {
            GlobalId = globalId;
            Name = name;
            Accepts = accepts;
            Capacity = capacity;
            WeightRate = weightRate;
            Stackable = stackable;
            UnitCapacity = unitCapacity;
            FixedPositions = fixedPositions;
        }
    }
}
