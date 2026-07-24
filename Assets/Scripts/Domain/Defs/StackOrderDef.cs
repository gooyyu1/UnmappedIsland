using System.Collections.Generic;
using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain.Defs
{
    /// <summary>
    /// 同種オブジェクトがスタックとして並ぶ際の、型ごとの並び順（表示専用）。
    ///
    /// ascendingは「プロパティ値が増えるほどリスト内で後ろ（末尾側）に並ぶか」。「手前に重ねたいものほど
    /// リストの末尾に置く」という規約（Slot参照）のもと、寿命・残量など「小さいほど手前」にしたい値は
    /// ascending=false を指定する。
    ///
    /// 新規インスタンスがスタックへ加わる際の並び位置決定にのみ使い、値の変化に追従した再ソートは行わない
    /// （8.4節のaccumulateのような一定速度の変化を想定し、同種は同じ速度で変化する前提のため、
    /// 挿入時点の相対順序が保たれる）。
    /// </summary>
    public sealed class StackOrderDef
    {
        private readonly int propertyGlobalId;
        private readonly bool ascending;

        public StackOrderDef(int propertyGlobalId, bool ascending)
        {
            this.propertyGlobalId = propertyGlobalId;
            this.ascending = ascending;
        }

        /// <summary>
        /// この並び順に従って、objをmembers内のどの位置へ挿入すべきかを返す。同値は既存メンバーの後ろへ
        /// （＝挿入順を保つ）。membersはこの並び順で既に整列済みである前提。
        /// </summary>
        public int InsertionIndexOf(WorldObject obj, IReadOnlyList<WorldObject> members)
        {
            int value = obj.GetNumber(propertyGlobalId);
            int i = 0;
            while (i < members.Count)
            {
                int otherValue = members[i].GetNumber(propertyGlobalId);
                bool staysBefore = ascending ? otherValue <= value : otherValue >= value;
                if (!staysBefore) break;
                i++;
            }
            return i;
        }
    }
}
