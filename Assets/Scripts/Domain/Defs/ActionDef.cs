using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain.Defs
{
    /// <summary>showMenuの値（11.1節）。現時点ではalwaysのみ（ActionSystem.md 7節）。</summary>
    public enum ShowMenuMode
    {
        Always,
    }

    /// <summary>
    /// メニュー型の宣言的操作（GameElementDefinition.md 11節）。conditionsと条件成立時の効果を1つの定義として持つ。
    /// </summary>
    public sealed class ActionDef
    {
        public string Name { get; }
        public ShowMenuMode ShowMenu { get; }

        /// <summary>nullなら常に真（conditions省略）。</summary>
        private readonly ConditionNode conditions;

        /// <summary>条件成立時に適用する効果。nullなら何も起きない。</summary>
        private readonly ActiveEffect effect;

        /// <summary>実行にかかるゲーム内時間（分）。リテラルか{object, prop}参照（weightの10.2節と同じ二択）。
        /// nullなら時間を消費しない。時間進行（AdvanceWorldTime）まではこのActionDefの責務で、
        /// 呼び出し側が実行後に別途時間を進める必要はない。</summary>
        private readonly WeightSpec? duration;

        public ActionDef(
            string name,
            ShowMenuMode showMenu,
            ConditionNode conditions,
            ActiveEffect effect,
            WeightSpec? duration = null)
        {
            Name = name;
            ShowMenu = showMenu;
            this.conditions = conditions;
            this.effect = effect;
            this.duration = duration;
        }

        public bool TryExecute(WorldObject self, WorldObject actor, WorldSession session)
        {
            if (conditions != null && !conditions.Evaluate(root => ReferenceRootResolver.Resolve(root, self, actor, dragged: null)))
                return false;

            // 時間進行はeffect適用の後（先に進めるとtick中のdestroy等がselfを破棄してから効果を適用する事故になる）。
            // ただし参照durationは適用前のselfから読む必要があるため、解決だけは適用前に行う。
            int minutes = duration.HasValue ? (int)duration.Value.Resolve(self, actor, dragged: null) : 0;

            if (effect != null) self.ApplyActiveEffect(effect, session, actor, dragged: null);

            // Worldを持たないセッション（単体テスト等、時間の概念が無い文脈）では時間進行をスキップする。
            if (minutes > 0 && session.World != null) session.AdvanceWorldTime(minutes);
            return true;
        }
    }
}
