using System.Collections.Generic;
using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain.Defs
{
    /// <summary>
    /// 同種オブジェクトがスタックとして並ぶ際の、型ごとの並び順（例: 劣化アイテムは寿命が短いものほど、
    /// 液体容器は中身が少ないものほど「手前＝一番上に重なる」）。
    ///
    /// ascendingは「プロパティ値が増えるほどリスト内で後ろ（末尾側）に並ぶか」を表す。「手前に重ねたい
    /// ものほどリストの末尾に置く」という規約（Slot参照）のもとでは、寿命・残量など「小さいほど手前」に
    /// したい値は ascending=false（値が小さいものほど末尾）を指定する。
    ///
    /// このObjectDefの新規インスタンスがスタックへ加わる際の並び位置決定にのみ使う（表示専用の概念）。
    /// 一度並んだ後、値の変化に追従した再ソートは行わない（同種は同じ速度で変化する前提のため、
    /// 挿入時点の相対順序がその後も保たれる、8.4節のaccumulateのような一定速度の変化を想定）。
    ///
    /// 「どのプロパティで・どちら向きに並べるか」はこの定義自身の内部事情なので外へ出さず、挿入位置を
    /// 求める処理もこのクラス自身が持つ（自分のことは自分でする、CLAUDE.md参照）。
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
        /// （＝挿入順を保つ）。membersはこの並び順で既に整列済みである前提（先頭から、objが後ろに居続けられる
        /// 間だけ進み、追い越せなくなった位置で止める）。
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
