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

        /// <summary>マッチング対象のタグ（Matches参照）。</summary>
        /// <summary>nullなら常に真（conditions省略）。</summary>
        public ConditionNode Conditions { get; }

        /// <summary>ActiveかPickのどちらか一方のみが非null。</summary>
        public ActiveEffect Active { get; }
        public IReadOnlyList<PickCandidateDef> Pick { get; }

        public CombinationDef(
            string name,
            int with,
            ConditionNode conditions,
            ActiveEffect active,
            IReadOnlyList<PickCandidateDef> pick)
        {
            Name = name;
            this.with = with;
            Conditions = conditions;
            Active = active;
            Pick = pick;
        }

        /// <summary>draggedDefがこのcombinationのWithタグを持っていれば真（12.1節）。</summary>
        public bool Matches(ObjectDef draggedDef) => draggedDef.Tags.Contains(with);

        internal bool TryExecute(WorldObject self, WorldObject dragged, WorldObject actor, WorldSession session)
        {
            if (!Matches(dragged.Def)) return false;
            if (Conditions != null && !Conditions.Evaluate(root => ReferenceRootResolver.Resolve(root, self, actor, dragged)))
                return false;

            ActiveEffect effect = PickCandidateDef.ResolveEffect(Active, Pick, self, actor, dragged, session);
            if (effect != null) self.ApplyActiveEffect(effect, session, actor, dragged);
            return true;
        }
    }
}
