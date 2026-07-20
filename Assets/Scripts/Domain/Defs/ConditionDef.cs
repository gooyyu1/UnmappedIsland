using System.Collections.Generic;
using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain.Defs
{
    /// <summary>
    /// conditions（GameElementDefinition.md 14節）・weight（10.2節）・passivesのゲート（8節）が共通で参照する
    /// 起点。self.prop/parent.propのような1階層の参照のみを対象とする（複数階層のパスは現状の用例に
    /// 存在しないため未対応）。worldは唯一のシングルトンインスタンスを実行時に追跡する仕組みがまだ無いため、
    /// 起点としては未対応（14.1節参照。ロード時にエラーとする）。ただしAncestorが「見つからなければ
    /// worldまで遡る」ことを自然に含むため、世界固有の概念を参照したい場合はAncestorで代替できる。
    /// </summary>
    public enum ReferenceRoot
    {
        Self,
        Parent,
        Actor,

        /// <summary>combinations内でのみ意味を持つ、ドラッグされてきたカード（12.2節）。</summary>
        Dragged,

        /// <summary>selfの直接の親から遡り、参照先のプロパティを定義している最初の祖先（Runtime.
        /// WorldObject.FindAncestorWithProperty参照）。「どのオブジェクトが定義しているか」に依存しない、
        /// 木構造上の実効的な参照のための起点。SlotPosition判定（{in_slot: ...}）では意味を持たないため
        /// 未対応（ロード時エラー）。</summary>
        Ancestor,
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

        /// <summary>{object, in_slot}形式の、objectが指すオブジェクト自身が、今まさに親のin_slotに
        /// 入っているかのチェック（常に等価判定。opは持たない。否定したい場合はNotで包む）。「objectが
        /// 外から見てどこに位置するか」を見る（objectの直接の親の中の位置）。</summary>
        SlotPosition,

        /// <summary>{object, slot, tag}形式の、objectが指すオブジェクト自身が持つslot（自分のスロット）の
        /// 中に、tagを持つ子オブジェクトが1つでもあるかのチェック（存在判定。常に真偽で、opは持たない）。
        /// SlotPositionとは向きが逆で、「objectの内側、自分のスロットの中身」を見る。
        /// 液体容器のような「中身の種類」の判定に使う（案3、コンテナ設計の検討参照）。</summary>
        SlotContent,

        /// <summary>{object, tag}形式の、objectが指すオブジェクト自身がtagを持つかのチェック（存在判定）。
        /// 親オブジェクトのタグで分岐するpassiveなど、「オブジェクト自身の種類」を見たい条件で使う。</summary>
        ObjectTag,

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
    /// 葉はProperty・SlotPosition・SlotContent・ObjectTagの4種類、複合ノードはAll/Any/Notの3種類で、Kindに応じて
    /// 使うフィールドが変わる（PassiveEffectGate等、本コードベースの既存の「単一クラス+Kind enum」の
    /// 慣習に合わせる）。SlotPosition（{in_slot}）とSlotContent（{slot, tag}）はどちらも「スロット」に
    /// 関わるが向きが逆（外から見た位置か、内側の中身か）であるため、キー名自体を別にして衝突を避けている。
    /// </summary>
    public sealed class ConditionNode
    {
        public ConditionNodeKind Kind { get; }

        /// <summary>Property/SlotPosition/SlotContent/ObjectTag葉のみ有効。</summary>
        public ReferenceRoot Root { get; }

        /// <summary>Property葉のみ有効。</summary>
        public int PropertyGlobalId { get; }

        /// <summary>Property葉のみ有効。</summary>
        public ConditionOp Op { get; }

        /// <summary>Property葉のみ有効かつValueRefがnullの場合のみ使う。lt/lte/gt/gte/eq/neqは常に1要素。
        /// in/not_inは複数要素になりうる。</summary>
        public IReadOnlyList<PropertyValue> Values { get; }

        /// <summary>Property葉のみ有効。非nullなら、YAML上のリテラルvalue（Values）の代わりに、この
        /// {object, prop}参照先の現在の実効値と比較する（weightのpath参照、10.2節と同じ「リテラルか
        /// 参照か」の二択をconditionsにも広げたもの）。in/not_inでは意味を持たない（複数値との比較に
        /// なるため。ロード時エラー）。</summary>
        public PropertyPath? ValueRef { get; }

        /// <summary>SlotPosition/SlotContent葉のみ有効。SlotPositionではobjectの親の中の位置、
        /// SlotContentではobject自身が持つスロットを指す（同じ「スロットのグローバルID」というデータ型
        /// だが、参照する木構造上の向きが異なる）。</summary>
        public int SlotGlobalId { get; }

        /// <summary>SlotContent/ObjectTag葉のみ有効。</summary>
        public int TagGlobalId { get; }

        /// <summary>All/Any/Notのみ有効。Notは常に1要素。</summary>
        public IReadOnlyList<ConditionNode> Children { get; }

        private ConditionNode(
            ConditionNodeKind kind, ReferenceRoot root, int propertyGlobalId, ConditionOp op,
            IReadOnlyList<PropertyValue> values, PropertyPath? valueRef,
            int slotGlobalId, int tagGlobalId, IReadOnlyList<ConditionNode> children)
        {
            Kind = kind;
            Root = root;
            PropertyGlobalId = propertyGlobalId;
            Op = op;
            Values = values;
            ValueRef = valueRef;
            SlotGlobalId = slotGlobalId;
            TagGlobalId = tagGlobalId;
            Children = children;
        }

        public static ConditionNode Property(
            ReferenceRoot root, int propertyGlobalId, ConditionOp op,
            IReadOnlyList<PropertyValue> values, PropertyPath? valueRef = null) =>
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
    }
}
