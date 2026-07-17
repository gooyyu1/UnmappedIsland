using System.Collections.Generic;

namespace UnmappedIsland.Codex
{
    /// <summary>
    /// 型定義（`object_defs` の1エントリ、4節）。ロード完了後は不変として扱う。
    /// 実行時インスタンスは WorldObject（Runtime名前空間）。
    /// </summary>
    public sealed class ObjectDef
    {
        public int GlobalId { get; }
        public string Name { get; }

        /// <summary>唯一のインスタンスしか存在しない想定（9節、例: world）。</summary>
        public bool IsSingleton { get; }

        /// <summary>グローバルなプロパティID → このObjectDefにおけるローカルindex。</summary>
        public LocalIndexMap PropertyLayout { get; }

        /// <summary>ローカルindexで並ぶ密配列。PropertyLayout と対になる。</summary>
        public IReadOnlyList<PropertyDef> PropertyDefs { get; }

        /// <summary>グローバルなスロットID → このObjectDefにおけるローカルindex。</summary>
        public LocalIndexMap SlotLayout { get; }

        /// <summary>ローカルindexで並ぶ密配列。SlotLayout と対になる。</summary>
        public IReadOnlyList<SlotDef> SlotDefs { get; }

        /// <summary>このObjectDefが宣言する効果（8節）。target(self/parent/child)・kind(modify/accumulate)を
        /// 問わず1つのリストで持つ。</summary>
        public IReadOnlyList<ContributionDef> Contributions { get; }

        /// <summary>スタック内での並び順（表示専用）。null なら並び順は未定義で、常にスタックの末尾へ
        /// 追加される（新規インスタンス同士の相対順序＝挿入順）。</summary>
        public StackOrderDef StackOrder { get; }

        public ObjectDef(
            int globalId,
            string name,
            bool isSingleton,
            LocalIndexMap propertyLayout,
            IReadOnlyList<PropertyDef> propertyDefs,
            LocalIndexMap slotLayout,
            IReadOnlyList<SlotDef> slotDefs,
            IReadOnlyList<ContributionDef> contributions,
            StackOrderDef stackOrder = null)
        {
            GlobalId = globalId;
            Name = name;
            IsSingleton = isSingleton;
            PropertyLayout = propertyLayout;
            PropertyDefs = propertyDefs;
            SlotLayout = slotLayout;
            SlotDefs = slotDefs;
            Contributions = contributions;
            StackOrder = stackOrder;
        }
    }

    /// <summary>
    /// ロード済みの全 ObjectDef を、グローバルIDをそのままindexとする配列で保持する。
    /// </summary>
    public sealed class ObjectDefTable
    {
        private readonly ObjectDef[] byGlobalId;

        public ObjectDefTable(ObjectDef[] byGlobalId)
        {
            this.byGlobalId = byGlobalId;
        }

        public int Count => byGlobalId.Length;
        public ObjectDef Get(int globalId) => byGlobalId[globalId];
    }
}
