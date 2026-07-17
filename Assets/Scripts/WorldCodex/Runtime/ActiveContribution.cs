using UnmappedIsland.Codex.Defs;
using UnmappedIsland.Codex.Registry;

namespace UnmappedIsland.Codex.Runtime
{
    /// <summary>
    /// 登録済みの効果1件。target(self/parent/child)・kind(modify/accumulate)を問わず同じ形で持つ。
    ///
    /// - Declarer: この効果を宣言したオブジェクト。WhenOwnStageゲートはこれ自身の該当プロパティを見る
    /// - SlotBearer: 親子関係で「子」側にあたるオブジェクト。WhenSlotゲートはこれの ParentSlotLocalId を見る
    ///
    /// self対象なら Declarer == SlotBearer == 登録先の自分自身、parent対象（子→親）なら両方とも子、
    /// child対象（親→子）なら Declarer が親・SlotBearer が子になる。この2つを登録時に確定させておくことで、
    /// 読み取り側(PropertyValue.GetEffectiveValue/Tick)はtargetの種類を一切気にせず1本のロジックで済む。
    /// </summary>
    public sealed class ActiveContribution
    {
        public WorldObject Declarer { get; }
        public WorldObject SlotBearer { get; }
        public ContributionDef Def { get; }

        public ActiveContribution(WorldObject declarer, WorldObject slotBearer, ContributionDef def)
        {
            Declarer = declarer;
            SlotBearer = slotBearer;
            Def = def;
        }

        /// <summary>このゲートが現在有効かどうか（8.2節）。自分自身(Def.Gate/Declarer/SlotBearer)だけで判定できる。</summary>
        public bool IsActive()
        {
            switch (Def.Gate.Kind)
            {
                case ContributionGateKind.Always:
                    return true;

                case ContributionGateKind.WhenSlot:
                    WorldObject parent = SlotBearer.Parent;
                    if (parent == null) return false;
                    int slotLocal = parent.Def.SlotLayout.ToLocal(Def.Gate.SlotGlobalId);
                    return slotLocal != LocalIndexMap.Missing && SlotBearer.ParentSlotLocalId == slotLocal;

                case ContributionGateKind.WhenOwnStage:
                    int value = Declarer.GetNumberByLocalId(Def.Gate.PropertyLocalId);
                    var stage = Declarer.Def.PropertyDefs[Def.Gate.PropertyLocalId].ResolveStage(value);
                    return ReferenceEquals(stage, Def.Gate.Stage);

                default:
                    return false;
            }
        }
    }
}
