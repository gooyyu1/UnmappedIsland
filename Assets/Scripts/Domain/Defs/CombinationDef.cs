using System.Linq;
using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain.Defs
{
    /// <summary>
    /// ドラッグ型のカード間相互作用（GameElementDefinition.md 12節）。ドロップされた側（受け側）の
    /// object_defに定義する。Withは、ドラッグされてきたカードとのマッチング条件（タグのグローバルID、12.1節）。
    /// conditionsと条件成立時に適用する効果（ActiveEffect＝active/pickのどちらか一方。排他なので単一の
    /// ActiveEffect変数で表せる）を1つの定義としてまとめて持つ。
    /// </summary>
    public sealed class CombinationDef
    {
        public string Name { get; }
        private readonly int with;

        /// <summary>nullなら常に真（conditions省略）。</summary>
        private readonly ConditionNode conditions;

        /// <summary>条件成立時に適用する効果。nullなら何も起きない。pickの抽選もActiveEffect（PickEffect）
        /// 自身が適用時に行うため、ここは適用を依頼するだけでよい。</summary>
        private readonly ActiveEffect effect;

        public CombinationDef(
            string name,
            int with,
            ConditionNode conditions,
            ActiveEffect effect)
        {
            Name = name;
            this.with = with;
            this.conditions = conditions;
            this.effect = effect;
        }

        /// <summary>draggedDefがこのcombinationのWithタグを持っていれば真（12.1節）。</summary>
        public bool Matches(ObjectDef draggedDef) => draggedDef.Tags.Contains(with);

        public bool TryExecute(WorldObject self, WorldObject dragged, WorldObject actor, WorldSession session)
        {
            if (!Matches(dragged.Def)) return false;
            if (conditions != null && !conditions.Evaluate(root => ReferenceRootResolver.Resolve(root, self, actor, dragged)))
                return false;

            if (effect != null) self.ApplyActiveEffect(effect, session, actor, dragged);
            return true;
        }
    }
}
