using System;
using System.Collections.Generic;
using UnmappedIsland.Codex;

namespace UnmappedIsland.Runtime
{
    /// <summary>
    /// スロット移動を行う唯一の汎用操作（GameElementDefinition.md 7.1節の `move_to_slot`）。
    /// 以下3つの不変条件をここでまとめて保証する。個別のYAML定義側がスロット配列や
    /// 逆引きキャッシュ（WorldObject.Parent）を直接書き換えることは想定しない。
    ///
    /// - accepts（型・個数の制約、GameElementDefinition.md 7.2節）
    /// - capacity（合計サイズの制約、GameElementDefinition.md 7.3節）
    /// - weight の伝播（GameElementDefinition.md 7.4節、内部設計はContainerSystem.md 1〜2節。derived を使わず、出入りの度に加減算する）
    /// </summary>
    public sealed class Containment
    {
        private readonly WellKnownProperties wellKnown;

        public Containment(WellKnownProperties wellKnown)
        {
            this.wellKnown = wellKnown;
        }

        /// <summary>
        /// force=true の場合、accepts/capacity/UnitCapacityの検証を飛ばして必ず配置を成功させる（spawnの
        /// フォールバック、GameElementDefinition.md 9.4節専用。すべてのオブジェクトは必ずどこかの親に
        /// 属さなければならないという前提を、退避先で保証するために使う）。スロット自体が存在しない場合は
        /// forceでも失敗する（存在しない配列indexへは置けないため）。
        /// </summary>
        public bool TryMoveToSlot(WorldObject obj, WorldObject newParent, int slotGlobalId, out string error, bool force = false) =>
            TryPlace(obj, newParent, slotGlobalId, insertAtIndex: null, out error, force);

        /// <summary>
        /// same_slot専用。通常の（同種のrunへソート挿入する）配置ロジックを使わず、指定した位置へ
        /// そのまま挿入する。破棄されたオブジェクトの位置を、新しく生成されたオブジェクトへ引き継がせるために使う
        /// （WorldObject.Place参照）。
        /// </summary>
        internal bool TryInsertAtIndex(WorldObject obj, WorldObject newParent, int slotGlobalId, int index, out string error, bool force = false) =>
            TryPlace(obj, newParent, slotGlobalId, index, out error, force);

        private bool TryPlace(WorldObject obj, WorldObject newParent, int slotGlobalId, int? insertAtIndex, out string error, bool force)
        {
            int localSlot = newParent.Def.SlotLayout.ToLocal(slotGlobalId);
            if (localSlot == LocalIndexMap.Missing)
            {
                error = $"'{newParent.Def.Name}' はスロット(id={slotGlobalId})を持ちません。";
                return false;
            }

            Slot targetSlot = newParent.GetSlotByLocalId(localSlot);
            SlotDef slotDef = targetSlot.Def;

            if (!force && !Accepts(targetSlot, obj))
            {
                error = $"'{newParent.Def.Name}.{slotDef.Name}' は '{obj.Def.Name}' を受け入れられません（accepts制約）。";
                return false;
            }

            if (!force && slotDef.Capacity.HasValue)
            {
                int currentSize = SumSize(targetSlot.Contents);
                int addedSize = obj.GetNumber(wellKnown.SizeId);
                if (currentSize + addedSize > slotDef.Capacity.Value)
                {
                    error = $"'{newParent.Def.Name}.{slotDef.Name}' の容量（{slotDef.Capacity}）を超えます。";
                    return false;
                }
            }

            if (!force && slotDef.UnitCapacity.HasValue && !targetSlot.HasCapacityFor(obj.Def.GlobalId))
            {
                error = $"'{newParent.Def.Name}.{slotDef.Name}' の上限（{slotDef.UnitCapacity}）を超えます。";
                return false;
            }

            DetachFromParent(obj);

            if (insertAtIndex.HasValue)
                targetSlot.InsertAtCapturedPosition(obj, insertAtIndex.Value);
            else
                targetSlot.AddInternal(obj);

            obj.SetParent(newParent, localSlot);
            PropagateWeight(newParent, localSlot, obj.GetNumber(wellKnown.WeightId));
            RegisterEdge(newParent, obj);

            error = null;
            return true;
        }

        /// <summary>
        /// 対象オブジェクトを、現在の親から切り離す（destroy、9.3節）。切り離された時点で
        /// worldツリーから到達不能になり、Tick/PostTickの対象からも自然に外れる（世界に存在する＝
        /// worldの下にぶら下がっている、という前提のため、別途「存在するオブジェクト一覧」は持たない）。
        /// 既に親を持たない場合は何もしない（destroyは繰り返し実行しても安全、6.5節）。
        /// </summary>
        public void Destroy(WorldObject obj) => DetachFromParent(obj);

        private void DetachFromParent(WorldObject obj)
        {
            WorldObject oldParent = obj.Parent;
            if (oldParent == null) return;

            int oldParentSlotLocalId = obj.ParentSlotLocalId;
            oldParent.GetSlotByLocalId(oldParentSlotLocalId).RemoveInternal(obj);
            PropagateWeight(oldParent, oldParentSlotLocalId, -obj.GetNumber(wellKnown.WeightId));
            UnregisterEdge(oldParent, obj);
            obj.SetParent(null, LocalIndexMap.Missing);
        }

        /// <summary>
        /// 親子関係が結ばれた瞬間に、双方の効果（modify/accumulate、8節）を相手側へ登録する。
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

        private bool Accepts(Slot slot, WorldObject candidate)
        {
            IReadOnlyList<SlotAcceptRule> rules = slot.Def.Accepts;
            if (rules.Count == 0) return true; // accepts省略 = 無制限スロット（7.1節）

            foreach (var rule in rules)
            {
                if (!rule.Matches(candidate.Def)) continue;

                int countOfSameType = 0;
                foreach (var existing in slot.Contents)
                    if (rule.Matches(existing.Def)) countOfSameType++;

                if (countOfSameType < rule.Max) return true;
            }
            return false;
        }

        private int SumSize(IReadOnlyList<WorldObject> objects)
        {
            int total = 0;
            foreach (var o in objects) total += o.GetNumber(wellKnown.SizeId);
            return total;
        }

        /// <summary>
        /// ContainerSystem.md 1〜2節: 重さは derived ではなく move_to_slot の副作用として、
        /// 出入りのたびに weight プロパティへ加減算する。祖先を遡りながら各階層の weight_rate を
        /// 掛け合わせていくことで、入れ子（アイテム→バッグ→バックパック→装備）が自然にカスケードする。
        /// weight_rate は端数を持つ倍率（例: 0.5）だが weight プロパティ自体は整数のため、
        /// 各階層へ加算する直前にだけ丸める（伝播中の途中値は端数のまま次の階層の倍率と掛け合わせる）。
        /// </summary>
        private void PropagateWeight(WorldObject startAt, int occupiedSlotLocalId, double delta)
        {
            WorldObject current = startAt;
            int slotLocalId = occupiedSlotLocalId;

            while (current != null)
            {
                SlotDef slotDef = current.Def.SlotDefs[slotLocalId];
                delta *= slotDef.WeightRate;
                current.AddNumber(wellKnown.WeightId, (int)Math.Round(delta));

                if (current.Parent == null) break;
                slotLocalId = current.ParentSlotLocalId;
                current = current.Parent;
            }
        }
    }
}
