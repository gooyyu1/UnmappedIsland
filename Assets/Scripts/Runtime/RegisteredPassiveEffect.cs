using UnmappedIsland.Codex;

namespace UnmappedIsland.Runtime
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

        /// <summary>このゲートが現在有効かどうか（8.2節）。自分自身(Def.Gate/Declarer/SlotBearer)だけで判定できる。</summary>
        public bool IsActive()
        {
            switch (Def.Gate.Kind)
            {
                case PassiveEffectGateKind.Always:
                    return true;

                case PassiveEffectGateKind.Conditions:
                    return ConditionEvaluator.Evaluate(Def.Gate.Conditions, ResolveConditionRoot);

                case PassiveEffectGateKind.WhenOwnStage:
                    int value = Declarer.GetNumberByLocalId(Def.Gate.PropertyLocalId);
                    var stage = Declarer.Def.PropertyDefs[Def.Gate.PropertyLocalId].ResolveStage(value);
                    return ReferenceEquals(stage, Def.Gate.Stage);

                default:
                    return false;
            }
        }

        /// <summary>conditions（旧when）内のself/parentを解決する。selfはSlotBearer（self/parent対象の
        /// 効果ならDeclarerと同一、child対象の効果なら実際にそのスロットへ入っている子）、parentはその
        /// 1つ上（SlotBearer.Parent）。actor/draggedはpassivesの文脈に存在しないため常にnull。</summary>
        private WorldObject ResolveConditionRoot(ReferenceRoot root)
        {
            switch (root)
            {
                case ReferenceRoot.Self: return SlotBearer;
                case ReferenceRoot.Parent: return SlotBearer.Parent;
                default: return null;
            }
        }
    }
}
