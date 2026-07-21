using System.Collections.Generic;
using System.Linq;
using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain.Defs
{
    /// <summary>
    /// ドラッグ型のカード間相互作用（GameElementDefinition.md 12節）。ドロップされた側（受け側）の
    /// object_defに定義する。Withは、ドラッグされてきたカードとのマッチング条件（タグのグローバルID、12.1節）。
    /// </summary>
    public sealed class CombinationDef
    {
        public string Name { get; }
        private readonly int with;

        /// <summary>nullなら常に真（conditions省略）。</summary>
        private readonly ConditionNode conditions;

        /// <summary>ActiveかPickのどちらか一方のみが非null。</summary>
        private readonly ActiveEffect active;
        private readonly IReadOnlyList<PickCandidateDef> pick;

        public CombinationDef(
            string name,
            int with,
            ConditionNode conditions,
            ActiveEffect active,
            IReadOnlyList<PickCandidateDef> pick)
        {
            Name = name;
            this.with = with;
            this.conditions = conditions;
            this.active = active;
            this.pick = pick;
        }

        /// <summary>draggedDefがこのcombinationのWithタグを持っていれば真（12.1節）。</summary>
        public bool Matches(ObjectDef draggedDef) => draggedDef.Tags.Contains(with);

        internal bool TryExecute(WorldObject self, WorldObject dragged, WorldObject actor, WorldSession session)
        {
            if (!Matches(dragged.Def)) return false;
            if (conditions != null && !conditions.Evaluate(root => ReferenceRootResolver.Resolve(root, self, actor, dragged)))
                return false;

            ActiveEffect effect = PickCandidateDef.ResolveEffect(active, pick, self, actor, dragged, session);
            if (effect != null) self.ApplyActiveEffect(effect, session, actor, dragged);
            return true;
        }
    }
}
