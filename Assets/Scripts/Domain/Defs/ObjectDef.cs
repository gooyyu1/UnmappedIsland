using System;
using System.Collections.Generic;

namespace UnmappedIsland.Domain.Defs
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

        /// <summary>この object_def が持つタグのグローバルIDの一覧（4節）。自分自身が直接宣言したタグと、
        /// 参照した trait（5節）が宣言していたタグの両方を合成済みで持つ（trait自体は合成後に消えるため、
        /// slots.accepts（7.2節）・combinations.with（12.1節）はこのタグ集合だけを見てマッチングする）。</summary>
        public IReadOnlyList<int> Tags { get; }

        /// <summary>グローバルなプロパティID → このObjectDefにおけるローカルindex。</summary>
        public LocalIndexMap PropertyLayout { get; }

        /// <summary>ローカルindexで並ぶ密配列。PropertyLayout と対になる。</summary>
        internal IReadOnlyList<PropertyDef> PropertyDefs { get; }

        /// <summary>グローバルなスロットID → このObjectDefにおけるローカルindex。</summary>
        public LocalIndexMap SlotLayout { get; }

        /// <summary>ローカルindexで並ぶ密配列。SlotLayout と対になる。</summary>
        public IReadOnlyList<SlotDef> SlotDefs { get; }

        /// <summary>このObjectDefが宣言する効果（8節）。target(self/parent/child)・kind(modify/accumulate)を
        /// 問わず1つのリストで持つ。</summary>
        public IReadOnlyList<PassiveEffect> Passives { get; }

        /// <summary>スタック内での並び順（表示専用）。null なら並び順は未定義で、常にスタックの末尾へ
        /// 追加される（新規インスタンス同士の相対順序＝挿入順）。</summary>
        public StackOrderDef StackOrder { get; }

        /// <summary>このobject_defがinteraction/stack判定を、どのスロット内の代表オブジェクトへ委譲するか
        /// を表すスロットのグローバルID（7.6節）。nullなら常に自分自身を代表とする。指定されていれば、
        /// そのスロットに現在入っている最初の1個が interaction の実行対象になり、stack判定でも
        /// その代表オブジェクト（さらにその代表…）のObjectDef列を使って区別する。</summary>
        public int? RepresentedBySlotGlobalId { get; }

        /// <summary>このObjectDefが持つメニュー型操作（11節）。</summary>
        public IReadOnlyList<ActionDef> Actions { get; }

        /// <summary>このObjectDefが（受け側として）持つドラッグ型操作（12節）。</summary>
        public IReadOnlyList<CombinationDef> Combinations { get; }

        /// <summary>グローバルIDでこのObjectDefのPropertyDefを取得する。存在しない場合はnull。</summary>
        public PropertyDef GetPropertyDef(int globalPropertyId)
        {
            int local = PropertyLayout.ToLocal(globalPropertyId);
            return local == LocalIndexMap.Missing ? null : PropertyDefs[local];
        }

        public ObjectDef(
            int globalId,
            string name,
            bool isSingleton,
            LocalIndexMap propertyLayout,
            IReadOnlyList<PropertyDef> propertyDefs,
            LocalIndexMap slotLayout,
            IReadOnlyList<SlotDef> slotDefs,
            IReadOnlyList<PassiveEffect> passives,
            StackOrderDef stackOrder = null,
            IReadOnlyList<int> tags = null,
            IReadOnlyList<ActionDef> actions = null,
            IReadOnlyList<CombinationDef> combinations = null,
            int? representedBySlotGlobalId = null)
        {
            GlobalId = globalId;
            Name = name;
            IsSingleton = isSingleton;
            PropertyLayout = propertyLayout;
            PropertyDefs = propertyDefs;
            SlotLayout = slotLayout;
            SlotDefs = slotDefs;
            Passives = passives;
            StackOrder = stackOrder;
            Tags = tags ?? Array.Empty<int>();
            Actions = actions ?? Array.Empty<ActionDef>();
            Combinations = combinations ?? Array.Empty<CombinationDef>();
            RepresentedBySlotGlobalId = representedBySlotGlobalId;
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
