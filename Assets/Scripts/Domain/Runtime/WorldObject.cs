using System.Linq;
using UnmappedIsland.Domain.Defs;

namespace UnmappedIsland.Domain.Runtime
{
    /// <summary>
    /// 実行時のオブジェクト実体（ObjectDef のインスタンス）。
    ///
    /// プロパティの現在値・スロットの中身は、Def 側のローカルIDをそのままindexとする密配列として保持する。
    /// プロパティへ登録された効果の一覧・tick毎の反映・実効値の算出は PropertyValue が持ち、WorldObject は
    /// ローカルID解決とグローバルAPIの提供に専念する。
    ///
    /// 関心事ごとに partial で分割している（WorldObject.Properties/Topology/Representation/PassiveEffects/
    /// ActiveEffects.cs）。本ファイルは中核の状態と、スロット/親アクセサを持つ。
    /// </summary>
    public sealed partial class WorldObject
    {
        public int InstanceId { get; }
        public ObjectDef Def { get; }

        // ローカルindexで並ぶ密配列。それぞれ Def.propertyDefs / Def.slotDefs と対になる。
        private readonly PropertyValue[] properties;
        private readonly Slot[] slots;

        /// <summary>所属先（7.1節）。ルート（未格納）なら null。</summary>
        public WorldObject Parent { get; private set; }

        /// <summary>Parent の中で自分が入っているスロットのローカルID。Parent が null なら Missing。</summary>
        public int ParentSlotLocalId { get; private set; } = LocalIndexMap.Missing;

        /// <summary>session は必須（value:{min,max} を持つプロパティの初期値ランダム化に session.Rng を使う）。</summary>
        public WorldObject(int instanceId, ObjectDef def, WorldSession session)
        {
            InstanceId = instanceId;
            Def = def;

            properties = def.EnumeratePropertyDefs()
                .Select(pd => pd.CreateValue(this, session))
                .ToArray();

            slots = def.EnumerateSlotDefs()
                .Select(sd => new Slot(sd))
                .ToArray();

            // 生成時はまだトポロジが無いため、Self関係のみ登録する。Parent/Child/AncestorはMoveToSlot以降に
            // 登録される。
            def.Passives.RegisterRelation(this, ReferenceRoot.Self, register: true);
        }

        public bool TryGetSlot(int globalSlotId, out Slot slot)
        {
            int local = Def.SlotLayout.ToLocal(globalSlotId);
            if (local == LocalIndexMap.Missing)
            {
                slot = null;
                return false;
            }
            slot = slots[local];
            return true;
        }

        public Slot GetSlotByLocalId(int localId) => slots[localId];

        public void SetParent(WorldObject parent, int parentSlotLocalId)
        {
            Parent = parent;
            ParentSlotLocalId = parentSlotLocalId;
        }
    }
}
