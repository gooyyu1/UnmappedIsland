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

        /// <summary>このアクションの実行にかかるゲーム内時間（分）。リテラル定数か{object, prop}参照
        /// （weightの10.2節と同じ二択。移動時間のようにインスタンスごとに異なる所要時間はプロパティ参照で表す）。
        /// nullなら時間を消費しない。時間進行の実行（AdvanceWorldTime）までがこのActionDef自身の責務であり、
        /// 呼び出し側は実行後に別途時間を進める必要がない（自分のことは自分でする、CLAUDE.md参照）。</summary>
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

            // durationはeffectの適用後に解決・消費する。先に時間を進めると、進行中のtick（腐敗・on_minの
            // destroy等）がselfを破棄してから効果を適用する事故が起こりうるため。参照durationは適用前の
            // self（例: 道のtravel_minutes）から読む必要があるため、解決だけは適用前に済ませる。
            int minutes = duration.HasValue ? (int)duration.Value.Resolve(self, actor, dragged: null) : 0;

            if (effect != null) self.ApplyActiveEffect(effect, session, actor, dragged: null);

            // Worldを持たないセッション（単体テスト等、時間の概念が無い文脈）では時間進行をスキップする。
            if (minutes > 0 && session.World != null) session.AdvanceWorldTime(minutes);
            return true;
        }
    }
}
