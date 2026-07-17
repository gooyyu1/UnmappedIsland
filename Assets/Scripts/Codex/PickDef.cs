using System.Collections.Generic;

namespace UnmappedIsland.Codex
{
    /// <summary>pick候補のweight（10.2節）。リテラル定数か、既存propsへのパス参照のいずれか。</summary>
    public readonly struct WeightSpec
    {
        public readonly bool IsPathRef;
        public readonly double Literal;
        public readonly PropertyPath Path;

        private WeightSpec(bool isPathRef, double literal, PropertyPath path)
        {
            IsPathRef = isPathRef;
            Literal = literal;
            Path = path;
        }

        public static WeightSpec FromLiteral(double literal) => new WeightSpec(false, literal, default);
        public static WeightSpec FromPath(PropertyPath path) => new WeightSpec(true, 0, path);
    }

    /// <summary>
    /// pickの1候補（GameElementDefinition.md 10節）。weightに加えて、自分自身のactive（対象をキーとする
    /// 辞書）か、さらに別のpickのどちらか一方を持つ（同時には持たない。候補自身がpickを持つ再帰も許容する）。
    /// </summary>
    public sealed class PickCandidateDef
    {
        public WeightSpec Weight { get; }

        /// <summary>ActiveかPickのどちらか一方のみが非null。</summary>
        public IReadOnlyDictionary<ReferenceRoot, ActiveEffect> Active { get; }
        public IReadOnlyList<PickCandidateDef> Pick { get; }

        public PickCandidateDef(
            WeightSpec weight, IReadOnlyDictionary<ReferenceRoot, ActiveEffect> active, IReadOnlyList<PickCandidateDef> pick)
        {
            Weight = weight;
            Active = active;
            Pick = pick;
        }
    }
}
