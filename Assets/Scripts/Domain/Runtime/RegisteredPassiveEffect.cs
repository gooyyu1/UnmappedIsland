using UnmappedIsland.Domain.Defs;

namespace UnmappedIsland.Domain.Runtime
{
    /// <summary>
    /// 登録済みの効果1件。target(self/parent/child)・kind(modify/accumulate)を問わず同じ形で持つ。
    ///
    /// - Declarer: この効果を宣言したオブジェクト。WhenOwnStageゲートはこれ自身の該当プロパティを見る
    /// - SlotBearer: 親子関係で「子」側にあたるオブジェクト。conditions（旧when）ゲートのselfはこれを指す
    ///
    /// self対象なら Declarer == SlotBearer == 登録先の自分自身、parent対象（子→親）なら両方とも子、
    /// child対象（親→子）なら Declarer が親・SlotBearer が子になる。この2つを登録時に確定させておくことで、
    /// 読み取り側(PropertyValue.GetEffectiveValue/Tick)はtargetの種類を一切気にせず1本のロジックで済む。
    /// </summary>
    public sealed class RegisteredPassiveEffect
    {
        public WorldObject Declarer { get; }
        public WorldObject SlotBearer { get; }
        public PassiveEffect Def { get; }

        public RegisteredPassiveEffect(WorldObject declarer, WorldObject slotBearer, PassiveEffect def)
        {
            Declarer = declarer;
            SlotBearer = slotBearer;
            Def = def;
        }

        /// <summary>このゲートが現在有効かどうか（8.2節）。自分自身(Def.Gate/Declarer/SlotBearer)だけで判定できる。
        /// StageNameとConditionsは独立したフィールドで、それぞれ非nullの場合だけそのチェックを行う（両方非nullなら
        /// AND、両方nullなら常時有効）。</summary>
        public bool IsActive() => Def.Gate.IsSatisfied(Declarer, SlotBearer);
    }
}
