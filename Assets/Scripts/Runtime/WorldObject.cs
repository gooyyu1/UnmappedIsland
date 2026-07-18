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
                properties[i] = PropertyValue.Create(def.PropertyDefs[i].DefaultNumber, def.PropertyDefs[i], this);

            slots = new Slot[def.SlotDefs.Count];
            for (int i = 0; i < slots.Length; i++)
                slots[i] = new Slot(def.SlotDefs[i]);

            foreach (var c in def.Passives)
            {
                if (c.Target != PassiveEffectTarget.Self) continue;
                int local = Def.PropertyLayout.ToLocal(c.TargetPropertyGlobalId);
                if (local == LocalIndexMap.Missing) continue;
                RegisterPassiveEffect(local, new RegisteredPassiveEffect(declarer: this, slotBearer: this, def: c));
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
            return TryGetProperty(globalPropertyId, out var v) ? v.AsNumber() : fallback;
        }

        /// <summary>
        /// 数値プロパティへの不可逆な加減算（GameElementDefinition.md 9.2節の `add`、ContainerSystem.md の重さ伝播で使用）。
        /// このオブジェクトが対象プロパティを持たない場合は何もしない（例: 重さを気にしない置物）。
        ///
        /// プロパティ解決だけがこのメソッドの責務で、値の変更・range判定（on_overflow等）はすべて
        /// PropertyValue.Add自身に委ねる（自分のことは自分でする、CLAUDE.md参照）。sessionを渡さない
        /// 呼び出しは、その場では判定を行わない（既存の「後で明示的にTick()を呼んで判定させる」
        /// 呼び出し方との後方互換のため）。
        /// </summary>
        public void AddNumber(int globalPropertyId, int delta, WorldSession session = null)
        {
            if (!TryGetProperty(globalPropertyId, out var value)) return;
            value.Add(delta, session);
        }

        /// <summary>
        /// 数値プロパティへの不可逆な絶対値代入（GameElementDefinition.md 9.2節の`set`）。addとは異なり、
        /// 既存の値を無視して指定した値でそのまま置き換える。このオブジェクトが対象プロパティを
        /// 持たない場合は何もしない（AddNumberと同じ規約）。プロパティ解決だけがこのメソッドの責務で、
        /// 差分計算・range判定はすべてPropertyValue.SetNumber自身に委ねる。
        /// </summary>
        public void SetNumber(int globalPropertyId, int value, WorldSession session = null)
        {
            if (!TryGetProperty(globalPropertyId, out var property)) return;
            property.SetNumber(value, session);
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
            AttachToSlot(newParent, slotGlobalId, insertAtIndex: null, wellKnown, out error, force);

        /// <summary>
        /// same_slot専用。通常の（同種のrunへソート挿入する）配置ロジックを使わず、指定した位置へ
        /// そのまま挿入する。破棄されたオブジェクトの位置を、新しく生成されたオブジェクトへ引き継がせるために使う
        /// （Place参照）。
        /// </summary>
        internal bool InsertAtIndex(WorldObject newParent, int slotGlobalId, int index, WellKnownProperties wellKnown, out string error, bool force = false) =>
            AttachToSlot(newParent, slotGlobalId, index, wellKnown, out error, force);

        private bool AttachToSlot(WorldObject newParent, int slotGlobalId, int? insertAtIndex, WellKnownProperties wellKnown, out string error, bool force)
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

            if (insertAtIndex.HasValue)
                targetSlot.InsertAtCapturedPosition(this, insertAtIndex.Value);
            else
                targetSlot.AddInternal(this);

            SetParent(newParent, localSlot);
            newParent.PropagateWeightChange(localSlot, GetNumber(wellKnown.WeightId), wellKnown);
            RegisterEdgeWith(newParent);

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

            int oldParentSlotLocalId = ParentSlotLocalId;
            oldParent.GetSlotByLocalId(oldParentSlotLocalId).RemoveInternal(this);
            oldParent.PropagateWeightChange(oldParentSlotLocalId, -GetNumber(wellKnown.WeightId), wellKnown);
            UnregisterEdgeWith(oldParent);
            SetParent(null, LocalIndexMap.Missing);
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
                SlotDef slotDef = current.Def.SlotDefs[slotLocalId];
                delta *= slotDef.WeightRate;
                current.AddNumber(wellKnown.WeightId, (int)Math.Round(delta));

                if (current.Parent == null) break;
                slotLocalId = current.ParentSlotLocalId;
                current = current.Parent;
            }
        }

        /// <summary>
        /// 親子関係が結ばれた瞬間に、双方の効果（modify/accumulate、8節）を相手側へ登録する。
        /// target=Parent（自分の効果が親へ及ぶ、例: 防具の`passive.parent`）は親へ、
        /// target=Child（親の効果が自分へ及ぶ）は自分へ登録する。target=Selfは各WorldObjectの
        /// コンストラクタで既に登録済みのため、ここでは扱わない。kind(modify/accumulate)は登録先を
        /// 選ぶ判断に一切影響しない（評価側でのみ区別される）。
        /// </summary>
        private void RegisterEdgeWith(WorldObject parent)
        {
            foreach (var c in Def.Passives)
            {
                if (c.Target != PassiveEffectTarget.Parent) continue;
                int local = parent.Def.PropertyLayout.ToLocal(c.TargetPropertyGlobalId);
                if (local == LocalIndexMap.Missing) continue;
                parent.RegisterPassiveEffect(local, new RegisteredPassiveEffect(declarer: this, slotBearer: this, def: c));
            }

            foreach (var c in parent.Def.Passives)
            {
                if (c.Target != PassiveEffectTarget.Child) continue;
                int local = Def.PropertyLayout.ToLocal(c.TargetPropertyGlobalId);
                if (local == LocalIndexMap.Missing) continue;
                RegisterPassiveEffect(local, new RegisteredPassiveEffect(declarer: parent, slotBearer: this, def: c));
            }
        }

        private void UnregisterEdgeWith(WorldObject parent)
        {
            foreach (var c in Def.Passives)
            {
                if (c.Target != PassiveEffectTarget.Parent) continue;
                int local = parent.Def.PropertyLayout.ToLocal(c.TargetPropertyGlobalId);
                if (local == LocalIndexMap.Missing) continue;
                parent.UnregisterPassiveEffectsFrom(this, local);
            }

            foreach (var c in parent.Def.Passives)
            {
                if (c.Target != PassiveEffectTarget.Child) continue;
                int local = Def.PropertyLayout.ToLocal(c.TargetPropertyGlobalId);
                if (local == LocalIndexMap.Missing) continue;
                UnregisterPassiveEffectsFrom(parent, local);
            }
        }

        /// <summary>Declarer自身のObjectDefに対してのみ有効なローカルID直読み（WhenOwnStageゲート専用、6.4節・8節）。</summary>
        internal int GetNumberByLocalId(int localId) => properties[localId].AsNumber();

        internal void RegisterPassiveEffect(int localPropertyId, RegisteredPassiveEffect effect)
        {
            properties[localPropertyId].RegisterPassiveEffect(effect);
        }

        internal void UnregisterPassiveEffectsFrom(WorldObject declarer, int localPropertyId)
        {
            properties[localPropertyId].UnregisterPassiveEffectsFrom(declarer);
        }

        /// <summary>
        /// modify（Kind.Modify）のみを加味した実効値（8.3節）。可逆な寄与であり、実体値そのものは書き換えない。
        /// target(self/parent/child)の違いはRegisterPassiveEffect呼び出し側（WorldObjectコンストラクタ・
        /// RegisterEdgeWith）にのみ存在し、ここでは一切区別しない。Kind.Accumulateの寄与はTick参照。
        /// </summary>
        public int GetEffectiveValue(int propertyGlobalId)
        {
            return TryGetProperty(propertyGlobalId, out var value) ? value.GetEffectiveValue() : 0;
        }

        /// <summary>
        /// accumulate（Kind.Accumulate）を実体値へ加減算し（8.4節、不可逆）、on_max・on_min（6.5節・6.6節）・
        /// on_overflow・on_shortfall（6.3節）の判定・実行までを、プロパティごとに自分自身で完結させる
        /// （PropertyValue.Tick参照。いつ・どのプロパティが範囲外になったかの判断はすべてそちらにあり、
        /// WorldObjectは既存のApplyActiveEffect（すべて同じ適用経路）を提供するだけで、overflow専用の
        /// 処理は一切持たない）。自分自身の処理の後、子（すべてのスロットの中身）へ再帰する。すべての
        /// オブジェクトは必ずworldの下にぶら下がるため（「別途『世界に存在するすべてのオブジェクト』一覧は
        /// 持たない」という前提）、worldに対して1回 Tick を呼ぶだけでツリー全体が処理される。
        ///
        /// on_max/on_min/on_overflow/on_shortfallのdestroy/spawnは、この処理の最中に自分自身や兄弟をツリーから
        /// 切り離しうる。各スロットの中身は列挙前にスナップショットを取ることで、列挙中に自分自身や兄弟が
        /// destroyされても安全なようにしている。
        /// </summary>
        public void Tick(WorldSession session)
        {
            for (int local = 0; local < properties.Length; local++)
                properties[local].Tick(session);

            foreach (var slot in slots)
                foreach (var child in slot.Contents.ToArray())
                    child.Tick(session);
        }

        /// <summary>
        /// このオブジェクトをself(このインスタンス自身)として、set/add/destroy/spawnを実行する（9.2〜9.4節）。
        /// on_max・on_min・on_overflow・on_shortfall（6節）と、actions/combinations（11節・12節）のactive/pickが
        /// 解決した結果の両方から呼ばれる（on_max/on_min/on_overflow/on_shortfall経由の場合、actor/draggedは
        /// 存在しないためnull）。
        ///
        /// selfは常にこのインスタンス自身、parentはthis.Parent、actor/draggedは呼び出し側から渡された
        /// ものとして解決する（対象ごとのWorldObject解決はこのメソッドに閉じる）。対象が解決できない
        /// 場合（parentが無い、actor/draggedがこの実行文脈に無い）は、その対象への適用のみ無視する。
        ///
        /// destroyをspawnより先に行う（9.3節・9.4節）。カードスタックのUIでは、種類が変わるアイテムが
        /// はみ出さないよう、置き換え後のオブジェクトが「破棄されるオブジェクトが占めていた位置」を
        /// 引き継ぐ必要があるため、destroyで実際に位置が空いてから通常の（force無しの）配置を行う。
        /// 位置情報はdestroyで失われる前に捕捉しておく（CaptureSameSlotAnchor参照）。spawnは常にself
        /// （このインスタンス自身）が実行するものとみなすため、同じ場所への配置(SameSlot)はself自身の
        /// destroy有無だけを見ればよい。
        /// </summary>
        internal void ApplyActiveEffect(ActiveEffect effect, WorldSession session, WorldObject actor, WorldObject dragged)
        {
            foreach (ReferenceRoot key in OrderedTargets)
            {
                if (!effect.Sets.TryGetValue(key, out var assigns)) continue;
                WorldObject target = ResolveEffectTarget(key, actor, dragged);
                if (target == null) continue;
                foreach (var assign in assigns) target.SetNumber(assign.PropertyGlobalId, assign.Value, session);
            }

            foreach (ReferenceRoot key in OrderedTargets)
            {
                if (!effect.Adds.TryGetValue(key, out var deltas)) continue;
                WorldObject target = ResolveEffectTarget(key, actor, dragged);
                if (target == null) continue;
                foreach (var delta in deltas) target.AddNumber(delta.PropertyGlobalId, delta.Amount, session);
            }

            bool willDestroySelf = effect.Destroy.Contains(ReferenceRoot.Self);
            SameSlotAnchor? anchor = effect.Spawn != null && effect.Spawn.Into == SpawnTargetRoot.SameSlot
                ? CaptureSameSlotAnchor(willDestroySelf)
                : null;

            foreach (ReferenceRoot key in OrderedTargets)
            {
                if (!effect.Destroy.Contains(key)) continue;
                WorldObject target = ResolveEffectTarget(key, actor, dragged);
                if (target == null) continue;
                target.Destroy(session.Codex.WellKnown);
            }

            if (effect.Spawn != null) ExecuteSpawn(effect.Spawn, session, actor, anchor);
        }

        /// <summary>set/add/destroyの対象キー(self/parent/actor/dragged)を解決する。selfは常にこの
        /// インスタンス自身、parentはthis.Parent（無ければnull）。</summary>
        private WorldObject ResolveEffectTarget(ReferenceRoot root, WorldObject actor, WorldObject dragged)
        {
            switch (root)
            {
                case ReferenceRoot.Self: return this;
                case ReferenceRoot.Parent: return Parent;
                case ReferenceRoot.Actor: return actor;
                case ReferenceRoot.Dragged: return dragged;
                default: return null;
            }
        }

        /// <summary>set/add/destroyを解決する際の固定順（self→parent→actor→dragged）。YAML側で対象間の
        /// 適用順序は規定されていないため、決定的な順序を1つ選んで固定する。</summary>
        private static readonly ReferenceRoot[] OrderedTargets =
        {
            ReferenceRoot.Self, ReferenceRoot.Parent, ReferenceRoot.Actor, ReferenceRoot.Dragged,
        };

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
                        placed = spawned.MoveToSlot(a.Parent, slot.Def.GlobalId, session.Codex.WellKnown, out _, force: false);
                }
                else if (slot.Def.FixedPositions)
                {
                    // 新しい型が既にこのスロットに存在する（同種スタックへの合流）。番号操作は不要。
                    placed = spawned.MoveToSlot(a.Parent, slot.Def.GlobalId, session.Codex.WellKnown, out _, force: false);
                }
                else
                {
                    placed = spawned.InsertAtIndex(a.Parent, slot.Def.GlobalId, a.ListIndex, session.Codex.WellKnown, out _, force: false);
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
                if (spawned.MoveToSlot(target, slotDef.GlobalId, session.Codex.WellKnown, out _, force))
                    return true;

            return false;
        }

        /// <summary>
        /// 現在このプロパティに登録されている全寄与（modify/accumulate両方）を列挙する。
        /// 「このプロパティに何が影響しているか」をUIで表示したい場合に使う。ゲートが現在有効かどうかは
        /// 呼び出し側で RegisteredPassiveEffect.IsActive() 相当の判定をしたい場合、Kind別にGetEffectiveValue/Tickの
        /// 結果と突き合わせる。
        /// </summary>
        public IReadOnlyList<RegisteredPassiveEffect> GetIncomingPassiveEffects(int propertyGlobalId)
        {
            int local = Def.PropertyLayout.ToLocal(propertyGlobalId);
            if (local == LocalIndexMap.Missing) return Array.Empty<RegisteredPassiveEffect>();
            return properties[local].Incoming;
        }
    }
}
