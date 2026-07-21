using System;
using System.Collections.Generic;
using System.Linq;
using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain.Defs
{
    /// <summary>
    /// pick（10節）: weightで1候補を選び、その候補の効果を適用する効果。自分もまたActiveEffectであり
    /// （activeと排他な選択肢の一方）、選ばれた候補の効果もまたActiveEffect（さらにpickなら再帰する）。
    ///
    /// 抽選（weight按分）と適用を自分で完結させる。候補が無ければ何もしない（条件成立時に何も起きない）。
    /// 選択に使うRNGはsessionから、weightの解決に使う文脈はApplyの引数(owner=self/actor/dragged)から得る。
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
            WorldObject.ActiveApplication context)
        {
            if (candidates == null || candidates.Count == 0) return;
            PickCandidateDef chosen = SelectWeighted(owner, actor, dragged, session);
            chosen.Apply(owner, session, actor, dragged, context);
        }

        /// <summary>候補群を、それぞれのweightで重み付き抽選して1つ選ぶ。候補が非空であることは
        /// Applyが事前に保証してから呼ぶ。</summary>
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
}
