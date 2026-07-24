using System;
using UnmappedIsland.Domain.Defs;

namespace UnmappedIsland.Domain.Runtime
{
    /// <summary>WorldObject の一部（スロット移動＝トポロジ）。move_to_slot による所属先の差し替え（旧親からの
    /// 離脱・新親への合流・weight伝播・passive effect edgeの登録・represented_by再判定）に専念する。
    /// accepts/capacity検証は対象 Slot 自身へ委ねる。</summary>
    public sealed partial class WorldObject
    {
        /// <summary>
        /// スロット移動を行う唯一の汎用操作（7.1節の `move_to_slot`）。accepts/capacity/UnitCapacityの検証は
        /// 対象Slot自身（Slot.CanAccept）に委ねる。
        ///
        /// force=true は検証を飛ばして必ず配置を成功させる（spawnのフォールバック、9.4節専用）。
        /// スロット自体が存在しない場合は force でも失敗する。
        /// </summary>
        public bool MoveToSlot(WorldObject newParent, int slotGlobalId, WellKnownProperties wellKnown, out string error, bool force = false) =>
            AttachToSlot(newParent, slotGlobalId, sameSlot: null, wellKnown, out error, force);

        /// <summary>
        /// same_slot専用。置き換えオブジェクトを新規ObjectStackとして、originが居たセルを基準に配置する
        /// （Slot.PlaceSameSlot参照）。FixedPositionsで空きが作れず配置できない場合はfalse
        /// （＝呼び出し側でfallbackへ委ねる）。
        /// </summary>
        public bool InsertSameSlot(WorldObject newParent, int slotGlobalId, SameSlotPlacement placement, WellKnownProperties wellKnown, out string error, bool force = false) =>
            AttachToSlot(newParent, slotGlobalId, placement, wellKnown, out error, force);

        /// <summary>same_slot置き換えの配置指示: originが居たセルの位置と、そのセルに同種が残っているか。</summary>
        public readonly struct SameSlotPlacement
        {
            public readonly int OriginCellIndex;
            public readonly bool KindRemains;

            public SameSlotPlacement(int originCellIndex, bool kindRemains)
            {
                OriginCellIndex = originCellIndex;
                KindRemains = kindRemains;
            }
        }

        private bool AttachToSlot(WorldObject newParent, int slotGlobalId, SameSlotPlacement? sameSlot, WellKnownProperties wellKnown, out string error, bool force)
        {
            int localSlot = newParent.Def.SlotLayout.ToLocal(slotGlobalId);
            if (localSlot == LocalIndexMap.Missing)
            {
                error = $"'{newParent.Def.Name}' はスロット(id={slotGlobalId})を持ちません。";
                return false;
            }

            Slot targetSlot = newParent.GetSlotByLocalId(localSlot);

            if (!force && !targetSlot.CanAccept(this, wellKnown, newParent.Def.Name, out error))
                return false;

            DetachFromParent(wellKnown);

            if (sameSlot.HasValue)
            {
                if (!targetSlot.PlaceSameSlot(this, sameSlot.Value.OriginCellIndex, sameSlot.Value.KindRemains))
                {
                    // FixedPositionsで空きが作れず配置できなかった（呼び出し側でfallbackへ）。既に旧親から
                    // 切り離し済みのため、この場合は未配置（どこにも属さない）で戻す。
                    error = $"'{newParent.Def.Name}.{targetSlot.Def.Name}' に置き換えの空きがありません。";
                    return false;
                }
            }
            else
            {
                targetSlot.AddInternal(this);
            }

            SetParent(newParent, localSlot);
            newParent.PropagateWeightChange(localSlot, GetNumber(wellKnown.WeightId), wellKnown);
            RegisterEdgeWith(newParent, register: true);
            // 祖先対象の登録は、新しい親チェーンが確定した後に行う（DetachFromParentでの解除と対、
            // RegisterAncestorTargetedRecursively参照）。
            RegisterAncestorTargetedRecursively(register: true);

            // 入ったスロットが newParent の represented_by 先なら、newParent の代表チェーンが変わった。
            if (newParent.IsRepresentedBySlot(localSlot))
                newParent.OnRepresentationChanged();

            error = null;
            return true;
        }

        /// <summary>
        /// 現在の親から切り離す（destroy、9.3節）。切り離された時点でworldツリーから到達不能になり、
        /// Tickの対象からも自然に外れる。既に親を持たない場合は何もしない（繰り返し実行しても安全、6.5節）。
        /// </summary>
        public void Destroy(WellKnownProperties wellKnown) => DetachFromParent(wellKnown);

        private void DetachFromParent(WellKnownProperties wellKnown)
        {
            WorldObject oldParent = Parent;
            if (oldParent == null) return;

            // 祖先対象の登録解除は、トポロジが変わる前（旧祖先がまだ辿れるうち）に行う
            // （RegisterAncestorTargetedRecursively参照。再登録はAttachToSlot側）。
            RegisterAncestorTargetedRecursively(register: false);

            int oldParentSlotLocalId = ParentSlotLocalId;
            oldParent.GetSlotByLocalId(oldParentSlotLocalId).RemoveInternal(this);
            oldParent.PropagateWeightChange(oldParentSlotLocalId, -GetNumber(wellKnown.WeightId), wellKnown);
            RegisterEdgeWith(oldParent, register: false);
            SetParent(null, LocalIndexMap.Missing);

            // 抜けたスロットが oldParent の represented_by 先なら、oldParent の代表チェーンが変わった。
            if (oldParent.IsRepresentedBySlot(oldParentSlotLocalId))
                oldParent.OnRepresentationChanged();
        }

        /// <summary>
        /// ContainerSystem.md 1〜2節: 重さは derived ではなく move_to_slot の副作用として、出入りのたびに
        /// 祖先を遡りながら各階層の weight_rate を掛け合わせて weight プロパティへ加減算する。
        /// weight プロパティは整数のため、各階層へ加算する直前にだけ丸める（伝播中の途中値は端数のまま
        /// 次の階層の倍率と掛け合わせる）。常に「対象スロットを持つ自分自身」から呼ぶ。
        /// </summary>
        private void PropagateWeightChange(int occupiedSlotLocalId, double delta, WellKnownProperties wellKnown)
        {
            WorldObject current = this;
            int slotLocalId = occupiedSlotLocalId;

            while (current != null)
            {
                SlotDef slotDef = current.GetSlotByLocalId(slotLocalId).Def;
                delta *= slotDef.WeightRate;
                current.AddNumber(wellKnown.WeightId, (int)Math.Round(delta));

                if (current.Parent == null) break;
                slotLocalId = current.ParentSlotLocalId;
                current = current.Parent;
            }
        }

        /// <summary>
        /// 自分の直接の親から遡り、指定したプロパティを定義している最初の祖先を探す（無ければnull）。
        /// inherit・Target=Ancestor・conditions/weightのAncestor起点が共有する、唯一の祖先探索ロジック。
        /// </summary>
        public WorldObject FindAncestorWithProperty(int propertyGlobalId)
        {
            WorldObject current = Parent;
            while (current != null)
            {
                if (current.Def.PropertyLayout.ToLocal(propertyGlobalId) != LocalIndexMap.Missing)
                    return current;
                current = current.Parent;
            }
            return null;
        }

        /// <summary>自分から親を遡った、所属ツリーの根（通常はworld。未配置なら自分自身）。</summary>
        public WorldObject FindRoot()
        {
            WorldObject current = this;
            while (current.Parent != null) current = current.Parent;
            return current;
        }

        /// <summary>
        /// 自分自身を含む子孫から、指定したInstanceIdを持つWorldObjectを探す（深さ優先、無ければnull）。
        /// 「世界に存在する＝worldツリーに繋がっている」という前提（7.1節）のもと、別途のインスタンス一覧を
        /// 持たずツリー走査だけで解決する。
        /// </summary>
        public WorldObject FindDescendantByInstanceId(int instanceId)
        {
            if (InstanceId == instanceId) return this;

            foreach (Slot slot in slots)
                foreach (WorldObject child in slot.Contents)
                {
                    WorldObject found = child.FindDescendantByInstanceId(instanceId);
                    if (found != null) return found;
                }

            return null;
        }

        /// <summary>
        /// targetのスロットを宣言順に走査し、最初に受け入れられたスロットへ自分自身を移動する
        /// （著者がスロット名を知らなくてよい規約。spawnのintoとmoveが共用、9.4節）。
        /// force=trueは検証を飛ばすため、スロットが1つでもあれば必ず成功する。
        /// </summary>
        public bool MoveIntoFirstAcceptingSlot(WorldObject target, WellKnownProperties wellKnown, bool force = false)
        {
            foreach (SlotDef slotDef in target.Def.EnumerateSlotDefs())
                if (MoveToSlot(target, slotDef.GlobalId, wellKnown, out _, force))
                    return true;

            return false;
        }
    }
}
