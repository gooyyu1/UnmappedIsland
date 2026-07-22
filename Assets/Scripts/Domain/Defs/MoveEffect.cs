using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain.Defs
{
    /// <summary>
    /// move の1命令（対象オブジェクトを、別の場所＝プロパティが指すインスタンスIDのオブジェクトの中へ
    /// 移動する）。道（path）の移動アクションのように「効果を宣言したオブジェクト定義の時点では移動先が
    /// 決まらず、生成時に確定したインスタンスを指したい」ケースを表すため、移動先は object_def 参照ではなく、
    /// self のプロパティ（to_prop）が保持する WorldObject.InstanceId で指す（インスタンス単位の参照を
    /// YAML の語彙で表す唯一の手段がプロパティ値であるため）。
    ///
    /// YAML: `move: {object: actor, to_prop: destination_id}`（transfer と同じフラットフィールド規約）。
    /// object は現時点で actor のみ対応（ロード時に検証）。
    ///
    /// 移動先の解決は「self からツリーの根（world）へ遡り、根から InstanceId で子孫を探す」ことで行う。
    /// 解決できない（プロパティが無い・該当インスタンスが世界に居ない）、または移動先のどのスロットも
    /// 受け入れない場合は何もしない（「対象が解決できない場合その適用のみ無視」の既存規約に従う）。
    /// 配置自体は mover の MoveIntoFirstAcceptingSlot（spawn の into と同じ宣言順走査、force なし）に委ねる。
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
