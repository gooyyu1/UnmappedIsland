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
        /// スロット移動を行う唯一の汎用操作（GameElementDefinition.md 7.1節の `move_to_slot`）。
        /// accepts/capacity/UnitCapacityの検証は新しい親の対象Slot自身（Slot.CanAccept）に委ね、
        /// このメソッドは「自分の所属先を差し替える」こと自体（旧親からの離脱・新親への合流・
        /// weightの伝播・passive effect edgeの登録）にのみ専念する（自分のことは自分でする、CLAUDE.md参照）。
        ///
        /// force=true の場合、accepts/capacity/UnitCapacityの検証を飛ばして必ず配置を成功させる（spawnの
        /// フォールバック、9.4節専用。すべてのオブジェクトは必ずどこかの親に属さなければならないという
        /// 前提を、退避先で保証するために使う）。スロット自体が存在しない場合は force でも失敗する
        /// （存在しない配列indexへは置けないため）。
        /// </summary>
        public bool MoveToSlot(WorldObject newParent, int slotGlobalId, WellKnownProperties wellKnown, out string error, bool force = false) =>
            AttachToSlot(newParent, slotGlobalId, sameSlot: null, wellKnown, out error, force);

        /// <summary>
        /// same_slot専用。通常の（同種のObjectStackへ合流する）配置ロジックを使わず、置き換えオブジェクトを
        /// 新規ObjectStackとして、originが居たセルを基準に配置する（Slot.PlaceSameSlot参照）。破棄された
        /// オブジェクトの位置を、新しく生成されたオブジェクトへ引き継がせるために使う（Place参照）。
        /// FixedPositionsで空きが作れず配置できない場合はfalse（＝呼び出し側でfallbackへ委ねる）。
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
            RegisterEdgeWith(newParent);
            // トポロジが変わった後（新しい親チェーンが確定した後）に、祖先対象の登録を（this＋子孫について）
            // 現在の祖先へ登録する。DetachFromParentでの解除と対になり、Refresh（前回の登録先の記憶）が要らない。
            SyncAncestorTargetedRecursively(register: true);

            // 入ったスロットが newParent の represented_by 先なら、newParent の代表チェーンが変わった。
            // newParent 自身のスタック所属を再判定させ、必要なら上位へ連鎖させる（OnRepresentationChanged）。
            if (newParent.IsRepresentedBySlot(localSlot))
                newParent.OnRepresentationChanged();

            error = null;
            return true;
        }

        /// <summary>
        /// 対象オブジェクトを、現在の親から切り離す（destroy、9.3節）。切り離された時点で
        /// worldツリーから到達不能になり、Tickの対象からも自然に外れる（世界に存在する＝
        /// worldの下にぶら下がっている、という前提のため、別途「存在するオブジェクト一覧」は持たない）。
        /// 既に親を持たない場合は何もしない（destroyは繰り返し実行しても安全、6.5節）。
        /// </summary>
        public void Destroy(WellKnownProperties wellKnown) => DetachFromParent(wellKnown);

        private void DetachFromParent(WellKnownProperties wellKnown)
        {
            WorldObject oldParent = Parent;
            if (oldParent == null) return;

            // トポロジが変わる前に、祖先対象の登録を（this＋子孫について）現在の祖先から解除しておく。
            // 変わる前なので旧祖先はまだownerから辿れ、変わった後に再登録するため「前回どこへ登録したか」を
            // 憶えておく必要がない（再登録はAttachToSlot側、または破棄ならそもそも不要）。
            SyncAncestorTargetedRecursively(register: false);

            int oldParentSlotLocalId = ParentSlotLocalId;
            oldParent.GetSlotByLocalId(oldParentSlotLocalId).RemoveInternal(this);
            oldParent.PropagateWeightChange(oldParentSlotLocalId, -GetNumber(wellKnown.WeightId), wellKnown);
            UnregisterEdgeWith(oldParent);
            SetParent(null, LocalIndexMap.Missing);

            // 抜けたスロットが oldParent の represented_by 先なら、oldParent の代表チェーンが変わった。
            // oldParent 自身のスタック所属を再判定させ、必要なら上位へ連鎖させる（OnRepresentationChanged）。
            if (oldParent.IsRepresentedBySlot(oldParentSlotLocalId))
                oldParent.OnRepresentationChanged();
        }

        /// <summary>
        /// ContainerSystem.md 1〜2節: 重さは derived ではなく move_to_slot の副作用として、出入りのたびに
        /// weight プロパティへ加減算する。自分自身から祖先を遡りながら各階層の weight_rate を
        /// 掛け合わせていくことで、入れ子（アイテム→バッグ→バックパック→装備）が自然にカスケードする。
        /// weight_rate は端数を持つ倍率（例: 0.5）だが weight プロパティ自体は整数のため、
        /// 各階層へ加算する直前にだけ丸める（伝播中の途中値は端数のまま次の階層の倍率と掛け合わせる）。
        /// このメソッドは常に「対象スロットを持つ自分自身」から呼ばれ、以降は自分の祖先だけを辿る
        /// （newParent.PropagateWeightChange(...) / oldParent.PropagateWeightChange(...) という
        /// 呼び方をするのはそのため）。
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
        /// 自分の直接の親から遡り、指定したグローバルプロパティIDを定義している最初の祖先を探す
        /// （inherit・Target=Ancestor・conditions/weightのAncestor起点が共有する、唯一の祖先探索ロジック）。
        /// 見つからなければnull。すべてのオブジェクトは必ずworldを根とするツリーに属し、循環はしないため、
        /// このループは木の深さに収まる（GameElementDefinition.md 7.1節）。
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
    }
}
