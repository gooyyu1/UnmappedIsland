using System;
using System.Collections.Generic;
using System.Linq;
using UnmappedIsland.Codex.Defs;
using UnmappedIsland.Codex.Registry;

namespace UnmappedIsland.Codex.Runtime
{
    /// <summary>
    /// 実行時のオブジェクト実体（ObjectDef のインスタンス）。WorldCodex 全体の呼称に合わせ、
    /// "Object"（言語組み込みの System.Object 等と衝突する）や汎用OOP用語の "Instance" を避けて命名している。
    ///
    /// プロパティの現在値・スロットの中身は、いずれも Def 側のローカルIDをそのままindexとする
    /// 密配列として保持する（グローバルIDでの辞書引きは行わない）。プロパティへ登録された効果
    /// （modify/accumulate）の一覧・tick毎の反映・実効値の算出は、対象がプロパティ自身であるため
    /// PropertyValue が持つ。WorldObjectはローカルID解決とグローバルAPIの提供に専念する。
    /// </summary>
    public sealed class WorldObject
    {
        public int InstanceId { get; }
        public ObjectDef Def { get; }

        // ローカルindexで並ぶ密配列。それぞれ Def.PropertyDefs / Def.SlotDefs と対になる。
        private readonly PropertyValue[] properties;
        private readonly Slot[] slots;

        /// <summary>所属先（7.1節）。子は必ず1つの親に属する。ルート（未格納）なら null。</summary>
        public WorldObject Parent { get; private set; }

        /// <summary>Parent の中で自分が入っているスロットのローカルID。Parent が null なら Missing。</summary>
        public int ParentSlotLocalId { get; private set; } = LocalIndexMap.Missing;

        public WorldObject(int instanceId, ObjectDef def)
        {
            InstanceId = instanceId;
            Def = def;

            properties = new PropertyValue[def.PropertyDefs.Count];
            for (int i = 0; i < properties.Length; i++)
                properties[i] = def.PropertyDefs[i].DefaultValue.Clone();

            slots = new Slot[def.SlotDefs.Count];
            for (int i = 0; i < slots.Length; i++)
                slots[i] = new Slot(def.SlotDefs[i]);

            foreach (var c in def.Contributions)
            {
                if (c.Target != ContributionTarget.Self) continue;
                int local = Def.PropertyLayout.ToLocal(c.TargetPropertyGlobalId);
                if (local == LocalIndexMap.Missing) continue;
                RegisterContribution(local, new ActiveContribution(declarer: this, slotBearer: this, def: c));
            }
        }

        public bool TryGetProperty(int globalPropertyId, out PropertyValue value)
        {
            int local = Def.PropertyLayout.ToLocal(globalPropertyId);
            if (local == LocalIndexMap.Missing)
            {
                value = null;
                return false;
            }
            value = properties[local];
            return true;
        }

        /// <summary>登録済みのIncoming（modify/accumulate）はそのまま、値の中身だけを差し替える。</summary>
        public void SetProperty(int globalPropertyId, PropertyValue value)
        {
            int local = Def.PropertyLayout.ToLocal(globalPropertyId);
            if (local == LocalIndexMap.Missing)
                throw new InvalidOperationException($"'{Def.Name}' はプロパティ(id={globalPropertyId})を持ちません。");
            properties[local].CopyValueFrom(value);
        }

        public int GetNumber(int globalPropertyId, int fallback = 0)
        {
            return TryGetProperty(globalPropertyId, out var v) ? v.AsNumber(fallback) : fallback;
        }

        /// <summary>
        /// 数値プロパティへの不可逆な加減算（GameElementDefinition.md 9.2節の `add`、ContainerSystem.md の重さ伝播で使用）。
        /// このオブジェクトが対象プロパティを持たない場合は何もしない（例: 重さを気にしない置物）。
        /// </summary>
        public void AddNumber(int globalPropertyId, int delta)
        {
            int local = Def.PropertyLayout.ToLocal(globalPropertyId);
            if (local == LocalIndexMap.Missing) return;
            properties[local].Add(delta);
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

        internal Slot GetSlotByLocalId(int localId) => slots[localId];

        internal void SetParent(WorldObject parent, int parentSlotLocalId)
        {
            Parent = parent;
            ParentSlotLocalId = parentSlotLocalId;
        }

        /// <summary>Declarer自身のObjectDefに対してのみ有効なローカルID直読み（WhenOwnStageゲート専用、6.4節・8節）。</summary>
        internal int GetNumberByLocalId(int localId) => properties[localId].AsNumber();

        internal void RegisterContribution(int localPropertyId, ActiveContribution contribution)
        {
            properties[localPropertyId].RegisterContribution(contribution);
        }

        internal void UnregisterContributionsFrom(WorldObject declarer, int localPropertyId)
        {
            properties[localPropertyId].UnregisterContributionsFrom(declarer);
        }

        /// <summary>
        /// modify（Kind.Modify）のみを加味した実効値（8.3節）。可逆な寄与であり、実体値そのものは書き換えない。
        /// target(self/parent/child)の違いはRegisterContribution呼び出し側（WorldObjectコンストラクタ・
        /// Containment）にのみ存在し、ここでは一切区別しない。Kind.Accumulateの寄与はTick参照。
        /// </summary>
        public int GetEffectiveValue(int propertyGlobalId)
        {
            int local = Def.PropertyLayout.ToLocal(propertyGlobalId);
            if (local == LocalIndexMap.Missing) return 0;
            return properties[local].GetEffectiveValue(Def.PropertyDefs[local].Range);
        }

        /// <summary>
        /// accumulate（Kind.Accumulate）を実体値へ加減算する（8.4節、不可逆）。自分自身のプロパティに
        /// 適用した後、子（すべてのスロットの中身）へ再帰する。すべてのオブジェクトは必ずworldの下に
        /// ぶら下がるため（「別途『世界に存在するすべてのオブジェクト』一覧は持たない」という前提）、
        /// worldに対して1回 Tick を呼ぶだけでツリー全体のaccumulateが実行される。
        ///
        /// destroy/spawnはここでは行わない（PostTick参照）。Tick中はツリー構造を変更しないため、
        /// 子の列挙にスナップショットは不要。
        /// </summary>
        public void Tick()
        {
            foreach (var p in properties) p.Tick();

            foreach (var slot in slots)
                foreach (var child in slot.Contents)
                    child.Tick();
        }

        /// <summary>
        /// on_zero（6.5節）が発火条件を満たすプロパティがあれば、そのadd/destroy/spawnを実行する。
        /// Tickとは別の、時間経過後の「値によるイベント処理」のパスとして分離しており（PropertyValue.PostTick
        /// 参照）、accumulateの結果がすべて確定してから存在操作を行う。自分自身の判定・実行の後、子へ
        /// 再帰する。
        ///
        /// destroy/spawnはこの再帰中にツリー構造（スロットの中身）を変更しうるため、各スロットの中身は
        /// 列挙前にスナップショットを取る（列挙中に自分自身や兄弟がdestroyされても安全なようにするため）。
        /// </summary>
        public void PostTick(WorldSession session)
        {
            for (int local = 0; local < properties.Length; local++)
            {
                ActiveEffect effect = properties[local].PostTick(Def.PropertyDefs[local].OnZero);
                if (effect != null) ExecuteOnZeroEffect(effect, session);
            }

            foreach (var slot in slots)
                foreach (var child in slot.Contents.ToArray())
                    child.PostTick(session);
        }

        /// <summary>
        /// on_zeroのadd/destroy/spawnを実行する。spawnをdestroyより先に行うのは、spawnのintoが
        /// parentや「省略時の既定動作（自分の現在の所属先）」を参照できる必要があり、destroy後は
        /// 自分のParentがnullになってしまうため。on_zeroにはactorが存在しないため、spawnの実行は
        /// actor無し（Actor/ActorParentを対象にしたものは解決できない）で行う。
        /// </summary>
        private void ExecuteOnZeroEffect(ActiveEffect effect, WorldSession session)
        {
            foreach (var delta in effect.Adds)
                AddNumber(delta.PropertyGlobalId, delta.Amount);

            if (effect.Spawn != null) ExecuteSpawn(effect.Spawn, session, actor: null);

            if (effect.Destroy) session.Containment.Destroy(this);
        }

        /// <summary>
        /// spawn（9.4節）を実行する。fallbackはYAML側に存在せず、Intoへの配置に失敗した場合は必ず
        /// 起点自身の親へ伝播し、accepts/capacityを無視して強制的に配置する（Place参照）。伝播先の
        /// 親も無い場合、生成したオブジェクトはどこにも配置されないまま消える（worldツリーに繋がらない
        /// ため存在しないのと同じ）。
        /// </summary>
        private void ExecuteSpawn(SpawnEffect effect, WorldSession session, WorldObject actor)
        {
            WorldObject spawned = session.Spawn(effect.ObjectGlobalId);
            Place(spawned, effect.Into, session, actor);
        }

        /// <summary>
        /// spawnした側は配置先のスロット名を書かない。SameSlotなら、自分が今いる、まさにその場所
        /// （親と、自分が現在占めているのと同じスロット）へそのまま配置する（一意に決まるため走査は
        /// 行わない）。Self/Actorなら、解決できた対象オブジェクトが持つスロットを宣言順
        /// （Def.SlotDefsの並び）に走査し、最初に配置できたスロットへ入れる。
        ///
        /// 配置に失敗した場合は、必ずその起点自身の親へ伝播し、accepts/capacityを無視して
        /// 強制的に配置する（先頭のスロットへ必ず入る）。伝播先の親も無ければ何もしない。
        /// </summary>
        private void Place(WorldObject spawned, SpawnTargetRoot into, WorldSession session, WorldObject actor)
        {
            WorldObject primaryTarget;
            bool placed;

            if (into == SpawnTargetRoot.SameSlot)
            {
                if (Parent == null) return;
                primaryTarget = Parent;
                int slotGlobalId = Parent.Def.SlotDefs[ParentSlotLocalId].GlobalId;
                placed = session.Containment.TryMoveToSlot(spawned, Parent, slotGlobalId, out _, force: false);
            }
            else
            {
                primaryTarget = into == SpawnTargetRoot.Self ? this : actor;
                if (primaryTarget == null) return;
                placed = TryFirstAcceptingSlot(spawned, primaryTarget, session, force: false);
            }

            if (placed) return;
            if (primaryTarget.Parent == null) return;

            TryFirstAcceptingSlot(spawned, primaryTarget.Parent, session, force: true);
        }

        /// <summary>targetが持つスロットを宣言順に走査し、最初に配置できたスロットへ入れる。
        /// force=trueはaccepts/capacityの検証を飛ばすため、スロットが1つでもあれば必ず成功する。</summary>
        private static bool TryFirstAcceptingSlot(WorldObject spawned, WorldObject target, WorldSession session, bool force)
        {
            foreach (var slotDef in target.Def.SlotDefs)
                if (session.Containment.TryMoveToSlot(spawned, target, slotDef.GlobalId, out _, force))
                    return true;

            return false;
        }

        /// <summary>
        /// 現在このプロパティに登録されている全寄与（modify/accumulate両方）を列挙する。
        /// 「このプロパティに何が影響しているか」をUIで表示したい場合に使う。ゲートが現在有効かどうかは
        /// 呼び出し側で ActiveContribution.IsActive() 相当の判定をしたい場合、Kind別にGetEffectiveValue/Tickの
        /// 結果と突き合わせる。
        /// </summary>
        public IReadOnlyList<ActiveContribution> GetIncomingContributions(int propertyGlobalId)
        {
            int local = Def.PropertyLayout.ToLocal(propertyGlobalId);
            if (local == LocalIndexMap.Missing) return Array.Empty<ActiveContribution>();
            return properties[local].Incoming;
        }
    }
}
