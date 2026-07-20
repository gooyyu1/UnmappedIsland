using System.Collections.Generic;
using UnmappedIsland.Domain.Defs;

namespace UnmappedIsland.Domain.Runtime
{
    /// <summary>
    /// Slot内で「見た目上1つのまとまり」として積み重なる、同じ種類のWorldObjectの集まり（GameElementDefinition.md
    /// 7.6節）。ObjectDefが同じで、かつ represented_by が指定されていれば、その代表オブジェクト
    /// （さらにその代表…）のObjectDef列も一致するインスタンス同士だけが同じObjectStackにまとまる
    /// （例: 同じ液体容器でも中身のObjectDefが違えば別々のObjectStackになる）。
    ///
    /// 「このオブジェクトは自分に合流できるか」「自分の中のどこへ挿入すべきか」の判断は、呼び出し側
    /// （Slot）に代わりこのクラス自身が持つ（自分のことは自分でする、CLAUDE.md参照）。
    /// </summary>
    public sealed class ObjectStack
    {
        public ObjectDef Def { get; }

        /// <summary>represented_byで辿った代表ObjectDef列の、このスタックが生まれた時点でのスナップショット。
        /// 代表未指定・空なら空列。加わった後の中身の変化を追って自動的に移し替えることはしない。</summary>
        public IReadOnlyList<int> RepresentationChain { get; }

        private readonly List<WorldObject> members;
        public IReadOnlyList<WorldObject> Members => members;

        /// <summary>FixedPositionsスロットでのみ使う、このスタック自身の固定番号。それ以外は常にnull。</summary>
        public int? GridIndex { get; internal set; }

        internal ObjectStack(WorldObject seed)
        {
            Def = seed.Def;
            RepresentationChain = seed.CaptureRepresentationChain();
            members = new List<WorldObject> { seed };
        }

        private ObjectStack(ObjectDef def, IReadOnlyList<int> representationChain, List<WorldObject> initialMembers)
        {
            Def = def;
            RepresentationChain = representationChain;
            members = initialMembers;
        }

        /// <summary>candidateがこのObjectStackへ合流できるか（ObjectDefが同じ、かつ代表ObjectDef列も同じ）。</summary>
        internal bool Matches(WorldObject candidate) =>
            candidate.Def.GlobalId == Def.GlobalId && candidate.HasRepresentationChain(RepresentationChain);

        /// <summary>ObjectDef.StackOrderに従って、自分のMembers内の正しい位置へobjを挿入する
        /// （未定義なら常に末尾＝挿入順、Slot.IndexWithinRunの元のロジックをそのまま踏襲）。</summary>
        internal void Insert(WorldObject obj) => members.Insert(ComputeInsertionIndex(obj), obj);

        internal void Remove(WorldObject obj) => members.Remove(obj);

        internal int IndexOf(WorldObject obj) => members.IndexOf(obj);

        /// <summary>atIndex以降のMembersを切り出し、新しいObjectStackとして返す（自分自身はatIndexより
        /// 前だけを残す）。same_slotで型の異なるオブジェクトがスタックの途中へ割り込む際、このスタックを
        /// 前後2つに分割するために使う（Slot.InsertAtCapturedPosition参照）。</summary>
        internal ObjectStack Split(int atIndex)
        {
            var moved = members.GetRange(atIndex, members.Count - atIndex);
            members.RemoveRange(atIndex, members.Count - atIndex);
            return new ObjectStack(Def, RepresentationChain, moved);
        }

        private int ComputeInsertionIndex(WorldObject obj)
        {
            StackOrderDef order = obj.Def.StackOrder;
            if (order == null) return members.Count; // 並び順未定義は常に末尾（挿入順）

            int value = obj.GetNumber(order.PropertyGlobalId);
            int i = 0;
            while (i < members.Count)
            {
                int otherValue = members[i].GetNumber(order.PropertyGlobalId);
                bool staysBefore = order.Ascending ? otherValue <= value : otherValue >= value;
                if (!staysBefore) break;
                i++;
            }
            return i;
        }
    }
}
