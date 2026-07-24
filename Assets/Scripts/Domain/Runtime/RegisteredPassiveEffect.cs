using UnmappedIsland.Domain.Defs;

namespace UnmappedIsland.Domain.Runtime
{
    /// <summary>
    /// 登録済みの効果1件。target(self/parent/child)・kind(modify/accumulate)を問わず同じ形で持つ。
    ///
    /// - Declarer: この効果を宣言したオブジェクト。WhenOwnStageゲートはこれ自身の該当プロパティを見る
    /// - SlotBearer: 親子関係で「子」側にあたるオブジェクト。conditionsゲートのselfはこれを指す
    ///
    /// self対象なら Declarer == SlotBearer == 登録先の自分自身、parent対象（子→親）なら両方とも子、
    /// child対象（親→子）なら Declarer が親・SlotBearer が子。この2つを登録時に確定させることで、
    /// 読み取り側(PropertyValue.GetEffectiveValue/Tick)はtargetの種類を区別せずに済む。
    /// </summary>
    public sealed class RegisteredPassiveEffect
    {
        /// <summary>この効果を宣言したオブジェクト。解除時の同定と、「このプロパティに何が効いているか」の
        /// UI表示（GetIncomingPassiveEffects）のため公開する。</summary>
        public WorldObject Declarer { get; }

        private readonly WorldObject slotBearer;
        private readonly PassiveEffect def;

        public RegisteredPassiveEffect(WorldObject declarer, WorldObject slotBearer, PassiveEffect def)
        {
            Declarer = declarer;
            this.slotBearer = slotBearer;
            this.def = def;
        }

        /// <summary>対象プロパティ値のincoming（modify用/accumulate用）へこの登録を入れる。どちらに入るかはdefが決める。</summary>
        public void RegisterInto(PropertyValue target) => def.RegisterInto(target, this);

        /// <summary>この効果が現在寄与している量。ゲート（8.2節）が有効ならAmount、無効なら0。</summary>
        public int ActiveAmount() => def.ActiveAmount(Declarer, slotBearer);
    }
}
