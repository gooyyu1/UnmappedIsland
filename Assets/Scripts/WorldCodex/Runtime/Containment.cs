using System.Collections.Generic;
using UnmappedIsland.Codex.Defs;
using UnmappedIsland.Codex.Registry;

namespace UnmappedIsland.Codex.Runtime
{
    /// <summary>
    /// スロット移動を行う唯一の汎用操作（GameElementDefinition.md 7.1節の `move_to_slot`）。
    /// 以下3つの不変条件をここでまとめて保証する。個別のYAML定義側がスロット配列や
    /// 逆引きキャッシュ（WorldObject.Parent）を直接書き換えることは想定しない。
    ///
    /// - accepts（型・個数の制約、RecipeSystem.md 5節）
    /// - capacity（合計サイズの制約、ContainerSystem.md 1節）
    /// - weight の伝播（ContainerSystem.md 2〜3節。derived を使わず、出入りの度に加減算する）
    /// </summary>
    public sealed class Containment
    {
        private readonly WellKnownProperties wellKnown;

        public Containment(WellKnownProperties wellKnown)
        {
            this.wellKnown = wellKnown;
        }

        public bool TryMoveToSlot(WorldObject obj, WorldObject newParent, int slotGlobalId, out string error)
        {
            int localSlot = newParent.Def.SlotLayout.ToLocal(slotGlobalId);
            if (localSlot == LocalIndexMap.Missing)
            {
                error = $"'{newParent.Def.Name}' はスロット(id={slotGlobalId})を持ちません。";
                return false;
            }

            SlotInstance targetSlot = newParent.GetSlotByLocalId(localSlot);
            SlotDef slotDef = targetSlot.Def;

            if (!Accepts(targetSlot, obj))
            {
                error = $"'{newParent.Def.Name}.{slotDef.Name}' は '{obj.Def.Name}' を受け入れられません（accepts制約）。";
                return false;
            }

            if (slotDef.Capacity.HasValue)
            {
                double currentSize = SumSize(targetSlot.Contents);
                double addedSize = obj.GetNumber(wellKnown.SizeId);
                if (currentSize + addedSize > slotDef.Capacity.Value)
                {
                    error = $"'{newParent.Def.Name}.{slotDef.Name}' の容量（{slotDef.Capacity}）を超えます。";
                    return false;
                }
            }

            WorldObject oldParent = obj.Parent;
            int oldParentSlotLocalId = obj.ParentSlotLocalId;

            if (oldParent != null)
            {
                oldParent.GetSlotByLocalId(oldParentSlotLocalId).RemoveInternal(obj);
                PropagateWeight(oldParent, oldParentSlotLocalId, -obj.GetNumber(wellKnown.WeightId));
                UnregisterEdge(oldParent, obj);
            }

            targetSlot.AddInternal(obj);
            obj.SetParent(newParent, localSlot);
            PropagateWeight(newParent, localSlot, obj.GetNumber(wellKnown.WeightId));
            RegisterEdge(newParent, obj);

            error = null;
            return true;
        }

        /// <summary>
        /// 親子関係が結ばれた瞬間に、双方の効果（modify/accumulate、8.2〜8.3節）を相手側へ登録する。
        /// target=Parent（子の効果が親へ及ぶ、例: 防具の`passive.parent`）は親側へ、
        /// target=Child（親の効果が子へ及ぶ）は子側へ登録する。target=Selfは各WorldObjectの
        /// コンストラクタで既に登録済みのため、ここでは扱わない。kind(modify/accumulate)は登録先を
        /// 選ぶ判断に一切影響しない（評価側でのみ区別される）。
        /// </summary>
        private static void RegisterEdge(WorldObject parent, WorldObject child)
        {
            foreach (var c in child.Def.Contributions)
            {
                if (c.Target != ContributionTarget.Parent) continue;
                int local = parent.Def.PropertyLayout.ToLocal(c.TargetPropertyGlobalId);
                if (local == LocalIndexMap.Missing) continue;
                parent.RegisterContribution(local, new ActiveContribution(declarer: child, slotBearer: child, def: c));
            }

            foreach (var c in parent.Def.Contributions)
            {
                if (c.Target != ContributionTarget.Child) continue;
                int local = child.Def.PropertyLayout.ToLocal(c.TargetPropertyGlobalId);
                if (local == LocalIndexMap.Missing) continue;
                child.RegisterContribution(local, new ActiveContribution(declarer: parent, slotBearer: child, def: c));
            }
        }

        private static void UnregisterEdge(WorldObject parent, WorldObject child)
        {
            foreach (var c in child.Def.Contributions)
            {
                if (c.Target != ContributionTarget.Parent) continue;
                int local = parent.Def.PropertyLayout.ToLocal(c.TargetPropertyGlobalId);
                if (local == LocalIndexMap.Missing) continue;
                parent.UnregisterContributionsFrom(child, local);
            }

            foreach (var c in parent.Def.Contributions)
            {
                if (c.Target != ContributionTarget.Child) continue;
                int local = child.Def.PropertyLayout.ToLocal(c.TargetPropertyGlobalId);
                if (local == LocalIndexMap.Missing) continue;
                child.UnregisterContributionsFrom(parent, local);
            }
        }

        private bool Accepts(SlotInstance slot, WorldObject candidate)
        {
            IReadOnlyList<SlotAcceptRule> rules = slot.Def.Accepts;
            if (rules.Count == 0) return true; // accepts省略 = 無制限スロット（7.1節）

            foreach (var rule in rules)
            {
                if (rule.ObjectGlobalId != candidate.Def.GlobalId) continue;

                int countOfSameType = 0;
                foreach (var existing in slot.Contents)
                    if (existing.Def.GlobalId == rule.ObjectGlobalId) countOfSameType++;

                if (countOfSameType < rule.Max) return true;
            }
            return false;
        }

        private double SumSize(IReadOnlyList<WorldObject> objects)
        {
            double total = 0;
            foreach (var o in objects) total += o.GetNumber(wellKnown.SizeId);
            return total;
        }

        /// <summary>
        /// ContainerSystem.md 2〜3節: 重さは derived ではなく move_to_slot の副作用として、
        /// 出入りのたびに weight プロパティへ加減算する。祖先を遡りながら各階層の weight_rate を
        /// 掛け合わせていくことで、入れ子（アイテム→バッグ→バックパック→装備）が自然にカスケードする。
        /// </summary>
        private void PropagateWeight(WorldObject startAt, int occupiedSlotLocalId, double delta)
        {
            WorldObject current = startAt;
            int slotLocalId = occupiedSlotLocalId;

            while (current != null)
            {
                SlotDef slotDef = current.Def.SlotDefs[slotLocalId];
                delta *= slotDef.WeightRate;
                current.AddNumber(wellKnown.WeightId, delta);

                if (current.Parent == null) break;
                slotLocalId = current.ParentSlotLocalId;
                current = current.Parent;
            }
        }
    }
}
