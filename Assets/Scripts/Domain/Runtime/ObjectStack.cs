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
        /// <summary>このスタックのアイデンティティ。seed自身のObjectDefを先頭に、represented_byで辿った
        /// 代表ObjectDef列が続く、このスタックが生まれた時点でのスナップショット。外側オブジェクトも含めて
        /// いるため、これ一つで「合流できる同種か」を完全に表す（別途Defを突き合わせる必要は無い）。
        /// 生成後は書き換えず、合流判定の“動かない物差し”として固定する。メンバーの中身が変わってこの列に
        /// 合致しなくなった場合に動くのは、そのメンバーの所属スタック（抜けて適切なスタックへ移る）であって、
        /// この列ではない。合流判定(Matches)でのみ使う内部状態なので外へは見せない。</summary>
        private readonly IReadOnlyList<int> representationChain;

        private readonly List<WorldObject> members;
        public IReadOnlyList<WorldObject> Members => members;

        public ObjectStack(WorldObject seed)
        {
            representationChain = seed.CaptureRepresentationChain();
            members = new List<WorldObject> { seed };
        }

        /// <summary>candidateがこのObjectStackへ合流できるか。自分自身＋代表ObjectDef列（RepresentationChain）が
        /// 完全に一致するかを、candidate自身に辿らせて判定する（外側オブジェクトも先頭要素として含まれる）。</summary>
        public bool Matches(WorldObject candidate) =>
            candidate.MatchesRepresentation(representationChain);

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
            // 並び順が未定義なら常に末尾（挿入順）。定義があれば、どこへ挿すかの判断はStackOrderDef自身に委ねる。
            StackOrderDef order = obj.Def.StackOrder;
            return order == null ? members.Count : order.InsertionIndexOf(obj, members);
        }
    }
}
