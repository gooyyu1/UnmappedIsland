using System;
using System.Collections.Generic;
using System.Linq;
using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain.Defs
{
    /// <summary>GameElementDefinition.md 14.1節の比較演算子。</summary>
    public enum ConditionOp
    {
        Lt,
        Lte,
        Gt,
        Gte,
        Eq,
        Neq,
        In,
        NotIn,
    }

    public enum ConditionNodeKind
    {
        /// <summary>{object, prop, op, value}形式のプロパティ比較。</summary>
        Property,

        /// <summary>{object, in_slot}形式。objectが今まさに親のin_slotに入っているか（常に等価判定でopは
        /// 持たない。否定はNotで包む）。「objectが外から見てどこに位置するか」を見る。</summary>
        SlotPosition,

        /// <summary>{object, slot, tag}形式。object自身が持つslotの中に、tagを持つ子が1つでもあるか
        /// （存在判定でopは持たない）。SlotPositionとは向きが逆で「objectの内側、自分のスロットの中身」を見る。</summary>
        SlotContent,

        /// <summary>{object, tag}形式。object自身がtagを持つか（存在判定）。</summary>
        ObjectTag,

        /// <summary>子ノードすべての論理積。</summary>
        All,

        /// <summary>子ノードのいずれかの論理和。</summary>
        Any,

        /// <summary>子ノード（常に1つ）の否定。</summary>
        Not,
    }

    /// <summary>
    /// conditions（14節）の1ノード。actions/combinationsの一度きりの判定と、passivesの持続的なゲートが
    /// 同じ木を共用する。葉はProperty・SlotPosition・SlotContent・ObjectTagの4種、複合はAll/Any/Notの3種で、
    /// Kindに応じて使うフィールドが変わる（単一クラス+Kind enum）。
    /// </summary>
    public sealed class ConditionNode
    {
        private readonly ConditionNodeKind kind;

        /// <summary>Property/SlotPosition/SlotContent/ObjectTag葉のみ有効。</summary>
        private readonly ReferenceRoot root;

        /// <summary>Property葉のみ有効。</summary>
        private readonly int propertyGlobalId;

        /// <summary>Property葉のみ有効。</summary>
        private readonly ConditionOp op;

        /// <summary>Property葉のみ有効かつValueRefがnullの場合のみ使う。lt/lte/gt/gte/eq/neqは常に1要素。
        /// in/not_inは複数要素になりうる。</summary>
        private readonly IReadOnlyList<int> values;

        /// <summary>Property葉のみ有効。非nullなら、リテラルvalue（Values）の代わりに{object, prop}参照先の
        /// 現在の実効値と比較する（10.2節と同じ「リテラルか参照か」の二択）。in/not_inでは意味を持たない
        /// （ロード時エラー）。</summary>
        private readonly PropertyPath? valueRef;

        /// <summary>SlotPosition/SlotContent葉のみ有効。SlotPositionではobjectの親の中の位置、
        /// SlotContentではobject自身が持つスロットを指す（向きが異なる）。</summary>
        private readonly int slotGlobalId;

        /// <summary>SlotContent/ObjectTag葉のみ有効。</summary>
        private readonly int tagGlobalId;

        /// <summary>All/Any/Notのみ有効。Notは常に1要素。</summary>
        private readonly IReadOnlyList<ConditionNode> children;

        private ConditionNode(
            ConditionNodeKind kind, ReferenceRoot root, int propertyGlobalId, ConditionOp op,
            IReadOnlyList<int> values, PropertyPath? valueRef,
            int slotGlobalId, int tagGlobalId, IReadOnlyList<ConditionNode> children)
        {
            this.kind = kind;
            this.root = root;
            this.propertyGlobalId = propertyGlobalId;
            this.op = op;
            this.values = values;
            this.valueRef = valueRef;
            this.slotGlobalId = slotGlobalId;
            this.tagGlobalId = tagGlobalId;
            this.children = children;
        }

        public static ConditionNode Property(
            ReferenceRoot root, int propertyGlobalId, ConditionOp op,
            IReadOnlyList<int> values, PropertyPath? valueRef = null) =>
            new ConditionNode(ConditionNodeKind.Property, root, propertyGlobalId, op, values, valueRef, default, default, null);

        public static ConditionNode SlotPosition(ReferenceRoot root, int slotGlobalId) =>
            new ConditionNode(ConditionNodeKind.SlotPosition, root, default, default, null, null, slotGlobalId, default, null);

        public static ConditionNode SlotContent(ReferenceRoot root, int slotGlobalId, int tagGlobalId) =>
            new ConditionNode(ConditionNodeKind.SlotContent, root, default, default, null, null, slotGlobalId, tagGlobalId, null);

        public static ConditionNode ObjectTag(ReferenceRoot root, int tagGlobalId) =>
            new ConditionNode(ConditionNodeKind.ObjectTag, root, default, default, null, null, default, tagGlobalId, null);

        public static ConditionNode All(IReadOnlyList<ConditionNode> children) =>
            new ConditionNode(ConditionNodeKind.All, default, default, default, null, null, default, default, children);

        public static ConditionNode Any(IReadOnlyList<ConditionNode> children) =>
            new ConditionNode(ConditionNodeKind.Any, default, default, default, null, null, default, default, children);

        public static ConditionNode Not(ConditionNode inner) =>
            new ConditionNode(ConditionNodeKind.Not, default, default, default, null, null, default, default, new[] { inner });

        public bool Evaluate(Func<ReferenceRoot, WorldObject> resolveRoot)
        {
            switch (kind)
            {
                case ConditionNodeKind.Property: return EvaluateProperty(resolveRoot);
                case ConditionNodeKind.SlotPosition: return EvaluateSlotPosition(resolveRoot);
                case ConditionNodeKind.SlotContent: return EvaluateSlotContent(resolveRoot);
                case ConditionNodeKind.ObjectTag: return EvaluateObjectTag(resolveRoot);
                case ConditionNodeKind.All: return children.All(child => child.Evaluate(resolveRoot));
                case ConditionNodeKind.Any: return children.Any(child => child.Evaluate(resolveRoot));
                case ConditionNodeKind.Not: return !children[0].Evaluate(resolveRoot);
                default: return false;
            }
        }

        private bool EvaluateProperty(Func<ReferenceRoot, WorldObject> resolveRoot)
        {
            int? currentValue = ResolvePropertyEffectiveValue(root, propertyGlobalId, resolveRoot);
            if (currentValue == null) return false;
            int current = currentValue.Value;

            if (op == ConditionOp.In) return values.Any(v => current == v);
            if (op == ConditionOp.NotIn) return !values.Any(v => current == v);

            int compare;
            if (valueRef.HasValue)
            {
                int? resolved = ResolvePropertyEffectiveValue(valueRef.Value.Root, valueRef.Value.PropertyGlobalId, resolveRoot);
                if (resolved == null) return false;
                compare = resolved.Value;
            }
            else
            {
                compare = values[0];
            }

            switch (op)
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

        private int? ResolvePropertyEffectiveValue(
            ReferenceRoot root, int propertyGlobalId, Func<ReferenceRoot, WorldObject> resolveRoot)
        {
            WorldObject target = root == ReferenceRoot.Ancestor
                ? resolveRoot(ReferenceRoot.Self)?.FindAncestorWithProperty(propertyGlobalId)
                : resolveRoot(root);
            if (target == null) return null;
            return target.TryGetProperty(propertyGlobalId, out PropertyValue value) ? value.GetEffectiveValue() : (int?)null;
        }

        private bool EvaluateSlotPosition(Func<ReferenceRoot, WorldObject> resolveRoot)
        {
            WorldObject target = resolveRoot(root);
            if (target?.Parent == null) return false;

            int slotLocal = target.Parent.Def.SlotLayout.ToLocal(slotGlobalId);
            return slotLocal != LocalIndexMap.Missing && target.ParentSlotLocalId == slotLocal;
        }

        private bool EvaluateSlotContent(Func<ReferenceRoot, WorldObject> resolveRoot)
        {
            WorldObject target = resolveRoot(root);
            if (target == null || !target.TryGetSlot(slotGlobalId, out Slot slot)) return false;
            return slot.Contents.Any(child => child.Def.Tags.Contains(tagGlobalId));
        }

        private bool EvaluateObjectTag(Func<ReferenceRoot, WorldObject> resolveRoot)
        {
            WorldObject target = resolveRoot(root);
            return target != null && target.Def.Tags.Contains(tagGlobalId);
        }
    }
}
