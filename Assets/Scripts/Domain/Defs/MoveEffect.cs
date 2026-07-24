using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain.Defs
{
    /// <summary>
    /// move の1命令。対象を、self のプロパティ（to_prop）が保持する WorldObject.InstanceId のオブジェクトの中へ
    /// 移動する。移動先が定義時点で決まらず生成時に確定するケース（道の移動アクション等）のため、
    /// object_def 参照ではなくインスタンスIDのプロパティ値で指す。
    ///
    /// YAML: `move: {object: actor, to_prop: destination_id}`（transfer と同じフラットフィールド規約）。
    /// object は現時点で actor のみ（ロード時に検証）。移動先の解決は「ツリーの根から InstanceId で子孫を探す」。
    /// 解決できない・どのスロットも受け入れない場合は何もしない（「解決できない適用は無視」の既存規約）。
    /// 配置は MoveIntoFirstAcceptingSlot（spawn の into と同じ宣言順走査、force なし）。
    /// </summary>
    public sealed class MoveEffect : ActiveEffect
    {
        /// <summary>移動するオブジェクト。現時点で Actor のみ（ローダーが強制する）。</summary>
        private readonly ReferenceRoot target;

        /// <summary>self が持つ、移動先 WorldObject.InstanceId を保持するプロパティ。</summary>
        private readonly int toPropertyGlobalId;

        public MoveEffect(ReferenceRoot target, int toPropertyGlobalId)
        {
            this.target = target;
            this.toPropertyGlobalId = toPropertyGlobalId;
        }

        public override void Apply(
            WorldObject owner, WorldSession session, WorldObject actor, WorldObject dragged,
            WorldObject.EffectSite? effectSite)
        {
            WorldObject mover = owner.ResolveEffectTarget(target, actor, dragged);
            if (mover == null) return;
            if (!owner.TryGetProperty(toPropertyGlobalId, out PropertyValue destinationIdValue)) return;

            WorldObject destination = owner.FindRoot().FindDescendantByInstanceId(destinationIdValue.GetEffectiveValue());
            if (destination == null || destination == mover) return;

            mover.MoveIntoFirstAcceptingSlot(destination, session.Codex.WellKnown);
        }
    }
}
