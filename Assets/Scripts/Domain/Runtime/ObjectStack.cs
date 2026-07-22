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
        public int? GridIndex { get; set; }

        public ObjectStack(WorldObject seed)
        {
            Def = seed.Def;
            RepresentationChain = seed.CaptureRepresentationChain();
            members = new List<WorldObject> { seed };
        }

        /// <summary>candidateがこのObjectStackへ合流できるか（ObjectDefが同じ、かつ代表ObjectDef列も同じ）。</summary>
        public bool Matches(WorldObject candidate) =>
            candidate.Def.GlobalId == Def.GlobalId && candidate.HasRepresentationChain(RepresentationChain);

        /// <summary>
        /// objがこのスタックへ合流できる（Matches: ObjectDef・代表ObjectDef列が一致）場合のみ、
        /// ObjectDef.StackOrderに従って自分のMembers内の正しい位置へ挿入し、trueを返す（並び順が未定義なら
        /// 常に末尾＝挿入順、Slot.IndexWithinRunの元のロジックをそのまま踏襲）。
        ///
        /// 合流できないオブジェクト（ObjectDef違い・代表列違い＝別スタックになるべきもの）を無理やり
        /// 押し込む事故を防ぐため、Matchesを満たさない場合は何もせずfalseを返す。「このオブジェクトを自分へ
        /// 入れてよいか」の判断はスタック自身の不変条件（同種のみが積み重なる）に属するため、呼び出し側が
        /// 事前に確認済みかどうかに依存せず、このメソッド自身が最後の砦として保証する。
        /// </summary>
        public bool TryInsert(WorldObject obj)
        {
            if (!Matches(obj)) return false;
            members.Insert(ComputeInsertionIndex(obj), obj);
            return true;
        }

        public void Remove(WorldObject obj) => members.Remove(obj);

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
