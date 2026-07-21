using System.Linq;
using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain.Defs
{
    /// <summary>
    /// ドラッグ型のカード間相互作用（GameElementDefinition.md 12節）。ドロップされた側（受け側）の
    /// object_defに定義する。Withは、ドラッグされてきたカードとのマッチング条件（タグのグローバルID、12.1節）。
    /// conditionsと実行結果（EffectOutcome＝active/pick）を1つの定義としてまとめて持つ。
    /// </summary>
    public sealed class CombinationDef
    {
        public string Name { get; }
        private readonly int with;

        /// <summary>nullなら常に真（conditions省略）。</summary>
        private readonly ConditionNode conditions;

        /// <summary>条件成立時の実行結果（active/pickの解決はEffectOutcome自身が行う）。</summary>
        private readonly EffectOutcome outcome;

        public CombinationDef(
            string name,
            int with,
            ConditionNode conditions,
            EffectOutcome outcome)
        {
            Name = name;
            this.with = with;
            this.conditions = conditions;
            this.outcome = outcome;
        }

        /// <summary>draggedDefがこのcombinationのWithタグを持っていれば真（12.1節）。</summary>
        public bool Matches(ObjectDef draggedDef) => draggedDef.Tags.Contains(with);

        public bool TryExecute(WorldObject self, WorldObject dragged, WorldObject actor, WorldSession session)
        {
            if (!Matches(dragged.Def)) return false;
            if (conditions != null && !conditions.Evaluate(root => ReferenceRootResolver.Resolve(root, self, actor, dragged)))
                return false;

            ActiveEffect effect = outcome.Resolve(self, actor, dragged, session);
            if (effect != null) self.ApplyActiveEffect(effect, session, actor, dragged);
            return true;
        }
    }
}
