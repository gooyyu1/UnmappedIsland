using System.Collections.Generic;
using System.Linq;

namespace UnmappedIsland.Domain.Runtime
{
    /// <summary>WorldObject の一部（represented_by による代表・同種スタック判定）。自分の代表チェーンの
    /// スナップショット化・突き合わせと、中身が入れ替わったときの再スタック伝播を持つ。</summary>
    public sealed partial class WorldObject
    {
        /// <summary>interaction/stack判定の代表として採用する、represented_by先の最初の子を返す。
        /// represented_by未指定・対象スロット不存在・空スロットなら自分自身を返す。代表オブジェクトが
        /// さらにrepresented_byを持つ場合は、その代表へ再帰的に委譲する。</summary>
        public WorldObject ResolveInteractionTarget()
        {
            if (!Def.RepresentedBySlotGlobalId.HasValue) return this;
            if (!TryGetSlot(Def.RepresentedBySlotGlobalId.Value, out Slot slot)) return this;
            WorldObject represented = slot.Contents.FirstOrDefault();
            return represented?.ResolveInteractionTarget() ?? this;
        }

        /// <summary>stack判定用の代表ObjectDef列を、現在のrepresented_byチェーンからスナップショットする。
        /// 先頭は自分自身のObjectDefで、続いて代表・代表の代表…を深さ順に並べる（外側オブジェクトも同種判定の
        /// 対象に含める。例: 水入りボウルと水入り瓶は先頭のObjectDefが違うので別スタックになる）。
        /// スナップショット作成時のみ列を組み立てる。合流判定の突き合わせはMatchesRepresentationが辿りながら
        /// 行うため、候補側で毎回この列を作り直すことはしない。</summary>
        public IReadOnlyList<int> CaptureRepresentationChain()
        {
            var chain = new List<int>();
            AppendRepresentationChain(chain);
            return chain;
        }

        /// <summary>自分の代表チェーン（自分自身＋represented_by先…）が、スナップショット済みのexpectedと
        /// 完全に一致するか。expectedと突き合わせながらチェーンを辿り、値の食い違い・長さ違いを見つけ次第
        /// 打ち切る（合流判定は頻繁に呼ばれるため、候補側のList生成を伴わない）。</summary>
        public bool MatchesRepresentation(IReadOnlyList<int> expected) =>
            MatchRepresentationFrom(expected, 0) == expected.Count;

        /// <summary>expected[index..]と、自分以下の代表チェーンを突き合わせる。一致した分だけ進めたindexを返し、
        /// 途中で食い違う（値が違う／expectedが先に尽きる）と-1を返す。</summary>
        private int MatchRepresentationFrom(IReadOnlyList<int> expected, int index)
        {
            if (index >= expected.Count || expected[index] != Def.GlobalId) return -1;
            index++;

            if (!Def.RepresentedBySlotGlobalId.HasValue) return index;
            if (!TryGetSlot(Def.RepresentedBySlotGlobalId.Value, out Slot slot)) return index;

            WorldObject represented = slot.Contents.FirstOrDefault();
            return represented == null ? index : represented.MatchRepresentationFrom(expected, index);
        }

        private void AppendRepresentationChain(List<int> chain)
        {
            chain.Add(Def.GlobalId);
            if (!Def.RepresentedBySlotGlobalId.HasValue) return;
            if (!TryGetSlot(Def.RepresentedBySlotGlobalId.Value, out Slot slot)) return;

            WorldObject represented = slot.Contents.FirstOrDefault();
            represented?.AppendRepresentationChain(chain);
        }

        /// <summary>
        /// 自分の代表チェーン（represented_byで畳んだ同種判定の識別子）が変わった直後の後始末。represented_by先
        /// スロットの中身が入れ替わったときに呼ばれる。まず自分自身が今の所属スタックの固定識別子にまだ合致するかを
        /// スロットへ再判定させ（合致しなければ抜けて適切なスタックへ移る＝同種の別スタックへ合流／無ければ新規）、
        /// 次に自分を代表として使っている一つ上（親）があれば、その親の代表チェーンも連鎖的に変わったので同じ後始末を
        /// 親へ伝える。各段は「自分を再判定し、自分を代表に使う一つ上へ同じ依頼を渡す」だけの局所処理で、上りは
        /// represented_byのネスト分だけ有界（自分のことは自分でする、CLAUDE.md参照）。
        /// </summary>
        private void OnRepresentationChanged()
        {
            if (Parent == null) return;

            Parent.GetSlotByLocalId(ParentSlotLocalId).Restack(this);

            // 自分が親のrepresented_by先スロットに居るなら、自分の代表チェーンの変化は親の代表チェーンの変化でもある。
            if (Parent.IsRepresentedBySlot(ParentSlotLocalId))
                Parent.OnRepresentationChanged();
        }

        /// <summary>slotLocalIdが、このオブジェクトの代表を採るスロット（represented_by先）か。中身が入れ替わった
        /// スロットがこれなら、自分の代表チェーンが変わったということ。</summary>
        private bool IsRepresentedBySlot(int slotLocalId)
        {
            if (!Def.RepresentedBySlotGlobalId.HasValue) return false;
            return Def.SlotLayout.ToLocal(Def.RepresentedBySlotGlobalId.Value) == slotLocalId;
        }
    }
}
