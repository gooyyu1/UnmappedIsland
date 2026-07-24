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
        /// 全プロパティのtick処理（accumulateの反映とrangeイベント判定、PropertyValue.Tick参照）を行った後、
        /// 子（すべてのスロットの中身）へ再帰する。すべてのオブジェクトはworldの下にぶら下がるため、
        /// worldへ1回呼ぶだけでツリー全体が処理される。
        ///
        /// rangeイベントのdestroy/spawnは処理中に自分自身や兄弟をツリーから切り離しうるため、
        /// 各スロットの中身は列挙前にスナップショットを取る。
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
        /// このオブジェクトをselfとして、set/add/destroy/spawnを実行する（9.2〜9.4節）。rangeイベント（6節）と
        /// actions/combinations（11節・12節）の両方から呼ばれる（rangeイベント経由ではactor/draggedはnull）。
        /// 対象が解決できない場合（parentが無い、actor/draggedがこの実行文脈に無い）は、その対象への適用のみ無視する。
        ///
        /// destroyをspawnより先に行う（9.3節・9.4節）: 置き換え後のオブジェクトが破棄されるオブジェクトの位置を
        /// 引き継げるよう、destroyで実際に位置が空いてから通常の（force無しの）配置を行う。
        /// </summary>
        public void ApplyActiveEffect(ActiveEffect effect, WorldSession session, WorldObject actor, WorldObject dragged)
        {
            // same_slot spawnのために「selfが今占めている位置」を、まだ何も起きていないこの入口で捕捉する。
            // destroyがselfを消した後でも、spawnはこのアンカーと配置時のスロットの状態から置き換え位置を
            // 決められる（EffectSite参照）。
            EffectSite? effectSite = CaptureEffectSite();
            effect.Apply(this, session, actor, dragged, effectSite);
        }

        /// <summary>効果の対象キー(self/parent/actor/dragged/dragged_parent)を解決する。Ancestorはプロパティごとに
        /// 解決先が変わりうるため扱わない（ResolveEffectTargetOrAncestor参照）。</summary>
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

        /// <summary>ResolveEffectTargetに加えAncestorも解決する（propertyGlobalIdはAncestor解決にのみ使う）。</summary>
        public WorldObject ResolveEffectTargetOrAncestor(ReferenceRoot root, int propertyGlobalId, WorldObject actor, WorldObject dragged) =>
            root == ReferenceRoot.Ancestor ? FindAncestorWithProperty(propertyGlobalId) : ResolveEffectTarget(root, actor, dragged);

        /// <summary>same_slotの置き換えのために、selfが今占めている位置を捕捉する。「これから消えるか」の予測は
        /// 織り込まず、置き換え位置の判断は配置時にEffectSite自身が行う。Parentが無ければ位置が無いのでnull。</summary>
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
        /// spawn（9.4節）を実行する。Intoへの配置に失敗した場合は起点自身の親へ伝播し、accepts/capacityを
        /// 無視して強制配置する（Place参照）。伝播先の親も無ければ、生成したオブジェクトはworldツリーに
        /// 繋がらないまま消える。
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
        /// spawnした側は配置先のスロット名を書かない。SameSlotなら捕捉しておいた位置へ配置する
        /// （同種スタックへの合流を除き、originが居たセルを基準にSlot.PlaceSameSlotへ委ねる）。
        /// Self/Actorなら対象のスロットを宣言順に走査し、最初に配置できたスロットへ入れる。
        /// 配置に失敗した場合は起点自身の親へ伝播し、accepts/capacityを無視して強制配置する。
        /// 伝播先の親も無ければ何もしない。
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
                    // originが居たセルを基準に置き換えを配置する（Slot.PlaceSameSlot参照）。
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
        /// ApplyActiveEffectの入口でself（効果の起点）が占めていた位置を捕捉したスナップショット。
        /// same_slot spawnだけがこれを使い、置き換え先を決める。「これからselfが消えるか」は捕捉時には
        /// 織り込まず、置き換え位置の判断は配置時のスロットの状態から行う（OriginKindRemains参照）。
        /// </summary>
        public readonly struct EffectSite
        {
            public readonly WorldObject Parent;
            public readonly int ParentSlotLocalId;

            /// <summary>捕捉時にself(origin)が属していたObjectStack。</summary>
            private readonly ObjectStack originStack;

            /// <summary>捕捉時のoriginStackのセル位置。空セルが除去される非FixedPositionsでは、同種が消えた後は
            /// IndexOfStackで引けなくなるため捕捉値が要る。</summary>
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
            /// 置き換えオブジェクトは隣へ、残っていなければ空いたその位置をそのまま引き継ぐ。
            /// 判定は在庫（Members.Count）で行う——「その位置が同種を受け入れられるか」ではない。空になった
            /// セルも同種を受け入れ可能だが、位置は引き継ぐべきだから。
            /// </summary>
            public bool OriginKindRemains => originStack.Members.Count > 0;

            /// <summary>originが居たセルの位置。同種が残っていればoriginStackの現在位置、消えていれば捕捉時の位置。
            /// Slot.PlaceSameSlotがこれを基準に配置する。</summary>
            public int OriginCellIndex(Slot slot) =>
                OriginKindRemains ? slot.IndexOfStack(originStack) : stackIndexAtCapture;
        }

        /// <summary>targetのスロットを宣言順に走査し、最初に配置できたスロットへ入れる
        /// （MoveIntoFirstAcceptingSlot参照）。</summary>
        private static bool TryFirstAcceptingSlot(WorldObject spawned, WorldObject target, WorldSession session, bool force) =>
            spawned.MoveIntoFirstAcceptingSlot(target, session.Codex.WellKnown, force);
    }
}
