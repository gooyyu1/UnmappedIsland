using System.Collections.Generic;
using System.Linq;
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

        internal double Resolve(WorldObject self, WorldObject actor, WorldObject dragged)
        {
            if (!isPathRef) return literal;

            WorldObject target = path.Root == ReferenceRoot.Ancestor
                ? self.FindAncestorWithProperty(path.PropertyGlobalId)
                : ReferenceRootResolver.Resolve(path.Root, self, actor, dragged);
            return target != null ? target.GetEffectiveValue(path.PropertyGlobalId) : 0;
        }
    }

    /// <summary>
    /// pickの1候補（GameElementDefinition.md 10節）。weightに加えて、自分自身のactive（対象をキーとする
    /// 辞書）か、さらに別のpickのどちらか一方を持つ（同時には持たない。候補自身がpickを持つ再帰も許容する）。
    /// </summary>
    public sealed class PickCandidateDef
    {
        public WeightSpec Weight { get; }

        /// <summary>activeかpickのどちらか一方のみが非null。どちらもこのPickCandidateDef自身の
        /// ResolveEffectだけが読むため（呼び出し側は結果のActiveEffectしか受け取らない）privateに閉じる
        /// （ActionDefのactive/pickと同じ方針）。</summary>
        private readonly ActiveEffect active;
        private readonly IReadOnlyList<PickCandidateDef> pick;

        public PickCandidateDef(
            WeightSpec weight, ActiveEffect active, IReadOnlyList<PickCandidateDef> pick)
        {
            Weight = weight;
            this.active = active;
            this.pick = pick;
        }

        internal static ActiveEffect ResolveEffect(
            ActiveEffect active,
            IReadOnlyList<PickCandidateDef> pick,
            WorldObject self, WorldObject actor, WorldObject dragged,
            WorldSession session)
        {
            if (active != null) return active;
            if (pick == null || pick.Count == 0) return null;

            PickCandidateDef chosen = SelectWeighted(pick, self, actor, dragged, session);
            return ResolveEffect(chosen.active, chosen.pick, self, actor, dragged, session);
        }

        private static PickCandidateDef SelectWeighted(
            IReadOnlyList<PickCandidateDef> candidates, WorldObject self, WorldObject actor, WorldObject dragged, WorldSession session)
        {
            if (candidates.Count == 1) return candidates[0];

            var weights = candidates.Select(c => System.Math.Max(0, c.Weight.Resolve(self, actor, dragged))).ToList();
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
}
