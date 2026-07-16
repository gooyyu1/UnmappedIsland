using UnmappedIsland.Codex.Defs;

namespace UnmappedIsland.Codex.Runtime
{
    /// <summary>
    /// 登録済みのmodify寄与1件。target(self/parent/child)を問わず同じ形で持つ。
    ///
    /// - Declarer: この効果を宣言したオブジェクト。WhenOwnStageゲートはこれ自身の該当プロパティを見る
    /// - SlotBearer: 親子関係で「子」側にあたるオブジェクト。WhenSlotゲートはこれの ParentSlotLocalId を見る
    ///
    /// self対象なら Declarer == SlotBearer == 登録先の自分自身、parent対象（子→親）なら両方とも子、
    /// child対象（親→子）なら Declarer が親・SlotBearer が子になる。この2つを登録時に確定させておくことで、
    /// 読み取り側(WorldObject.GetEffectiveValue)はtargetの種類を一切気にせず1本のロジックで済む。
    /// </summary>
    public sealed class ActiveContribution
    {
        public WorldObject Declarer { get; }
        public WorldObject SlotBearer { get; }
        public ModifyContributionDef Def { get; }

        public ActiveContribution(WorldObject declarer, WorldObject slotBearer, ModifyContributionDef def)
        {
            Declarer = declarer;
            SlotBearer = slotBearer;
            Def = def;
        }
    }
}
