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
                case ConditionNodeKind.SlotPosition: return EvaluateSlotPosition(node, resolveRoot);
                case ConditionNodeKind.SlotContent: return EvaluateSlotContent(node, resolveRoot);
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
        /// 参照するため、defを持たないリテラル側では呼べない）。ValueRefが非nullの場合はリテラルの代わりに、
        /// その参照先の実効値を比較対象にする（ResolvePropertyEffectiveValueを、比較元・比較先の両方に
        /// 共通で使う）。in/not_inはValueRefを持たない（ロード時に弾く）。
        ///
        /// Root=Ancestorは「どのプロパティを探すか」が決まらないと解決できない（他のrootと違い、1つの
        /// WorldObjectに一意に定まらない）ため、resolveRootデリゲートには乗せず、selfを起点に
        /// WorldObject.FindAncestorWithPropertyを直接呼ぶ（ResolvePropertyEffectiveValue参照）。
        /// </summary>
        private static bool EvaluateProperty(ConditionNode node, ConditionRootResolver resolveRoot)
        {
            int? currentValue = ResolvePropertyEffectiveValue(node.Root, node.PropertyGlobalId, resolveRoot);
            if (currentValue == null) return false;
            int current = currentValue.Value;

            if (node.Op == ConditionOp.In) return node.Values.Any(v => current == v.AsNumber());
            if (node.Op == ConditionOp.NotIn) return !node.Values.Any(v => current == v.AsNumber());

            int compare;
            if (node.ValueRef.HasValue)
            {
                int? resolved = ResolvePropertyEffectiveValue(node.ValueRef.Value.Root, node.ValueRef.Value.PropertyGlobalId, resolveRoot);
                if (resolved == null) return false;
                compare = resolved.Value;
            }
            else
            {
                compare = node.Values[0].AsNumber();
            }

            switch (node.Op)
            {
                case ConditionOp.Lt: return current < compare;
                case ConditionOp.Lte: return current <= compare;
                case ConditionOp.Gt: return current > compare;
                case ConditionOp.Gte: return current >= compare;
                case ConditionOp.Eq: return current == compare;
                case ConditionOp.Neq: return current != compare;
                default: return false;
            }
        }

        /// <summary>rootが指すオブジェクトのpropertyGlobalId実効値を読む。解決できなければnull
        /// （比較元・比較先のいずれにも使う共通処理。EvaluateProperty参照）。</summary>
        private static int? ResolvePropertyEffectiveValue(ReferenceRoot root, int propertyGlobalId, ConditionRootResolver resolveRoot)
        {
            WorldObject target = root == ReferenceRoot.Ancestor
                ? resolveRoot(ReferenceRoot.Self)?.FindAncestorWithProperty(propertyGlobalId)
                : resolveRoot(root);
            if (target == null) return null;
            return target.TryGetProperty(propertyGlobalId, out PropertyValue value) ? value.GetEffectiveValue() : (int?)null;
        }

        /// <summary>{object, in_slot}: objectが指すオブジェクト自身が、今まさに親のどのスロットに
        /// 入っているかを見る（常に等価判定）。</summary>
        private static bool EvaluateSlotPosition(ConditionNode node, ConditionRootResolver resolveRoot)
        {
            WorldObject target = resolveRoot(node.Root);
            if (target?.Parent == null) return false;

            int slotLocal = target.Parent.Def.SlotLayout.ToLocal(node.SlotGlobalId);
            return slotLocal != LocalIndexMap.Missing && target.ParentSlotLocalId == slotLocal;
        }

        /// <summary>{object, slot, tag}: objectが指すオブジェクト自身が持つslot（自分のスロット）の中に、
        /// tagを持つ子オブジェクトが1つでもあるかを見る（存在判定）。EvaluateSlotPositionとは向きが逆
        /// （objectの内側、自分のスロットの中身を見る）。</summary>
        private static bool EvaluateSlotContent(ConditionNode node, ConditionRootResolver resolveRoot)
        {
            WorldObject target = resolveRoot(node.Root);
            if (target == null || !target.TryGetSlot(node.SlotGlobalId, out Slot slot)) return false;

            return slot.Contents.Any(child => child.Def.Tags.Contains(node.TagGlobalId));
        }
    }
}
