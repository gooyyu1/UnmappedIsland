using System.Collections.Generic;
using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain.Defs
{
    /// <summary>
    /// 1つの ObjectDef が宣言する持続効果（8節）の一式。target(self/parent/child/ancestor)・
    /// kind(modify/accumulate)を問わず1つにまとめて持つ。
    ///
    /// これらは常に「まとめて」扱われる——生成・エッジ形成/解消・トポロジ変化といった契機のたびに、
    /// 全effectへ同じ登録/解除を依頼する——ため、要素リストを外へ見せず、まとめて依頼を受ける操作
    /// （RegisterRelation/RegisterChild）だけを公開する。呼び出し側（WorldObject）は個々のPassiveEffectを
    /// foreachで回す必要がなく、「この関係が変わったので登録/解除してほしい」と一式へ依頼するだけでよい
    /// （自分のことは自分でする、CLAUDE.md参照）。
    /// </summary>
    public sealed class PassiveEffects
    {
        private readonly IReadOnlyList<PassiveEffect> effects;

        public PassiveEffects(IReadOnlyList<PassiveEffect> effects)
        {
            this.effects = effects;
        }

        /// <summary>owner自身から辿れる関係（Self/Parent/Ancestor）が変わった契機を、全effectへまとめて伝える
        /// （各effectはtargetが一致するものだけ、ownerから相手を解決して登録/解除する。PassiveEffect参照）。</summary>
        public void RegisterRelation(WorldObject owner, ReferenceRoot relation, bool register)
        {
            foreach (var effect in effects)
                effect.RegisterRelation(owner, relation, register);
        }

        /// <summary>childがowner（親）に付く/離れる契機を、全effectへまとめて伝える（各effectはtarget=Childの
        /// ものだけ、その子へ登録/解除する）。</summary>
        public void RegisterChild(WorldObject owner, WorldObject child, bool register)
        {
            foreach (var effect in effects)
                effect.RegisterChild(owner, child, register);
        }
    }
}
