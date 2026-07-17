using System.Collections.Generic;
using UnmappedIsland.Runtime;

namespace UnmappedIsland.Codex
{
    /// <summary>
    /// active/conditions/weightのpath（GameElementDefinition.md 14.1節・10.2節）が参照できる起点。
    /// 本実装ではself.property/parent.propertyのような1階層のパスのみを対象とする（複数階層のパスは
    /// 現状の用例に存在しないため未対応）。worldは唯一のシングルトンインスタンスを実行時に追跡する
    /// 仕組みがまだ無いため、pathのrootとしては未対応（14.1節参照。ロード時にエラーとする）。
    /// </summary>
    public enum ReferenceRoot
    {
        Self,
        Parent,
        Actor,

        /// <summary>combinations内でのみ意味を持つ、ドラッグされてきたカード（12.2節）。</summary>
        Dragged,
    }

    /// <summary>{path}が指す、1階層のプロパティ参照（root.property）。</summary>
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

    /// <summary>
    /// {path, op, value}形式の条件式（14節）。actions/combinationsのconditions（ANDリスト）で使う。
    /// </summary>
    public sealed class ConditionDef
    {
        public PropertyPath Path { get; }
        public ConditionOp Op { get; }

        /// <summary>lt/lte/gt/gte/eq/neqは常に1要素。in/not_inは複数要素になりうる。</summary>
        public IReadOnlyList<PropertyValue> Values { get; }

        public ConditionDef(PropertyPath path, ConditionOp op, IReadOnlyList<PropertyValue> values)
        {
            Path = path;
            Op = op;
            Values = values;
        }
    }
}
