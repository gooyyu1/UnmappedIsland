using System.Collections.Generic;
using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain.Defs
{
    /// <summary>showMenuの値（11.1節）。現時点ではalwaysのみ（ActionSystem.md 4節: 他の値の要否は未決定）。</summary>
    public enum ShowMenuMode
    {
        Always,
    }

    /// <summary>
    /// メニュー型の宣言的操作（GameElementDefinition.md 11節）。conditionsと実行結果(active/pick)を
    /// 1つの定義としてまとめて持つ。object_defs/traitsの中に、識別子をキーとする辞書として配置される。
    /// </summary>
    public sealed class ActionDef
    {
        public string Name { get; }
        public ShowMenuMode ShowMenu { get; }

        /// <summary>nullなら常に真（conditions省略）。</summary>
        private readonly ConditionNode conditions;

        /// <summary>ActiveかPickのどちらか一方のみが非null（どちらも指定しなければ、条件成立時に何も
        /// 起きないアクションになる）。</summary>
        private readonly ActiveEffect active;
        private readonly IReadOnlyList<PickCandidateDef> pick;

        public ActionDef(
            string name,
            ShowMenuMode showMenu,
            ConditionNode conditions,
            ActiveEffect active,
            IReadOnlyList<PickCandidateDef> pick)
        {
            Name = name;
            ShowMenu = showMenu;
            this.conditions = conditions;
            this.active = active;
            this.pick = pick;
        }

        public bool TryExecute(WorldObject self, WorldObject actor, WorldSession session)
        {
            if (conditions != null && !conditions.Evaluate(root => ReferenceRootResolver.Resolve(root, self, actor, dragged: null)))
                return false;

            ActiveEffect effect = PickCandidateDef.ResolveEffect(active, pick, self, actor, dragged: null, session);
            if (effect != null) self.ApplyActiveEffect(effect, session, actor, dragged: null);
            return true;
        }
    }
}
