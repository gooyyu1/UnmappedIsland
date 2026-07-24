using System.Collections.Generic;
using UnmappedIsland.Domain.Defs;

namespace UnmappedIsland.Domain.Runtime
{
    /// <summary>
    /// Slot内で「見た目上1つのまとまり」として積み重なる、同じ種類のWorldObjectの集まり
    /// （GameElementDefinition.md 7.6節）。ObjectDefと、represented_byで辿った代表ObjectDef列が一致する
    /// インスタンス同士だけがまとまる（例: 同じ液体容器でも中身のObjectDefが違えば別スタック）。
    /// </summary>
    public sealed class ObjectStack
    {
        /// <summary>このスタックのアイデンティティ（seed自身のObjectDefを先頭に、represented_byで辿った
        /// 代表ObjectDef列が続く、生成時点のスナップショット）。生成後は書き換えない。メンバーの中身が変わって
        /// この列に合致しなくなった場合に動くのは、そのメンバーの所属スタックであってこの列ではない。</summary>
        private readonly IReadOnlyList<int> representationChain;

        private readonly List<WorldObject> members;
        public IReadOnlyList<WorldObject> Members => members;

        public ObjectStack(WorldObject seed)
        {
            representationChain = seed.CaptureRepresentationChain();
            members = new List<WorldObject> { seed };
        }

        /// <summary>candidateがこのObjectStackへ合流できるか（代表ObjectDef列が完全一致するか）。</summary>
        public bool Matches(WorldObject candidate) =>
            candidate.MatchesRepresentation(representationChain);

        /// <summary>
        /// Matchesを満たす場合のみ、ObjectDef.StackOrderに従ったMembers内の位置へ挿入してtrueを返す
        /// （並び順が未定義なら末尾＝挿入順）。満たさない場合は何もせずfalse——「同種のみが積み重なる」
        /// 不変条件を、呼び出し側の事前確認に依存せずこのメソッド自身が保証する。
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
            // 並び順が未定義なら末尾（挿入順）。定義があればStackOrderDefに委ねる。
            StackOrderDef order = obj.Def.StackOrder;
            return order == null ? members.Count : order.InsertionIndexOf(obj, members);
        }
    }
}
