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
        public IReadOnlyList<PropertyDef> PropertyDefs { get; }

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

        /// <summary>同じSlotの中で「どの単位でスタックとしてまとまるか」を決めるプロパティ（7.6節）。
        /// nullなら常にObjectDefが同じだけでスタックがまとまる（既定の挙動）。指定されていれば、
        /// ObjectDefが同じに加え、このプロパティの現在値も一致するインスタンス同士だけが同じ
        /// ObjectStackにまとまる（例: 同じ液体容器でも中身(content)が違えば別のスタックとして扱う）。
        /// スタックへ加わる時点の値で1度だけ判定し、その後の値の変化を追って自動的に移し替えることは
        /// しない（StackOrderと同じ「一度並んだ後は追従しない」という既存の割り切りに合わせる）。</summary>
        public int? StackByPropertyGlobalId { get; }

        /// <summary>このObjectDefが持つメニュー型操作（11節）。</summary>
        public IReadOnlyList<ActionDef> Actions { get; }

        /// <summary>このObjectDefが（受け側として）持つドラッグ型操作（12節）。</summary>
        public IReadOnlyList<CombinationDef> Combinations { get; }

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
            int? stackByPropertyGlobalId = null)
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
            StackByPropertyGlobalId = stackByPropertyGlobalId;
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
