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
        /// <summary>この効果を宣言したオブジェクト。解除時の同定（誰の登録を外すか）と、
        /// 「このプロパティに何が効いているか（誰から）」を見せるUI（GetIncomingPassiveEffects）で読むため公開する。</summary>
        public WorldObject Declarer { get; }

        // slotBearer(conditionsゲートのself)とdef(効果本体)は、登録時に確定させて以後RegisterInto/ActiveAmountが
        // 内部で使うだけの配線で、クラス外からは読まれない。
        private readonly WorldObject slotBearer;
        private readonly PassiveEffect def;

        public RegisteredPassiveEffect(WorldObject declarer, WorldObject slotBearer, PassiveEffect def)
        {
            Declarer = declarer;
            this.slotBearer = slotBearer;
            this.def = def;
        }

        /// <summary>この登録をdef（PassiveEffect）自身に頼んで、対象プロパティ値の適切なincoming
        /// （modify用/accumulate用）へ登録させる。どちらのバケツに入るかはdefが決める。</summary>
        public void RegisterInto(PropertyValue target) => def.RegisterInto(target, this);

        /// <summary>この効果が現在の文脈（Declarer/slotBearer）で寄与している量。ゲート（8.2節）が有効なら
        /// Amount、無効なら0。判定と量はいずれもdef自身が持つため、こちらはDeclarer/slotBearerを渡して委ねる。</summary>
        public int ActiveAmount() => def.ActiveAmount(Declarer, slotBearer);
    }
}
