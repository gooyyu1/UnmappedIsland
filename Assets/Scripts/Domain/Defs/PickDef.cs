using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain.Defs
{
    /// <summary>pick候補のweight（10.2節）。リテラル定数か、既存propsへのパス参照のいずれか。</summary>
    public readonly struct WeightSpec
    {
        private readonly bool isPathRef;
        private readonly double literal;
        private readonly PropertyPath path;

        private WeightSpec(bool isPathRef, double literal, PropertyPath path)
        {
            this.isPathRef = isPathRef;
            this.literal = literal;
            this.path = path;
        }

        public static WeightSpec FromLiteral(double literal) => new WeightSpec(false, literal, default);
        public static WeightSpec FromPath(PropertyPath path) => new WeightSpec(true, 0, path);

        public double Resolve(WorldObject self, WorldObject actor, WorldObject dragged)
        {
            if (!isPathRef) return literal;

            WorldObject target = path.Root == ReferenceRoot.Ancestor
                ? self.FindAncestorWithProperty(path.PropertyGlobalId)
                : ReferenceRootResolver.Resolve(path.Root, self, actor, dragged);
            return target != null ? target.GetEffectiveValue(path.PropertyGlobalId) : 0;
        }
    }

    /// <summary>
    /// pickの1候補（GameElementDefinition.md 10節）。抽選の重み（weight）と、この候補が選ばれたときの
    /// 実行結果（EffectOutcome＝active/pickのどちらか一方。候補自身がさらにpickを持つ再帰も許容する）を持つ。
    /// </summary>
    public sealed class PickCandidateDef
    {
        /// <summary>抽選の重み（10.2節）。ResolveWeight越しにEffectOutcomeが読むだけのため公開しない。</summary>
        private readonly WeightSpec weight;

        /// <summary>この候補が選ばれたときの実行結果（さらにpickを持てば再帰する）。EffectOutcome.Resolveが読む。</summary>
        public EffectOutcome Outcome { get; }

        public PickCandidateDef(WeightSpec weight, EffectOutcome outcome)
        {
            this.weight = weight;
            Outcome = outcome;
        }

        /// <summary>この候補の抽選重みを、現在の文脈で解決する（EffectOutcomeのweight抽選が使う）。</summary>
        public double ResolveWeight(WorldObject self, WorldObject actor, WorldObject dragged) =>
            weight.Resolve(self, actor, dragged);
    }
}
