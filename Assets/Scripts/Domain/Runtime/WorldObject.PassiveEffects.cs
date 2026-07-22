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
        /// falseで解除）。thisから見れば相手はParent（防具の`passive.parent`等。相手はowner自身から辿れるので渡さない）、
        /// parentから見れば相手はChild（親の効果が子へ及ぶ。どの子かは一意に辿れないため、その子thisを明示的に渡す）。
        /// target=Selfは各WorldObjectのコンストラクタで登録済みのため、ここでは扱わない。登録先の解決・登録/解除は
        /// 効果自身が行い、kind(modify/accumulate)は登録先の選択に影響しない（評価側でのみ区別される）。
        /// </summary>
        private void RegisterEdgeWith(WorldObject parent, bool register)
        {
            Def.Passives.RegisterRelation(this, ReferenceRoot.Parent, register);
            parent.Def.Passives.RegisterChild(parent, this, register);
        }

        /// <summary>
        /// 自分自身の直接の親が変わる（MoveToSlot/Destroy）際、その前に解除(register=false)・後に登録
        /// (register=true)として呼ぶ。自分の祖先チェーンが変わるのは自分自身だけでなく、自分の子孫全員に
        /// とっても同じ（子孫からのAncestor探索は自分を通過してさらに上へ続きうる）ため、自分自身と、すべての
        /// 子孫について、Target=Ancestorのpassivesを現在の祖先へ登録/解除する。トポロジ変化前に解除・変化後に
        /// 登録する順序を守ることで、いずれの時点でも祖先はownerから辿れ、前回の登録先を憶える必要がない。
        /// </summary>
        private void RegisterAncestorTargetedRecursively(bool register)
        {
            Def.Passives.RegisterRelation(this, ReferenceRoot.Ancestor, register);

            foreach (var slot in slots)
                foreach (var child in slot.Contents.ToArray())
                    child.RegisterAncestorTargetedRecursively(register);
        }

        /// <summary>グローバルプロパティIDで指す対象プロパティのincomingへ、登録済み効果1件を登録する
        /// （PassiveEffectが登録先を解決して呼ぶ）。このオブジェクトがそのプロパティを持たなければ何もしない
        /// （登録先の有無の判定をここに閉じ込め、呼び出し側は宛先の有無を気にしなくてよい）。</summary>
        public void RegisterPassiveEffect(int propertyGlobalId, RegisteredPassiveEffect effect)
        {
            if (TryGetProperty(propertyGlobalId, out PropertyValue property))
                property.RegisterPassiveEffect(effect);
        }

        /// <summary>グローバルプロパティIDで指す対象プロパティから、declarerが宣言した登録を解除する。
        /// このオブジェクトがそのプロパティを持たなければ何もしない。</summary>
        public void UnregisterPassiveEffectsFrom(WorldObject declarer, int propertyGlobalId)
        {
            if (TryGetProperty(propertyGlobalId, out PropertyValue property))
                property.UnregisterPassiveEffectsFrom(declarer);
        }

        /// <summary>
        /// 現在このプロパティに登録されている全寄与（modify/accumulate両方）を列挙する。
        /// 「このプロパティに何が影響しているか」をUIで表示したい場合に使う。各効果が現在いくら効いているかは
        /// RegisteredPassiveEffect.ActiveAmount()（ゲートが有効ならAmount、無効なら0）で得られる。
        /// </summary>
        public IReadOnlyList<RegisteredPassiveEffect> GetIncomingPassiveEffects(int propertyGlobalId)
        {
            return TryGetProperty(propertyGlobalId, out PropertyValue property)
                ? property.Incoming
                : Array.Empty<RegisteredPassiveEffect>();
        }
    }
}
