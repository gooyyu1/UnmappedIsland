using System.Linq;
using UnmappedIsland.Domain.Defs;

namespace UnmappedIsland.Domain.Runtime
{
    /// <summary>
    /// 実行時のオブジェクト実体（ObjectDef のインスタンス）。WorldCodex 全体の呼称に合わせ、
    /// "Object"（言語組み込みの System.Object 等と衝突する）や汎用OOP用語の "Instance" を避けて命名している。
    ///
    /// プロパティの現在値・スロットの中身は、いずれも Def 側のローカルIDをそのままindexとする
    /// 密配列として保持する（グローバルIDでの辞書引きは行わない）。プロパティへ登録された効果
    /// （modify/accumulate）の一覧・tick毎の反映・実効値の算出は、対象がプロパティ自身であるため
    /// PropertyValue が持つ。WorldObjectはローカルID解決とグローバルAPIの提供に専念する。
    ///
    /// クラスが大きいため関心事ごとに partial で分割している（WorldObject.Properties/Topology/
    /// Representation/PassiveEffects/ActiveEffects.cs）。本ファイルは identity・密配列・親リンクといった
    /// 中核の状態と、スロット/親アクセサを持つ。
    /// </summary>
    public sealed partial class WorldObject
    {
        public int InstanceId { get; }
        public ObjectDef Def { get; }

        // ローカルindexで並ぶ密配列。それぞれ Def.propertyDefs / Def.slotDefs と対になる。
        private readonly PropertyValue[] properties;
        private readonly Slot[] slots;

        /// <summary>所属先（7.1節）。子は必ず1つの親に属する。ルート（未格納）なら null。</summary>
        public WorldObject Parent { get; private set; }

        /// <summary>Parent の中で自分が入っているスロットのローカルID。Parent が null なら Missing。</summary>
        public int ParentSlotLocalId { get; private set; } = LocalIndexMap.Missing;

        /// <summary>session は生成文脈。value:{min,max} を持つプロパティの初期値ランダム化に session.Rng を
        /// 使う（spawn時はそのセッションを渡す）。WorldObjectは常に何らかのセッションの下で生成されるため、
        /// sessionは必須。</summary>
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

            // 生成時はまだトポロジが無いため、自分自身との関係（Self）だけを伝える。相手はowner自身なので
            // 渡さない（効果がSelfのときだけ自分自身へ登録する）。Parent/Child/AncestorはMoveToSlot以降の
            // エッジ形成/祖先再解決で登録される。
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
