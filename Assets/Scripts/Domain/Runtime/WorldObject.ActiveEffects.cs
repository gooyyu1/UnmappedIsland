using System.Collections.Generic;
using System.Linq;
using UnmappedIsland.Domain.Defs;

namespace UnmappedIsland.Domain.Runtime
{
    /// <summary>WorldObject の一部（能動効果 set/add/destroy/spawn/transfer・actions/combinations・tick）。
    /// 効果の適用入口（ApplyActiveEffect）と対象解決、same_slot spawn の位置捕捉（EffectSite）・配置（Place）を持つ。
    /// 値の変更そのものは対象の PropertyValue へ、条件判定・抽選は Def 側の効果へ委ねる。</summary>
    public sealed partial class WorldObject
    {
        public bool TryExecuteAction(string actionName, WorldObject actor, WorldSession session) =>
            Def.TryExecuteAction(this, actor, actionName, session);

        public bool TryExecuteCombination(WorldObject dragged, WorldObject actor, string combinationName, WorldSession session) =>
            Def.TryExecuteCombination(this, dragged, actor, combinationName, session);

        public IEnumerable<CombinationDef> FindMatchingCombinations(WorldObject dragged) =>
            Def.FindMatchingCombinations(this, dragged);

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
        /// same_slotの実際の配置は、置き換え先の型が既に同じスロットに存在する（同種スタックへの合流）場合を
        /// 除き、originが居たセルを基準にSlot.PlaceSameSlotへ委ねる（FixedPositions/非FixedPositionsの差は
        /// そちらに閉じる）。FixedPositionsで空きが作れず配置できなかった場合はfalseが返り、後述のfallbackへ委ねる。
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

                if (slot.Def.FixedPositions && slot.FindMatchingStack(spawned) != null)
                {
                    // 置き換え先の型が既にこのスロットに存在する（同種スタックへの合流）。位置操作は不要。
                    placed = spawned.MoveToSlot(s.Parent, slot.Def.GlobalId, session.Codex.WellKnown, out _, force: false);
                }
                else
                {
                    // originが居たセルを基準に置き換えを配置する。同種が残っていれば隣へ、消えていれば元の位置へ
                    // （FixedPositions/非FixedPositionsの差はSlot.PlaceSameSlotに閉じる）。
                    placed = spawned.InsertSameSlot(
                        s.Parent, slot.Def.GlobalId,
                        new SameSlotPlacement(s.OriginCellIndex(slot), s.OriginKindRemains),
                        session.Codex.WellKnown, out _, force: false);
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

            /// <summary>捕捉時にself(origin)が属していたObjectStack。配置時にこれにoriginと同種が
            /// まだ残っているか（Members.Count>0）で置き換え位置を分岐する。</summary>
            private readonly ObjectStack originStack;

            /// <summary>捕捉時のoriginStackのセル位置。originの同種が全て消えて空いた位置へ引き継ぐときに使う
            /// （空セルが除去される非FixedPositionsではIndexOfStackで引けなくなるため捕捉値が要る。
            /// FixedPositionsは空セルを保持するので位置は安定＝この値のまま）。</summary>
            private readonly int stackIndexAtCapture;

            public EffectSite(WorldObject parent, int parentSlotLocalId, ObjectStack originStack, int stackIndexAtCapture)
            {
                Parent = parent;
                ParentSlotLocalId = parentSlotLocalId;
                this.originStack = originStack;
                this.stackIndexAtCapture = stackIndexAtCapture;
            }

            /// <summary>
            /// 元のスタックにoriginと同種がまだ残っているか（selfが生き残る／同種の兄弟が残る）。残っていれば
            /// 置き換えオブジェクト（別の型）は隣へ、残っていなければ（空になった）その位置をそのまま引き継ぐ。
            ///
            /// 「その位置がoriginの同種を受け入れられるか」ではない点に注意: 空になったスタック（セル）も同種を
            /// 受け入れ可能だが、位置は引き継ぐべき。判定は在庫（Members.Count）で行うため、固定スロットが空セルを
            /// 保持する実装でも正しい（空セルがリストに残っていても、同種が居なければ引き継ぎ側になる）。
            /// </summary>
            public bool OriginKindRemains => originStack.Members.Count > 0;

            /// <summary>originが居たセルの位置。同種が残っていればoriginStackの現在位置、消えていれば捕捉時の位置
            /// （非FixedPositionsは除去で前詰めされるが捕捉値がその位置を指す／FixedPositionsは位置が安定）。
            /// Slot.PlaceSameSlotがこれを基準に、隣（同種残存）か元の位置（消滅）へ配置する。</summary>
            public int OriginCellIndex(Slot slot) =>
                OriginKindRemains ? slot.IndexOfStack(originStack) : stackIndexAtCapture;
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
    }
}
