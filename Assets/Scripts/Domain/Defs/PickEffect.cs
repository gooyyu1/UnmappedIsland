using System;
using System.Collections.Generic;
using System.Linq;
using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain.Defs
{
    /// <summary>
    /// pick（10節）: weightで1候補を選び、その候補の効果を適用する効果。候補の効果もActiveEffect
    /// （さらにpickなら再帰する）。候補が無ければ何もしない。
    /// </summary>
    public sealed class PickEffect : ActiveEffect
    {
        private readonly IReadOnlyList<PickCandidateDef> candidates;

        public PickEffect(IReadOnlyList<PickCandidateDef> candidates)
        {
            this.candidates = candidates;
        }

        public override void Apply(
            WorldObject owner, WorldSession session, WorldObject actor, WorldObject dragged,
            WorldObject.EffectSite? effectSite)
        {
            if (candidates == null || candidates.Count == 0) return;
            PickCandidateDef chosen = SelectWeighted(owner, actor, dragged, session);
            chosen.Apply(owner, session, actor, dragged, effectSite);
        }

        /// <summary>weightで重み付き抽選して1つ選ぶ。候補が非空であることは呼び出し側が保証する。</summary>
        private PickCandidateDef SelectWeighted(WorldObject self, WorldObject actor, WorldObject dragged, WorldSession session)
        {
            if (candidates.Count == 1) return candidates[0];

            var weights = candidates.Select(c => Math.Max(0, c.ResolveWeight(self, actor, dragged))).ToList();
            double total = weights.Sum();
            if (total <= 0) return candidates[0];

            double roll = session.Rng.NextDouble() * total;
            double cumulative = 0;
            for (int i = 0; i < candidates.Count; i++)
            {
                cumulative += weights[i];
                if (roll < cumulative) return candidates[i];
            }

            return candidates[candidates.Count - 1];
        }
    }

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
    /// pickの1候補（GameElementDefinition.md 10節)。抽選の重み（weight）と、選ばれたときに適用する効果を持つ。
    /// </summary>
    public sealed class PickCandidateDef
    {
        /// <summary>抽選の重み（10.2節）。</summary>
        private readonly WeightSpec weight;

        /// <summary>この候補が選ばれたときに適用する効果。nullなら何も起きない。</summary>
        private readonly ActiveEffect effect;

        public PickCandidateDef(WeightSpec weight, ActiveEffect effect)
        {
            this.weight = weight;
            this.effect = effect;
        }

        /// <summary>この候補の抽選重みを、現在の文脈で解決する（PickEffectのweight抽選が使う）。</summary>
        public double ResolveWeight(WorldObject self, WorldObject actor, WorldObject dragged) =>
            weight.Resolve(self, actor, dragged);

        /// <summary>この候補が選ばれたときに、自分の効果を適用する（PickEffectが選択後に呼ぶ）。</summary>
        public void Apply(WorldObject owner, WorldSession session, WorldObject actor, WorldObject dragged, WorldObject.EffectSite? effectSite) =>
            effect?.Apply(owner, session, actor, dragged, effectSite);
    }
}
