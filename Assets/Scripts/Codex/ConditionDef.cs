using System.Collections.Generic;
using UnmappedIsland.Runtime;

namespace UnmappedIsland.Codex
{
    /// <summary>
    /// conditions（GameElementDefinition.md 14節）・weight（10.2節）・passivesのゲート（8節）が共通で参照する
    /// 起点。self.prop/parent.propのような1階層の参照のみを対象とする（複数階層のパスは現状の用例に
    /// 存在しないため未対応）。worldは唯一のシングルトンインスタンスを実行時に追跡する仕組みがまだ無いため、
    /// 起点としては未対応（14.1節参照。ロード時にエラーとする）。
    /// </summary>
    public enum ReferenceRoot
    {
        Self,
        Parent,
        Actor,

        /// <summary>combinations内でのみ意味を持つ、ドラッグされてきたカード（12.2節）。</summary>
        Dragged,
    }

    /// <summary>{object, prop}が指す、1階層のプロパティ参照。weightのpath参照（10.2節）で使う。</summary>
    public readonly struct PropertyPath
    {
        public readonly ReferenceRoot Root;
        public readonly int PropertyGlobalId;

        public PropertyPath(ReferenceRoot root, int propertyGlobalId)
        {
            Root = root;
            PropertyGlobalId = propertyGlobalId;
        }
    }

    /// <summary>GameElementDefinition.md 14.2節の比較演算子。</summary>
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

        /// <summary>{object, slot}形式の、objectが指すオブジェクト自身の現在のスロット位置チェック
        /// （常に等価判定。opは持たない。否定したい場合はNotで包む）。</summary>
        Slot,

        /// <summary>子ノードすべての論理積。</summary>
        All,

        /// <summary>子ノードのいずれかの論理和。</summary>
        Any,

        /// <summary>子ノード（常に1つ）の否定。</summary>
        Not,
    }

    /// <summary>
    /// conditions（14節）の1ノード。actions/combinationsの一度きりの判定と、passivesの持続的なゲート
    /// （旧when）の両方が、この同じ木を共用する（評価タイミングの違いだけがRuntime側にある。
    /// Runtime.ConditionEvaluator参照）。
    ///
    /// 葉はPropertyとSlotの2種類、複合ノードはAll/Any/Notの3種類で、Kindに応じて使うフィールドが変わる
    /// （PassiveEffectGate等、本コードベースの既存の「単一クラス+Kind enum」の慣習に合わせる）。
    /// </summary>
    public sealed class ConditionNode
    {
        public ConditionNodeKind Kind { get; }

        /// <summary>Property/Slot葉のみ有効。</summary>
        public ReferenceRoot Root { get; }

        /// <summary>Property葉のみ有効。</summary>
        public int PropertyGlobalId { get; }

        /// <summary>Property葉のみ有効。</summary>
        public ConditionOp Op { get; }

        /// <summary>Property葉のみ有効。lt/lte/gt/gte/eq/neqは常に1要素。in/not_inは複数要素になりうる。</summary>
        public IReadOnlyList<PropertyValue> Values { get; }

        /// <summary>Slot葉のみ有効。</summary>
        public int SlotGlobalId { get; }

        /// <summary>All/Any/Notのみ有効。Notは常に1要素。</summary>
        public IReadOnlyList<ConditionNode> Children { get; }

        private ConditionNode(
            ConditionNodeKind kind, ReferenceRoot root, int propertyGlobalId, ConditionOp op,
            IReadOnlyList<PropertyValue> values, int slotGlobalId, IReadOnlyList<ConditionNode> children)
        {
            Kind = kind;
            Root = root;
            PropertyGlobalId = propertyGlobalId;
            Op = op;
            Values = values;
            SlotGlobalId = slotGlobalId;
            Children = children;
        }

        public static ConditionNode Property(ReferenceRoot root, int propertyGlobalId, ConditionOp op, IReadOnlyList<PropertyValue> values) =>
            new ConditionNode(ConditionNodeKind.Property, root, propertyGlobalId, op, values, default, null);

        public static ConditionNode Slot(ReferenceRoot root, int slotGlobalId) =>
            new ConditionNode(ConditionNodeKind.Slot, root, default, default, null, slotGlobalId, null);

        public static ConditionNode All(IReadOnlyList<ConditionNode> children) =>
            new ConditionNode(ConditionNodeKind.All, default, default, default, null, default, children);

        public static ConditionNode Any(IReadOnlyList<ConditionNode> children) =>
            new ConditionNode(ConditionNodeKind.Any, default, default, default, null, default, children);

        public static ConditionNode Not(ConditionNode inner) =>
            new ConditionNode(ConditionNodeKind.Not, default, default, default, null, default, new[] { inner });
    }
}
