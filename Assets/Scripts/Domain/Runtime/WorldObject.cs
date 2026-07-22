using System;
using System.Collections.Generic;
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
    /// </summary>
    public sealed class WorldObject
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
            foreach (var c in def.Passives)
                c.RegisterRelation(this, ReferenceRoot.Self, register: true);
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
        public void SetProperty(int globalPropertyId, int value)
        {
            if (!TryGetProperty(globalPropertyId, out PropertyValue property))
                throw new InvalidOperationException($"'{Def.Name}' はプロパティ(id={globalPropertyId})を持ちません。");
            property.CopyValueFrom(value);
        }

        public int GetNumber(int globalPropertyId, int fallback = 0)
        {
            return TryGetProperty(globalPropertyId, out var v) ? v.Number : fallback;
        }

        /// <summary>interaction/stack判定の代表として採用する、represented_by先の最初の子を返す。
        /// represented_by未指定・対象スロット不存在・空スロットなら自分自身を返す。代表オブジェクトが
        /// さらにrepresented_byを持つ場合は、その代表へ再帰的に委譲する。</summary>
        public WorldObject ResolveInteractionTarget()
        {
            if (!Def.RepresentedBySlotGlobalId.HasValue) return this;
            if (!TryGetSlot(Def.RepresentedBySlotGlobalId.Value, out Slot slot)) return this;
            WorldObject represented = slot.Contents.FirstOrDefault();
            return represented?.ResolveInteractionTarget() ?? this;
        }

        public bool TryExecuteAction(string actionName, WorldObject actor, WorldSession session) =>
            Def.TryExecuteAction(this, actor, actionName, session);

        public bool TryExecuteCombination(WorldObject dragged, WorldObject actor, string combinationName, WorldSession session) =>
            Def.TryExecuteCombination(this, dragged, actor, combinationName, session);

        public IEnumerable<CombinationDef> FindMatchingCombinations(WorldObject dragged) =>
            Def.FindMatchingCombinations(this, dragged);

        /// <summary>stack判定用の代表ObjectDef列を、現在のrepresented_byチェーンからスナップショットする。
        /// 自分自身のObjectDefは呼び出し側（ObjectStack.Def）が既に持っているため含めず、代表の代表…だけを
        /// 深さ順に並べる。</summary>
        public IReadOnlyList<int> CaptureRepresentationChain()
        {
            var chain = new List<int>();
            AppendRepresentationChain(chain);
            return chain;
        }

        public bool HasRepresentationChain(IReadOnlyList<int> expected)
        {
            var actual = CaptureRepresentationChain();
            if (actual.Count != expected.Count) return false;
            for (int i = 0; i < actual.Count; i++)
                if (actual[i] != expected[i]) return false;
            return true;
        }

        private void AppendRepresentationChain(List<int> chain)
        {
            if (!Def.RepresentedBySlotGlobalId.HasValue) return;
            if (!TryGetSlot(Def.RepresentedBySlotGlobalId.Value, out Slot slot)) return;

            WorldObject represented = slot.Contents.FirstOrDefault();
            if (represented == null) return;

            chain.Add(represented.Def.GlobalId);
            represented.AppendRepresentationChain(chain);
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

        public Slot GetSlotByLocalId(int localId) => slots[localId];

        public void SetParent(WorldObject parent, int parentSlotLocalId)
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
            AttachToSlot(newParent, slotGlobalId, insertStackIndex: null, wellKnown, out error, force);

        /// <summary>
        /// same_slot専用。通常の（同種のObjectStackへソート挿入する）配置ロジックを使わず、置き換えオブジェクトを
        /// 新規ObjectStackとして、指定した外側position(stackIndex)へそのまま割り込ませる。破棄されたオブジェクトの
        /// 位置を、新しく生成されたオブジェクトへ引き継がせるために使う（Place参照）。
        /// </summary>
        public bool InsertAtStackIndex(WorldObject newParent, int slotGlobalId, int stackIndex, WellKnownProperties wellKnown, out string error, bool force = false) =>
            AttachToSlot(newParent, slotGlobalId, stackIndex, wellKnown, out error, force);

        private bool AttachToSlot(WorldObject newParent, int slotGlobalId, int? insertStackIndex, WellKnownProperties wellKnown, out string error, bool force)
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

            if (insertStackIndex.HasValue)
                targetSlot.InsertNewStackAt(this, insertStackIndex.Value);
            else
                targetSlot.AddInternal(this);

            SetParent(newParent, localSlot);
            newParent.PropagateWeightChange(localSlot, GetNumber(wellKnown.WeightId), wellKnown);
            RegisterEdgeWith(newParent);
            // トポロジが変わった後（新しい親チェーンが確定した後）に、祖先対象の登録を（this＋子孫について）
            // 現在の祖先へ登録する。DetachFromParentでの解除と対になり、Refresh（前回の登録先の記憶）が要らない。
            SyncAncestorTargetedRecursively(register: true);

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
        /// 親子関係が結ばれた瞬間に、双方の効果（modify/accumulate、8節）を相手側へ登録する。
        /// target=Parent（自分の効果が親へ及ぶ、例: 防具の`passive.parent`）は親へ、
        /// target=Child（親の効果が自分へ及ぶ）は自分へ登録する。target=Selfは各WorldObjectの
        /// コンストラクタで既に登録済みのため、ここでは扱わない。kind(modify/accumulate)は登録先を
        /// 選ぶ判断に一切影響しない（評価側でのみ区別される）。
        /// </summary>
        private void RegisterEdgeWith(WorldObject parent) => SyncEdgeWith(parent, register: true);

        private void UnregisterEdgeWith(WorldObject parent) => SyncEdgeWith(parent, register: false);

        /// <summary>thisとparentのエッジが形成/解消された契機を、双方の持続効果へ伝える。thisから見れば
        /// 相手はParent（相手はowner自身から辿れるので渡さない）、parentから見れば相手はChild（どの子かは
        /// 一意に辿れないため、その子thisをRegisterChildへ明示的に渡す）。登録先の解決・登録/解除は効果自身が行う。</summary>
        private void SyncEdgeWith(WorldObject parent, bool register)
        {
            foreach (var c in Def.Passives)
                c.RegisterRelation(this, ReferenceRoot.Parent, register);

            foreach (var c in parent.Def.Passives)
                c.RegisterChild(parent, this, register);
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

        /// <summary>
        /// 自分自身の直接の親が変わる（MoveToSlot/Destroy）際、その前に解除(register=false)・後に登録
        /// (register=true)として呼ぶ。自分の祖先チェーンが変わるのは自分自身だけでなく、自分の子孫全員に
        /// とっても同じ（子孫からのAncestor探索は自分を通過してさらに上へ続きうる）ため、自分自身と、すべての
        /// 子孫について、Target=Ancestorのpassivesを現在の祖先へ登録/解除する。トポロジ変化前に解除・変化後に
        /// 登録する順序を守ることで、いずれの時点でも祖先はownerから辿れ、前回の登録先を憶える必要がない。
        /// </summary>
        private void SyncAncestorTargetedRecursively(bool register)
        {
            foreach (var c in Def.Passives)
                c.RegisterRelation(this, ReferenceRoot.Ancestor, register);

            foreach (var slot in slots)
                foreach (var child in slot.Contents.ToArray())
                    child.SyncAncestorTargetedRecursively(register);
        }

        /// <summary>
        /// 指定したグローバルIDのプロパティが、今まさに指定した名前のstageに該当しているか（WhenOwnStage
        /// ゲート専用、6.4節・8節）。プロパティ解決だけがこのメソッドの責務で、該当stageの判定自体は
        /// TryGetPropertyで得たPropertyValue自身に委ねる（自分のことは自分でする、CLAUDE.md参照）。
        /// </summary>
        public bool IsInStage(int propertyGlobalId, string stageName)
        {
            return TryGetProperty(propertyGlobalId, out var property) && property.IsInStage(stageName);
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
        /// modify（Kind.Modify）のみを加味した実効値（8.3節）。可逆な寄与であり、実体値そのものは書き換えない。
        /// target(self/parent/child/ancestor)の違いは各PassiveEffectが登録時に解決済みで、ここ（読み取り側）は
        /// 登録された寄与を一律に合算するだけで一切区別しない。Kind.Accumulateの寄与はTick参照。
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
        /// selfの位置はこの入口(ApplyActiveEffect)でeffectSiteとして先に捕捉しておき、destroyで
        /// 失われた後も、配置時にその位置がまだ同種を保持しているかを見て置き換え位置を決める
        /// （CaptureEffectSite/EffectSite参照）。spawnは常にself（このインスタンス自身）が実行する
        /// ものとみなす。
        /// </summary>
        public void ApplyActiveEffect(ActiveEffect effect, WorldSession session, WorldObject actor, WorldObject dragged)
        {
            // same_slot spawnのために「selfが今占めている位置」を、まだ何も起きていないこの入口で先に捕捉し、
            // 効果（単一命令・合成ActiveEffects・pickのいずれでも）へそのまま素通しで渡す。destroyがselfを
            // 消した後でも、spawnはこのアンカーと配置時のスロットの状態から置き換え位置を決められるため、
            // destroyがアンカーへ何かを書き込む必要はない（EffectSite参照）。
            EffectSite? effectSite = CaptureEffectSite();
            effect.Apply(this, session, actor, dragged, effectSite);
        }

        /// <summary>set/add/destroyの対象キー(self/parent/actor/dragged/dragged_parent)を解決する。selfは常にこの
        /// インスタンス自身、parentはthis.Parent（無ければnull）、dragged_parentはdraggedの直接の親（無ければnull）。
        /// Ancestorはプロパティごとに解決先が変わりうる（FindAncestorWithProperty）ため、ここでは扱わない
        /// （ResolveEffectTargetOrAncestorがkey==Ancestorを特別扱いする）。destroy（DestroyEffect）が対象解決に使う。</summary>
        public WorldObject ResolveEffectTarget(ReferenceRoot root, WorldObject actor, WorldObject dragged)
        {
            switch (root)
            {
                case ReferenceRoot.Self: return this;
                case ReferenceRoot.Parent: return Parent;
                case ReferenceRoot.Actor: return actor;
                case ReferenceRoot.Dragged: return dragged;
                case ReferenceRoot.DraggedParent: return dragged?.Parent;
                default: return null;
            }
        }

        /// <summary>active（set/add/transferのlinked_add）の対象解決。AncestorはFindAncestorWithProperty
        /// （プロパティごとに解決先が変わる）へ委譲し、それ以外はResolveEffectTargetと同じ。SetEffect/AddEffect/
        /// TransferEffectが自分を適用する際の対象解決に共有する（propertyGlobalIdはAncestor解決にのみ使う）。</summary>
        public WorldObject ResolveEffectTargetOrAncestor(ReferenceRoot root, int propertyGlobalId, WorldObject actor, WorldObject dragged) =>
            root == ReferenceRoot.Ancestor ? FindAncestorWithProperty(propertyGlobalId) : ResolveEffectTarget(root, actor, dragged);

        /// <summary>
        /// same_slotの置き換え（型が変わりうる）のために、selfが今占めている位置を、まだ何も起きていない
        /// ApplyActiveEffectの入口でそのまま捕捉する（selfのObjectStack・その中でのメンバー位置・外側position）。
        /// willDestroySelfのような「これから消えるか」の予測は織り込まない。置き換え位置の判断（元の位置を
        /// そのまま引き継ぐか、selfの直後か）は、配置時に「その位置がまだ同種を保持しているか」を見て
        /// EffectSite自身が行う（EffectSite参照）。Parentが無ければ位置が無いのでnull。
        /// </summary>
        private EffectSite? CaptureEffectSite()
        {
            if (Parent == null) return null;

            Slot slot = Parent.GetSlotByLocalId(ParentSlotLocalId);
            ObjectStack originStack = slot.FindStackContaining(this);
            if (originStack == null) return null;

            return new EffectSite(
                Parent, ParentSlotLocalId, originStack, stackIndexAtCapture: slot.IndexOfStack(originStack));
        }

        /// <summary>
        /// spawn（9.4節）を実行する。fallbackはYAML側に存在せず、Intoへの配置に失敗した場合は必ず
        /// 起点自身の親へ伝播し、accepts/capacityを無視して強制的に配置する（Place参照）。伝播先の
        /// 親も無い場合、生成したオブジェクトはどこにも配置されないまま消える（worldツリーに繋がらない
        /// ため存在しないのと同じ）。
        /// </summary>
        public void ExecuteSpawn(SpawnEffect effect, WorldSession session, WorldObject actor, EffectSite? effectSite)
        {
            WorldObject spawned = session.Spawn(effect.ObjectGlobalId);
            if (effect.Into == SpawnTargetRoot.SameSlot)
                CopySharedPropertiesTo(spawned);
            Place(spawned, effect.Into, session, actor,
                effect.Into == SpawnTargetRoot.SameSlot ? effectSite : null);
        }

        private void CopySharedPropertiesTo(WorldObject other)
        {
            foreach (var propertyDef in other.Def.EnumeratePropertyDefs())
            {
                if (!TryGetProperty(propertyDef.GlobalId, out PropertyValue value)) continue;
                other.SetProperty(propertyDef.GlobalId, value.Number);
            }
        }

        /// <summary>
        /// spawnした側は配置先のスロット名を書かない。SameSlotなら、捕捉しておいた位置（親・スロット・
        /// 元の位置）へそのまま配置する（一意に決まるため走査は行わない）。
        ///
        /// FixedPositionsスロットでは、新しい型（represented_by込みのStackKey）が既に同じスロットに存在する
        /// （同種スタックへの合流）場合はそのまま通常配置し、そうでなければ、元の固定番号にoriginの同種がまだ
        /// 残っている場合（OriginKindRemains＝selfが生き残る、またはdestroyされても同種が残る場合）は
        /// 自分の番号の右側（+1以降）で最初に見つかる隙間へ、他のObjectStackを押し出しながら割り込ませ、
        /// 残っていない場合（同種が全て消えて番号が空いた場合）はその番号をそのまま引き継ぐ。右側に隙間が
        /// 無ければ、左側（-1以前）で同様に割り込ませる（「右が空いている限り右に、そうでなければ左に生まれる」、
        /// Slot.TryMakeRoomAndSeed参照）。どちらの方向にも隙間が見つからなければ配置失敗として扱い、
        /// 後述のfallbackへ委ねる。
        ///
        /// それ以外の一般スロットでは、EffectSiteが配置時のスロットの状態から決めた位置（元の位置が
        /// 空いていればそこへ新規スタックとして、健在ならselfの直後・元のメンバー位置へ）へ直接挿入する
        /// （同じ場所の後ろにいた他のオブジェクトの位置がずれないようにするため）。
        ///
        /// Self/Actorなら、解決できた対象オブジェクトが持つスロットを宣言順に
        /// 走査し、最初に配置できたスロットへ入れる。
        ///
        /// 配置に失敗した場合は、必ずその起点自身の親へ伝播し、accepts/capacityを無視して
        /// 強制的に配置する（先頭のスロットへ必ず入る）。伝播先の親も無ければ何もしない。
        /// </summary>
        private void Place(WorldObject spawned, SpawnTargetRoot into, WorldSession session, WorldObject actor, EffectSite? site)
        {
            WorldObject primaryTarget;
            bool placed;

            if (into == SpawnTargetRoot.SameSlot)
            {
                if (site == null) return;
                EffectSite s = site.Value;
                primaryTarget = s.Parent;
                Slot slot = s.Parent.GetSlotByLocalId(s.ParentSlotLocalId);

                if (slot.Def.FixedPositions && slot.FindMatchingStack(spawned) == null)
                {
                    // 元の固定番号にoriginの同種がまだ残っているなら（selfが生き残る/同種が残る）その隣へ隙間を
                    // 作り、残っていなければ（同種が全て消えた）その番号をそのまま引き継ぐ。「selfがdestroyされたか」
                    // でも「その番号が同種を受け入れられるか」（空でも受け入れ可能）でもなく、在庫が残っているかで決める。
                    if (s.OriginKindRemains)
                    {
                        placed = slot.TryMakeRoomAndSeed(s.GridIndex);
                    }
                    else
                    {
                        slot.ReserveGridIndexForNextNewStack(s.GridIndex);
                        placed = true;
                    }

                    if (placed)
                        placed = spawned.MoveToSlot(s.Parent, slot.Def.GlobalId, session.Codex.WellKnown, out _, force: false);
                }
                else if (slot.Def.FixedPositions)
                {
                    // 新しい型が既にこのスロットに存在する（同種スタックへの合流）。番号操作は不要。
                    placed = spawned.MoveToSlot(s.Parent, slot.Def.GlobalId, session.Codex.WellKnown, out _, force: false);
                }
                else
                {
                    placed = spawned.InsertAtStackIndex(
                        s.Parent, slot.Def.GlobalId, s.ResolveInsertStackIndex(slot), session.Codex.WellKnown, out _, force: false);
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

        /// <summary>
        /// active効果が起きている場所＝ApplyActiveEffectの入口でself（効果の起点）が占めていた位置を捕捉した
        /// スナップショット。same_slot spawnだけがこれを使い、置き換え先を決める。
        /// 「これからselfが消えるか」は捕捉時には織り込まず、置き換え位置の判断は配置時のスロットの状態から
        /// 行う（destroyが後で走っていても、そのときの実際の状態を見るだけでよい）。
        ///
        /// 置き換え位置は「元のオブジェクトがdestroyされたか」ではなく「元のオブジェクトが居たスタック(固定
        /// 番号)に、同種がまだ残っているか」で決まる。残っているなら（selfが生き残る、またはdestroyされても
        /// 同種の兄弟が残る）新オブジェクトはその隣（+1側）へ、残っていないなら（同種が全て消えた）その空いた
        /// 位置をそのまま引き継ぐ。この判別は在庫（originStack.Members.Count）で行う（OriginKindRemains）——
        /// 「その位置が同種を受け入れられるか」ではない点に注意。空になったスタックも同種を受け入れ可能だが位置は
        /// 引き継ぐべきで、固定スロットが空スタックを保持する実装でも在庫判定なら正しい。
        /// </summary>
        public readonly struct EffectSite
        {
            public readonly WorldObject Parent;
            public readonly int ParentSlotLocalId;

            /// <summary>捕捉時にself(origin)が属していたObjectStack。配置時にこれがまだoriginと同種を
            /// 保持しているか（Members.Count>0）で置き換え位置を分岐する。空になってもGridIndexは保持される。</summary>
            private readonly ObjectStack originStack;

            /// <summary>捕捉時のoriginStackの外側position。originの同種が全て消えて空いた位置へ引き継ぐときに使う
            /// （空スタックが除去される実装ではIndexOfStackで引けなくなるため捕捉値が要る）。</summary>
            private readonly int stackIndexAtCapture;

            public EffectSite(WorldObject parent, int parentSlotLocalId, ObjectStack originStack, int stackIndexAtCapture)
            {
                Parent = parent;
                ParentSlotLocalId = parentSlotLocalId;
                this.originStack = originStack;
                this.stackIndexAtCapture = stackIndexAtCapture;
            }

            /// <summary>FixedPositions用: originStackの固定番号（空になっても保持される。FixedPositionsスロット
            /// では必ず採番済み）。</summary>
            public int GridIndex => originStack.GridIndex.Value;

            /// <summary>
            /// 元のスタックにoriginと同種がまだ残っているか（selfが生き残る／同種の兄弟が残る）。残っていれば
            /// 置き換えオブジェクト（別の型）は隣へ、残っていなければ（空になった）その位置をそのまま引き継ぐ。
            ///
            /// 「その位置がoriginの同種を受け入れられるか」ではない点に注意: 空になったスタック（セル）も同種を
            /// 受け入れ可能だが、位置は引き継ぐべき。判定は在庫（Members.Count）で行うため、固定スロットが空スタックを
            /// 保持する実装でも正しい（空スタックがリストに残っていても、同種が居なければ引き継ぎ側になる）。
            /// </summary>
            public bool OriginKindRemains => originStack.Members.Count > 0;

            /// <summary>
            /// 非FixedPositionsスロット用に、置き換えオブジェクトを新規スタックとして入れる外側position。
            /// スタック内での何番目かは持たない（同種はObjectStack内で自動整列されるため、割り込み位置は意味を
            /// 持たず、同種の山を割るべきでもない）。
            /// - originの同種が残っている: その山の直後(+1)へ（山はそのまま保つ）。
            /// - originの同種が全て消えた: 空いた元の位置(stackIndexAtCapture)へ。
            /// </summary>
            public int ResolveInsertStackIndex(Slot slot) =>
                OriginKindRemains ? slot.IndexOfStack(originStack) + 1 : stackIndexAtCapture;
        }

        /// <summary>targetが持つスロットを宣言順に走査し、最初に配置できたスロットへ入れる。
        /// force=trueはaccepts/capacityの検証を飛ばすため、スロットが1つでもあれば必ず成功する。</summary>
        private static bool TryFirstAcceptingSlot(WorldObject spawned, WorldObject target, WorldSession session, bool force)
        {
            foreach (var slotDef in target.Def.EnumerateSlotDefs())
                if (spawned.MoveToSlot(target, slotDef.GlobalId, session.Codex.WellKnown, out _, force))
                    return true;

            return false;
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
