using System;
using System.Collections.Generic;
using System.Linq;
using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain.Defs
{
    /// <summary>
    /// アクション・combination・pick候補が「条件成立時に何を起こすか」を表す実行結果（9・10節）。
    /// 直接の active（ActiveEffect）か、weightで1つ選ぶ pick（さらに再帰しうる候補列）の
    /// どちらか一方のみを持つ（どちらも無ければ何も起きない）。
    ///
    /// ActionDef・CombinationDef・PickCandidateDefはいずれも「conditions等の固有部分＋この実行結果」という
    /// 同じ構造を持つため、active/pickの保持と「結局どのActiveEffectを適用するか」の解決（active優先、
    /// 無ければweight抽選で1候補を選び、その候補の実行結果へ再帰）をこの1つの型に集約する。各Defはこの型を
    /// 1つ持ち、Resolveへ委譲するだけでよい（自分のことは自分でする、CLAUDE.md参照）。
    /// </summary>
    public sealed class EffectOutcome
    {
        /// <summary>activeかpickのどちらか一方のみが非null（どちらも無ければResolveはnull＝何も起きない）。</summary>
        private readonly ActiveEffect active;
        private readonly IReadOnlyList<PickCandidateDef> pick;

        public EffectOutcome(ActiveEffect active, IReadOnlyList<PickCandidateDef> pick)
        {
            this.active = active;
            this.pick = pick;
        }

        /// <summary>
        /// 実際に適用するActiveEffectを解決する。activeがあればそれを返す。無ければpickをweightで1つ選び、
        /// 選ばれた候補の実行結果へ再帰する。activeもpickも無ければnull（条件成立時に何も起きない）。
        /// </summary>
        public ActiveEffect Resolve(WorldObject self, WorldObject actor, WorldObject dragged, WorldSession session)
        {
            if (active != null) return active;
            if (pick == null || pick.Count == 0) return null;

            PickCandidateDef chosen = SelectWeighted(self, actor, dragged, session);
            return chosen.Outcome.Resolve(self, actor, dragged, session);
        }

        /// <summary>自分のpick候補群を、それぞれのweightで重み付き抽選して1つ選ぶ。Resolveが事前に
        /// pickの非null・非空を保証してから呼ぶ。</summary>
        private PickCandidateDef SelectWeighted(WorldObject self, WorldObject actor, WorldObject dragged, WorldSession session)
        {
            if (pick.Count == 1) return pick[0];

            var weights = pick.Select(c => Math.Max(0, c.ResolveWeight(self, actor, dragged))).ToList();
            double total = weights.Sum();
            if (total <= 0) return pick[0];

            double roll = session.Rng.NextDouble() * total;
            double cumulative = 0;
            for (int i = 0; i < pick.Count; i++)
            {
                cumulative += weights[i];
                if (roll < cumulative) return pick[i];
            }

            return pick[pick.Count - 1];
        }
    }
}
