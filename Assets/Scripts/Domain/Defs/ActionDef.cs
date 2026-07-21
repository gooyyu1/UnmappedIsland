using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain.Defs
{
    /// <summary>showMenuの値（11.1節）。現時点ではalwaysのみ（ActionSystem.md 4節: 他の値の要否は未決定）。</summary>
    public enum ShowMenuMode
    {
        Always,
    }

    /// <summary>
    /// メニュー型の宣言的操作（GameElementDefinition.md 11節）。conditionsと実行結果（EffectOutcome＝
    /// active/pick）を1つの定義としてまとめて持つ。object_defs/traitsの中に、識別子をキーとする辞書として
    /// 配置される。
    /// </summary>
    public sealed class ActionDef
    {
        public string Name { get; }
        public ShowMenuMode ShowMenu { get; }

        /// <summary>nullなら常に真（conditions省略）。</summary>
        private readonly ConditionNode conditions;

        /// <summary>条件成立時の実行結果（active/pickの解決はEffectOutcome自身が行う）。</summary>
        private readonly EffectOutcome outcome;

        public ActionDef(
            string name,
            ShowMenuMode showMenu,
            ConditionNode conditions,
            EffectOutcome outcome)
        {
            Name = name;
            ShowMenu = showMenu;
            this.conditions = conditions;
            this.outcome = outcome;
        }

        public bool TryExecute(WorldObject self, WorldObject actor, WorldSession session)
        {
            if (conditions != null && !conditions.Evaluate(root => ReferenceRootResolver.Resolve(root, self, actor, dragged: null)))
                return false;

            ActiveEffect effect = outcome.Resolve(self, actor, dragged: null, session);
            if (effect != null) self.ApplyActiveEffect(effect, session, actor, dragged: null);
            return true;
        }
    }
}
