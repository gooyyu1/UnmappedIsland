using System.Linq;
using UnmappedIsland.Codex;

namespace UnmappedIsland.Runtime
{
    /// <summary>rootが指すWorldObjectを解決する。呼び出し文脈ごとに解決できる対象が異なるため
    /// （actions/combinationsはself/parent/actor/dragged、passivesのゲートはself/parentのみ）、
    /// 解決できない/この文脈で無効なrootにはnullを返す。</summary>
    public delegate WorldObject ConditionRootResolver(ReferenceRoot root);

    /// <summary>
    /// conditions（GameElementDefinition.md 14節）の条件木を評価する。actions/combinationsの一度きりの
    /// 判定（InteractionExecutor）と、passivesの持続的なゲート（RegisteredPassiveEffect.IsActive）の両方が
    /// この同じ評価器を共用する。両者の違いはrootの解決方法（resolveRoot）だけに閉じる。
    /// </summary>
    public static class ConditionEvaluator
    {
        /// <summary>nodeがnull（conditions省略）なら常に真。</summary>
        public static bool Evaluate(ConditionNode node, ConditionRootResolver resolveRoot)
        {
            if (node == null) return true;

            switch (node.Kind)
            {
                case ConditionNodeKind.Property: return EvaluateProperty(node, resolveRoot);
                case ConditionNodeKind.Slot: return EvaluateSlot(node, resolveRoot);
                case ConditionNodeKind.All: return node.Children.All(child => Evaluate(child, resolveRoot));
                case ConditionNodeKind.Any: return node.Children.Any(child => Evaluate(child, resolveRoot));
                case ConditionNodeKind.Not: return !Evaluate(node.Children[0], resolveRoot);
                default: return false;
            }
        }

        /// <summary>
        /// 生の値（PropertyValue.AsNumber）ではなく実効値（GetEffectiveValue、8.3節のmodifyを加味した値）を
        /// 見る。これにより、modifyだけで決まる派生プロパティ（例: weather/hourから決まるsunlight）を
        /// 他のconditionsから参照できる。比較対象のnode.Values側はYAML上のリテラル値（PropertyValue.FromNumber
        /// 生成、defを持たない）なので、そちらは引き続きAsNumberで読む（GetEffectiveValueはdef.Rangeを
        /// 参照するため、defを持たないリテラル側では呼べない）。
        /// </summary>
        private static bool EvaluateProperty(ConditionNode node, ConditionRootResolver resolveRoot)
        {
            WorldObject target = resolveRoot(node.Root);
            if (target == null) return false;
            if (!target.TryGetProperty(node.PropertyGlobalId, out PropertyValue current)) return false;

            int currentValue = current.GetEffectiveValue();

            switch (node.Op)
            {
                case ConditionOp.Lt: return currentValue < node.Values[0].AsNumber();
                case ConditionOp.Lte: return currentValue <= node.Values[0].AsNumber();
                case ConditionOp.Gt: return currentValue > node.Values[0].AsNumber();
                case ConditionOp.Gte: return currentValue >= node.Values[0].AsNumber();
                case ConditionOp.Eq: return currentValue == node.Values[0].AsNumber();
                case ConditionOp.Neq: return currentValue != node.Values[0].AsNumber();
                case ConditionOp.In: return node.Values.Any(v => currentValue == v.AsNumber());
                case ConditionOp.NotIn: return !node.Values.Any(v => currentValue == v.AsNumber());
                default: return false;
            }
        }

        /// <summary>{object, slot}: objectが指すオブジェクト自身が、今まさに親のどのスロットに
        /// 入っているかを見る（常に等価判定）。</summary>
        private static bool EvaluateSlot(ConditionNode node, ConditionRootResolver resolveRoot)
        {
            WorldObject target = resolveRoot(node.Root);
            if (target?.Parent == null) return false;

            int slotLocal = target.Parent.Def.SlotLayout.ToLocal(node.SlotGlobalId);
            return slotLocal != LocalIndexMap.Missing && target.ParentSlotLocalId == slotLocal;
        }
    }
}
