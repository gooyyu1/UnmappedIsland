using System.Collections.Generic;
using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain.Defs
{
    /// <summary>
    /// 1つの ObjectDef が宣言する持続効果（8節）の一式。target・kindを問わず1つにまとめて持ち、
    /// 要素リストは公開せず、登録/解除の一括依頼（RegisterRelation/RegisterChild）だけを受ける。
    /// </summary>
    public sealed class PassiveEffects
    {
        private readonly IReadOnlyList<PassiveEffect> effects;

        public PassiveEffects(IReadOnlyList<PassiveEffect> effects)
        {
            this.effects = effects;
        }

        /// <summary>owner自身から辿れる関係（Self/Parent/Ancestor）が変わった契機を全effectへ伝える
        /// （PassiveEffect.RegisterRelation参照）。</summary>
        public void RegisterRelation(WorldObject owner, ReferenceRoot relation, bool register)
        {
            foreach (var effect in effects)
                effect.RegisterRelation(owner, relation, register);
        }

        /// <summary>childがowner（親）に付く/離れる契機を全effectへ伝える（target=Childのものだけが反応する）。</summary>
        public void RegisterChild(WorldObject owner, WorldObject child, bool register)
        {
            foreach (var effect in effects)
                effect.RegisterChild(owner, child, register);
        }
    }
}
