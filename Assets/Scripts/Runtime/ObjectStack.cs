using System.Collections.Generic;
using UnmappedIsland.Codex;

namespace UnmappedIsland.Runtime
{
    /// <summary>
    /// Slot内で「見た目上1つのまとまり」として積み重なる、同じ種類のWorldObjectの集まり（GameElementDefinition.md
    /// 7.6節）。ObjectDefが同じで、かつ ObjectDef.StackByPropertyGlobalId が指定されていればそのプロパティの
    /// 値も一致するインスタンス同士だけが、同じObjectStackにまとまる（例: 同じ液体容器でも中身(content)が
    /// 違えば別々のObjectStackになる）。
    ///
    /// 「このオブジェクトは自分に合流できるか」「自分の中のどこへ挿入すべきか」の判断は、呼び出し側
    /// （Slot）に代わりこのクラス自身が持つ（自分のことは自分でする、CLAUDE.md参照）。
    /// </summary>
    public sealed class ObjectStack
    {
        public ObjectDef Def { get; }

        /// <summary>ObjectDef.StackByPropertyGlobalIdで指定されたプロパティの、このスタックが生まれた
        /// 時点での値。未指定のObjectDefなら常にnull。加わった後の値の変化を追って自動的に移し替える
        /// ことはしない（ObjectDef.StackByPropertyGlobalId参照）。</summary>
        public int? StackType { get; }

        private readonly List<WorldObject> members;
        public IReadOnlyList<WorldObject> Members => members;

        /// <summary>FixedPositionsスロットでのみ使う、このスタック自身の固定番号。それ以外は常にnull。</summary>
        public int? GridIndex { get; internal set; }

        internal ObjectStack(WorldObject seed)
        {
            Def = seed.Def;
            StackType = seed.StackDiscriminator;
            members = new List<WorldObject> { seed };
        }

        private ObjectStack(ObjectDef def, int? stackType, List<WorldObject> initialMembers)
        {
            Def = def;
            StackType = stackType;
            members = initialMembers;
        }

        /// <summary>candidateがこのObjectStackへ合流できるか（ObjectDefが同じ、かつStackTypeも同じ）。</summary>
        internal bool Matches(WorldObject candidate) =>
            candidate.Def.GlobalId == Def.GlobalId && candidate.StackDiscriminator == StackType;

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
            return new ObjectStack(Def, StackType, moved);
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
