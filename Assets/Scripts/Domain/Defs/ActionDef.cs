using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain.Defs
{
    /// <summary>showMenuの値（11.1節）。現時点ではalwaysのみ（ActionSystem.md 4節: 他の値の要否は未決定）。</summary>
    public enum ShowMenuMode
    {
        Always,
    }

    /// <summary>
    /// メニュー型の宣言的操作（GameElementDefinition.md 11節）。conditionsと条件成立時に適用する効果
    /// （ActiveEffect＝active/pickのどちらか一方。排他なので単一のActiveEffect変数で表せる）を1つの定義
    /// としてまとめて持つ。object_defs/traitsの中に、識別子をキーとする辞書として配置される。
    /// </summary>
    public sealed class ActionDef
    {
        public string Name { get; }
        public ShowMenuMode ShowMenu { get; }

        /// <summary>nullなら常に真（conditions省略）。</summary>
        private readonly ConditionNode conditions;

        /// <summary>条件成立時に適用する効果。nullなら何も起きない。pickの抽選もActiveEffect（PickEffect）
        /// 自身が適用時に行うため、ここは適用を依頼するだけでよい。</summary>
        private readonly ActiveEffect effect;

        public ActionDef(
            string name,
            ShowMenuMode showMenu,
            ConditionNode conditions,
            ActiveEffect effect)
        {
            Name = name;
            ShowMenu = showMenu;
            this.conditions = conditions;
            this.effect = effect;
        }

        public bool TryExecute(WorldObject self, WorldObject actor, WorldSession session)
        {
            if (conditions != null && !conditions.Evaluate(root => ReferenceRootResolver.Resolve(root, self, actor, dragged: null)))
                return false;

            if (effect != null) self.ApplyActiveEffect(effect, session, actor, dragged: null);
            return true;
        }
    }
}
