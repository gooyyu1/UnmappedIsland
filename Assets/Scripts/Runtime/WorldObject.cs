using System;
using System.Collections.Generic;
using System.Linq;
using UnmappedIsland.Codex;

namespace UnmappedIsland.Runtime
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
        /// on_zeroのadd/destroy/spawnを実行する。destroyをspawnより先に行う（9.3節・9.4節）。カード
        /// スタックのUIでは、種類が変わるアイテムがはみ出さないよう、置き換え後のオブジェクトが
        /// 「破棄されるオブジェクトが占めていた位置」を引き継ぐ必要があるため、destroyで実際に位置が
        /// 空いてから通常の（force無しの）配置を行う。位置情報はdestroyで失われる前に捕捉しておく
        /// （CaptureSameSlotAnchor参照）。on_zeroにはactorが存在しないため、spawnの実行はactor無し
        /// （Actorを対象にしたものは解決できない）で行う。
        /// </summary>
        private void ExecuteOnZeroEffect(ActiveEffect effect, WorldSession session)
        {
            foreach (var delta in effect.Adds)
                AddNumber(delta.PropertyGlobalId, delta.Amount);

            SameSlotAnchor? anchor = effect.Spawn != null && effect.Spawn.Into == SpawnTargetRoot.SameSlot
                ? CaptureSameSlotAnchor(effect.Destroy)
                : null;

            if (effect.Destroy) session.Containment.Destroy(this);

            if (effect.Spawn != null) ExecuteSpawn(effect.Spawn, session, actor: null, anchor);
        }

        /// <summary>
        /// same_slotの置き換え（型が変わりうる）に必要な位置情報を、destroyで失われる前に捕捉する。
        ///
        /// destroyを伴う場合、自分は取り除かれるため、新しいオブジェクトは自分の元の位置（index）へ
        /// そのまま入る。destroyを伴わない場合（自分は生き残ったまま増やす場合）、自分はまだそこに
        /// 居続けるため、新しいオブジェクトは自分の「1つ後ろ」（index+1）へ入れる必要がある。
        /// 両者は区別が必要で、同じindexを使い回すと後者で自分の前に割り込んでしまう。
        ///
        /// FixedPositionsスロットの固定番号も同じ考え方で、destroyによって自分が同種の最後の1個
        /// （=その固定番号が空になる）の場合に限り、その番号をそのまま再利用できる（CanReuseGridCell）。
        /// それ以外（destroyしない・destroyしても同種が残る）は自分の番号+1を起点に、隙間を探して
        /// 割り込ませる必要がある（Place参照）。
        /// </summary>
        private SameSlotAnchor? CaptureSameSlotAnchor(bool willDestroySelf)
        {
            if (Parent == null) return null;

            Slot slot = Parent.GetSlotByLocalId(ParentSlotLocalId);
            int listIndex = slot.IndexOf(this) + (willDestroySelf ? 0 : 1);

            int? gridCellIndex = null;
            bool canReuseGridCell = false;
            if (slot.Def.FixedPositions)
            {
                gridCellIndex = slot.GetGridIndex(Def.GlobalId);
                canReuseGridCell = willDestroySelf && slot.CountOfType(Def.GlobalId) == 1;
            }

            return new SameSlotAnchor(Parent, ParentSlotLocalId, listIndex, gridCellIndex, canReuseGridCell);
        }

        /// <summary>
        /// spawn（9.4節）を実行する。fallbackはYAML側に存在せず、Intoへの配置に失敗した場合は必ず
        /// 起点自身の親へ伝播し、accepts/capacityを無視して強制的に配置する（Place参照）。伝播先の
        /// 親も無い場合、生成したオブジェクトはどこにも配置されないまま消える（worldツリーに繋がらない
        /// ため存在しないのと同じ）。
        /// </summary>
        private void ExecuteSpawn(SpawnEffect effect, WorldSession session, WorldObject actor, SameSlotAnchor? anchor)
        {
            WorldObject spawned = session.Spawn(effect.ObjectGlobalId);
            Place(spawned, effect.Into, session, actor, anchor);
        }

        /// <summary>
        /// spawnした側は配置先のスロット名を書かない。SameSlotなら、捕捉しておいた位置（親・スロット・
        /// 元の位置）へそのまま配置する（一意に決まるため走査は行わない）。
        ///
        /// FixedPositionsスロットでは、新しい型が既に同じスロットに存在する（同種スタックへの合流）
        /// 場合はそのまま通常配置し、そうでなければ、自分の固定番号をそのまま再利用できる場合
        /// （CanReuseGridCell、自分がdestroyされ同種の最後の1個だった場合）はその番号へ、できない場合
        /// （destroyしない・destroyしても同種が残る場合）は自分の番号の右側（+1以降）で最初に見つかる
        /// 隙間へ、他の型を押し出しながら割り込ませる。右側に隙間が無ければ、左側（-1以前）で同様に
        /// 割り込ませる（「右が空いている限り右に、そうでなければ左に生まれる」、Slot.TryMakeRoomAndSeed
        /// 参照）。どちらの方向にも隙間が見つからなければ配置失敗として扱い、後述のfallbackへ委ねる。
        ///
        /// それ以外の一般スロットでは、捕捉しておいたリストindexへ直接挿入する（同じ場所の後ろに
        /// いた他のオブジェクトの位置がずれないようにするため）。
        ///
        /// Self/Actorなら、解決できた対象オブジェクトが持つスロットを宣言順（Def.SlotDefsの並び）に
        /// 走査し、最初に配置できたスロットへ入れる。
        ///
        /// 配置に失敗した場合は、必ずその起点自身の親へ伝播し、accepts/capacityを無視して
        /// 強制的に配置する（先頭のスロットへ必ず入る）。伝播先の親も無ければ何もしない。
        /// </summary>
        private void Place(WorldObject spawned, SpawnTargetRoot into, WorldSession session, WorldObject actor, SameSlotAnchor? anchor)
        {
            WorldObject primaryTarget;
            bool placed;

            if (into == SpawnTargetRoot.SameSlot)
            {
                if (anchor == null) return;
                SameSlotAnchor a = anchor.Value;
                primaryTarget = a.Parent;
                Slot slot = a.Parent.GetSlotByLocalId(a.ParentSlotLocalId);

                if (slot.Def.FixedPositions && !slot.GetGridIndex(spawned.Def.GlobalId).HasValue)
                {
                    if (a.CanReuseGridCell)
                    {
                        slot.SeedGridIndex(spawned.Def.GlobalId, a.GridCellIndex.Value);
                        placed = true;
                    }
                    else
                    {
                        placed = slot.TryMakeRoomAndSeed(spawned.Def.GlobalId, a.GridCellIndex.Value);
                    }

                    if (placed)
                        placed = session.Containment.TryMoveToSlot(spawned, a.Parent, slot.Def.GlobalId, out _, force: false);
                }
                else if (slot.Def.FixedPositions)
                {
                    // 新しい型が既にこのスロットに存在する（同種スタックへの合流）。番号操作は不要。
                    placed = session.Containment.TryMoveToSlot(spawned, a.Parent, slot.Def.GlobalId, out _, force: false);
                }
                else
                {
                    placed = session.Containment.TryInsertAtIndex(spawned, a.Parent, slot.Def.GlobalId, a.ListIndex, out _, force: false);
                }
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

        /// <summary>CaptureSameSlotAnchorが捕捉する、destroy前時点での位置のスナップショット。</summary>
        private readonly struct SameSlotAnchor
        {
            public readonly WorldObject Parent;
            public readonly int ParentSlotLocalId;
            public readonly int ListIndex;

            /// <summary>FixedPositionsスロットでのみ使う、自分自身の固定番号（該当スロットでなければnull）。</summary>
            public readonly int? GridCellIndex;

            /// <summary>自分の固定番号を新しいオブジェクトがそのまま再利用できるか
            /// （destroyされ、かつ自分が同種の最後の1個だった場合のみtrue）。</summary>
            public readonly bool CanReuseGridCell;

            public SameSlotAnchor(WorldObject parent, int parentSlotLocalId, int listIndex, int? gridCellIndex, bool canReuseGridCell)
            {
                Parent = parent;
                ParentSlotLocalId = parentSlotLocalId;
                ListIndex = listIndex;
                GridCellIndex = gridCellIndex;
                CanReuseGridCell = canReuseGridCell;
            }
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
