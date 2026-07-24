using System;
using System.Collections.Generic;
using System.Linq;
using UnmappedIsland.Domain.Defs;

namespace UnmappedIsland.Domain.Runtime
{
    /// <summary>WorldObject の一部（持続効果 modify/accumulate の登録・解除）。生成・エッジ形成/解消・トポロジ
    /// 変化の契機で、Def が宣言する効果一式（PassiveEffects）へ「登録/解除してほしい」と依頼する。どのtargetが
    /// どこへ紐付くかは効果自身が知り、こちらは契機を伝えるだけ。</summary>
    public sealed partial class WorldObject
    {
        /// <summary>
        /// 親子のエッジが形成/解消された契機を、双方の効果（modify/accumulate、8節）へ伝える（register=trueで登録、
        /// falseで解除）。親側だけ子thisを明示的に渡すのは、親からどの子かを一意に辿れないため。
        /// target=Selfはコンストラクタで登録済みのため、ここでは扱わない。
        /// </summary>
        private void RegisterEdgeWith(WorldObject parent, bool register)
        {
            Def.Passives.RegisterRelation(this, ReferenceRoot.Parent, register);
            parent.Def.Passives.RegisterChild(parent, this, register);
        }

        /// <summary>
        /// 自分自身と、すべての子孫について、Target=Ancestorのpassivesを現在の祖先へ登録/解除する。
        /// 親が変わると子孫全員の祖先チェーンも変わるため、再帰で全員分を扱う。
        /// トポロジ変化前に解除・変化後に登録する順序を守ることで、いずれの時点でも祖先はownerから辿れ、
        /// 前回の登録先を憶える必要がない。
        /// </summary>
        private void RegisterAncestorTargetedRecursively(bool register)
        {
            Def.Passives.RegisterRelation(this, ReferenceRoot.Ancestor, register);

            foreach (var slot in slots)
                foreach (var child in slot.Contents.ToArray())
                    child.RegisterAncestorTargetedRecursively(register);
        }

        /// <summary>対象プロパティのincomingへ、登録済み効果1件を登録する。このオブジェクトがそのプロパティを
        /// 持たなければ何もしない（呼び出し側は宛先の有無を気にしなくてよい）。</summary>
        public void RegisterPassiveEffect(int propertyGlobalId, RegisteredPassiveEffect effect)
        {
            if (TryGetProperty(propertyGlobalId, out PropertyValue property))
                property.RegisterPassiveEffect(effect);
        }

        /// <summary>対象プロパティから、declarerが宣言した登録を解除する。プロパティを持たなければ何もしない。</summary>
        public void UnregisterPassiveEffectsFrom(WorldObject declarer, int propertyGlobalId)
        {
            if (TryGetProperty(propertyGlobalId, out PropertyValue property))
                property.UnregisterPassiveEffectsFrom(declarer);
        }

        /// <summary>現在このプロパティに登録されている全寄与（modify/accumulate両方）。UI表示用。
        /// 各効果が現在いくら効いているかはRegisteredPassiveEffect.ActiveAmount()で得られる。</summary>
        public IReadOnlyList<RegisteredPassiveEffect> GetIncomingPassiveEffects(int propertyGlobalId)
        {
            return TryGetProperty(propertyGlobalId, out PropertyValue property)
                ? property.Incoming
                : Array.Empty<RegisteredPassiveEffect>();
        }
    }
}
