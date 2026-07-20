using System.Collections.Generic;
using System.Linq;
using UnmappedIsland.Domain.Defs;

namespace UnmappedIsland.Domain.Runtime
{
    /// <summary>
    /// actions（GameElementDefinition.md 11節）・combinations（12節）の実行エンジン。conditionsの評価、
    /// pick（10節）の重み付き抽選、解決した1つのActiveEffectをselfへ適用するところまでをここで担う。
    ///
    /// set/add/destroyの対象(self/parent/actor/dragged)ごとの解決はWorldObject.ApplyActiveEffectに
    /// 集約されている。ここに残るResolveTargetはconditions/weightのpath解決専用。
    /// </summary>
    public static class InteractionExecutor
    {
        /// <summary>
        /// selfが持つactionNameのアクションを、actor視点で実行を試みる。アクションが存在しない、
        /// conditionsを満たさない場合はfalseを返し、何も変更しない。
        /// </summary>
        public static bool TryExecuteAction(WorldObject self, WorldObject actor, string actionName, WorldSession session)
        {
            self = self.ResolveInteractionTarget();
            ActionDef action = self.Def.Actions.FirstOrDefault(a => a.Name == actionName);
            if (action == null) return false;
            if (!EvaluateConditions(action.Conditions, self, actor, dragged: null)) return false;

            ActiveEffect effect = ResolveEffect(action.Active, action.Pick, self, actor, dragged: null, session);
            if (effect != null) self.ApplyActiveEffect(effect, session, actor, dragged: null);
            return true;
        }

        /// <summary>
        /// selfにdraggedをドロップした結果、combinationNameのcombinationを実行を試みる。combinationが
        /// 存在しない、withがdraggedにマッチしない、conditionsを満たさない場合はfalseを返す。
        /// </summary>
        public static bool TryExecuteCombination(
            WorldObject self, WorldObject dragged, WorldObject actor, string combinationName, WorldSession session)
        {
            self = self.ResolveInteractionTarget();
            dragged = dragged.ResolveInteractionTarget();
            CombinationDef combination = self.Def.Combinations.FirstOrDefault(c => c.Name == combinationName);
            if (combination == null) return false;
            if (!combination.Matches(dragged.Def)) return false;
            if (!EvaluateConditions(combination.Conditions, self, actor, dragged)) return false;

            ActiveEffect effect = ResolveEffect(combination.Active, combination.Pick, self, actor, dragged, session);
            if (effect != null) self.ApplyActiveEffect(effect, session, actor, dragged);
            return true;
        }

        /// <summary>{object, prop, op, value}の条件木（14節、all/any/notを含む）を満たすか。nullは常に真。</summary>
        public static bool EvaluateConditions(ConditionNode conditions, WorldObject self, WorldObject actor, WorldObject dragged) =>
            ConditionEvaluator.Evaluate(conditions, root => ResolveTarget(root, self, actor, dragged));

        /// <summary>
        /// selfにdraggedをドロップしようとした際に成立しうるcombinationsを、宣言順にすべて列挙する
        /// （conditionsは評価しない。ドラッグ中のハイライト等、UIが候補を把握するための問い合わせ用途）。
        /// </summary>
        public static IEnumerable<CombinationDef> FindMatchingCombinations(WorldObject self, WorldObject dragged)
        {
            self = self.ResolveInteractionTarget();
            dragged = dragged.ResolveInteractionTarget();
            return self.Def.Combinations.Where(c => c.Matches(dragged.Def));
        }

        /// <summary>
        /// activeが直接指定されていればそれをそのまま使い、pickが指定されていれば重み付き抽選で1候補を
        /// 選び（再帰的に）解決する。両方nullの場合はnullを返す（何も起きない）。
        /// </summary>
        private static ActiveEffect ResolveEffect(
            ActiveEffect active,
            IReadOnlyList<PickCandidateDef> pick,
            WorldObject self, WorldObject actor, WorldObject dragged,
            WorldSession session)
        {
            if (active != null) return active;
            if (pick == null || pick.Count == 0) return null;

            PickCandidateDef chosen = SelectWeighted(pick, self, actor, dragged, session);
            return ResolveEffect(chosen.Active, chosen.Pick, self, actor, dragged, session);
        }

        /// <summary>
        /// 重み付き抽選（10節）。候補が1つしかなければ重みに関わらず必ずそれを選ぶ。全候補の重みの合計が
        /// 0以下（負の重みを許容していないため通常起きないが、pathの参照先が0以下の場合はありうる）の
        /// 場合は、フォールバック候補がYAML側に存在しないため、宣言順で先頭の候補を選ぶ。
        /// </summary>
        private static PickCandidateDef SelectWeighted(
            IReadOnlyList<PickCandidateDef> candidates, WorldObject self, WorldObject actor, WorldObject dragged, WorldSession session)
        {
            if (candidates.Count == 1) return candidates[0];

            var weights = candidates.Select(c => System.Math.Max(0, ResolveWeight(c.Weight, self, actor, dragged))).ToList();
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

        private static double ResolveWeight(WeightSpec weight, WorldObject self, WorldObject actor, WorldObject dragged)
        {
            if (!weight.IsPathRef) return weight.Literal;

            WorldObject target = weight.Path.Root == ReferenceRoot.Ancestor
                ? self.FindAncestorWithProperty(weight.Path.PropertyGlobalId)
                : ResolveTarget(weight.Path.Root, self, actor, dragged);
            return target != null ? target.GetEffectiveValue(weight.Path.PropertyGlobalId) : 0;
        }

        /// <summary>条件式・weightのpath解決専用。set/add/destroyの対象解決はWorldObject.ApplyActiveEffect
        /// に閉じている（こちらはActiveEffectを持たない、単なる{root}→WorldObjectの解決）。</summary>
        private static WorldObject ResolveTarget(ReferenceRoot root, WorldObject self, WorldObject actor, WorldObject dragged)
        {
            switch (root)
            {
                case ReferenceRoot.Self: return self;
                case ReferenceRoot.Parent: return self.Parent;
                case ReferenceRoot.Actor: return actor;
                case ReferenceRoot.Dragged: return dragged;
                case ReferenceRoot.DraggedParent: return dragged?.Parent;
                default: return null;
            }
        }
    }
}
