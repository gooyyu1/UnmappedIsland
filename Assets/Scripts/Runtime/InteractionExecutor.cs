using System.Collections.Generic;
using System.Linq;
using UnmappedIsland.Codex;

namespace UnmappedIsland.Runtime
{
    /// <summary>
    /// actions（GameElementDefinition.md 11節）・combinations（12節）の実行エンジン。conditionsの評価、
    /// pick（10節）の重み付き抽選、解決したactiveの対象ごとの適用までをここで担う。
    ///
    /// self/parent/actor/dragged の対象解決はすべてここに閉じており、WorldObject.ApplyActiveEffect
    /// （解決済みの1つのWorldObjectに対してadd/destroy/spawnを適用するだけの処理）を呼び出す側。
    /// </summary>
    public static class InteractionExecutor
    {
        /// <summary>
        /// selfが持つactionNameのアクションを、actor視点で実行を試みる。アクションが存在しない、
        /// conditionsを満たさない場合はfalseを返し、何も変更しない。
        /// </summary>
        public static bool TryExecuteAction(WorldObject self, WorldObject actor, string actionName, WorldSession session)
        {
            ActionDef action = self.Def.Actions.FirstOrDefault(a => a.Name == actionName);
            if (action == null) return false;
            if (!EvaluateConditions(action.Conditions, self, actor, dragged: null)) return false;

            var effects = ResolveEffects(action.Active, action.Pick, self, actor, dragged: null, session);
            ApplyActiveEffects(effects, self, actor, dragged: null, session);
            return true;
        }

        /// <summary>
        /// selfにdraggedをドロップした結果、combinationNameのcombinationを実行を試みる。combinationが
        /// 存在しない、withがdraggedにマッチしない、conditionsを満たさない場合はfalseを返す。
        /// </summary>
        public static bool TryExecuteCombination(
            WorldObject self, WorldObject dragged, WorldObject actor, string combinationName, WorldSession session)
        {
            CombinationDef combination = self.Def.Combinations.FirstOrDefault(c => c.Name == combinationName);
            if (combination == null) return false;
            if (!combination.Matches(dragged.Def)) return false;
            if (!EvaluateConditions(combination.Conditions, self, actor, dragged)) return false;

            var effects = ResolveEffects(combination.Active, combination.Pick, self, actor, dragged, session);
            ApplyActiveEffects(effects, self, actor, dragged, session);
            return true;
        }

        /// <summary>
        /// selfにdraggedをドロップしようとした際に成立しうるcombinationsを、宣言順にすべて列挙する
        /// （conditionsは評価しない。ドラッグ中のハイライト等、UIが候補を把握するための問い合わせ用途）。
        /// </summary>
        public static IEnumerable<CombinationDef> FindMatchingCombinations(WorldObject self, WorldObject dragged)
        {
            return self.Def.Combinations.Where(c => c.Matches(dragged.Def));
        }

        /// <summary>{path, op, value}のANDリストをすべて満たすか（14節）。空リストは常に真。</summary>
        public static bool EvaluateConditions(
            IReadOnlyList<ConditionDef> conditions, WorldObject self, WorldObject actor, WorldObject dragged)
        {
            foreach (var condition in conditions)
                if (!EvaluateCondition(condition, self, actor, dragged))
                    return false;
            return true;
        }

        private static bool EvaluateCondition(ConditionDef condition, WorldObject self, WorldObject actor, WorldObject dragged)
        {
            WorldObject target = ResolveTarget(condition.Path.Root, self, actor, dragged);
            if (target == null) return false;
            if (!target.TryGetProperty(condition.Path.PropertyGlobalId, out PropertyValue current)) return false;

            switch (condition.Op)
            {
                case ConditionOp.Lt: return current.AsNumber() < condition.Values[0].AsNumber();
                case ConditionOp.Lte: return current.AsNumber() <= condition.Values[0].AsNumber();
                case ConditionOp.Gt: return current.AsNumber() > condition.Values[0].AsNumber();
                case ConditionOp.Gte: return current.AsNumber() >= condition.Values[0].AsNumber();
                case ConditionOp.Eq: return ValueEquals(current, condition.Values[0]);
                case ConditionOp.Neq: return !ValueEquals(current, condition.Values[0]);
                case ConditionOp.In: return condition.Values.Any(v => ValueEquals(current, v));
                case ConditionOp.NotIn: return !condition.Values.Any(v => ValueEquals(current, v));
                default: return false;
            }
        }

        private static bool ValueEquals(PropertyValue a, PropertyValue b)
        {
            if (a.Kind != b.Kind) return false;
            return a.Kind == PropertyValueKind.Number ? a.Number == b.Number : a.Symbol == b.Symbol;
        }

        /// <summary>
        /// activeが直接指定されていればそれをそのまま使い、pickが指定されていれば重み付き抽選で1候補を
        /// 選び（再帰的に）解決する。両方nullの場合はnullを返す（何も起きない）。
        /// </summary>
        private static IReadOnlyDictionary<ReferenceRoot, ActiveEffect> ResolveEffects(
            IReadOnlyDictionary<ReferenceRoot, ActiveEffect> active,
            IReadOnlyList<PickCandidateDef> pick,
            WorldObject self, WorldObject actor, WorldObject dragged,
            WorldSession session)
        {
            if (active != null) return active;
            if (pick == null || pick.Count == 0) return null;

            PickCandidateDef chosen = SelectWeighted(pick, self, actor, dragged, session);
            return ResolveEffects(chosen.Active, chosen.Pick, self, actor, dragged, session);
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

            WorldObject target = ResolveTarget(weight.Path.Root, self, actor, dragged);
            return target != null ? target.GetEffectiveValue(weight.Path.PropertyGlobalId) : 0;
        }

        /// <summary>
        /// 解決したactiveの対象キー(self/parent/actor/dragged)ごとに、対応するWorldObjectへ適用する。
        /// 対象が解決できない場合（parentが無い、actor/draggedがこの実行文脈に無い）は何もしない。
        /// 複数の対象キー間の適用順序はYAML側で規定されていないため、self→parent→actor→draggedの
        /// 固定順で決定的に処理する。
        /// </summary>
        private static void ApplyActiveEffects(
            IReadOnlyDictionary<ReferenceRoot, ActiveEffect> effects,
            WorldObject self, WorldObject actor, WorldObject dragged,
            WorldSession session)
        {
            if (effects == null) return;

            foreach (ReferenceRoot key in OrderedTargets)
            {
                if (!effects.TryGetValue(key, out ActiveEffect effect)) continue;
                WorldObject target = ResolveTarget(key, self, actor, dragged);
                if (target == null) continue;
                target.ApplyActiveEffect(effect, session, actor);
            }
        }

        private static readonly ReferenceRoot[] OrderedTargets =
        {
            ReferenceRoot.Self, ReferenceRoot.Parent, ReferenceRoot.Actor, ReferenceRoot.Dragged,
        };

        private static WorldObject ResolveTarget(ReferenceRoot root, WorldObject self, WorldObject actor, WorldObject dragged)
        {
            switch (root)
            {
                case ReferenceRoot.Self: return self;
                case ReferenceRoot.Parent: return self.Parent;
                case ReferenceRoot.Actor: return actor;
                case ReferenceRoot.Dragged: return dragged;
                default: return null;
            }
        }
    }
}
