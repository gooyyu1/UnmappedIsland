using System;
using System.Collections.Generic;
using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain.Defs
{
    /// <summary>
    /// 一時的な命令の内容（`set`/`add`/`destroy`/`spawn`/`transfer`、9節）。on_min・on_overflow・on_shortfall（6節）、
    /// actions/combinations/pickのactive（11・12・10節）のすべてから、この1つの型をそのまま共用する。
    ///
    /// 中身は「1操作(ActiveOperation)」の宣言順フラットリスト1本だけを持つ（set/add/destroy/spawn/transferは
    /// すべてApplyを持つActiveOperationの具象型で、対象の解決も適用も各操作自身が行う。passiveのmodify/
    /// accumulateがPassiveEffectのリストなのと対称）。呼び出し側は「適用してほしい」と依頼するだけで、
    /// どの操作をどの順で適用すべきかは一切知らない（自分のことは自分でする、CLAUDE.md参照）。
    ///
    /// on_min/on_overflow/on_shortfallはselfのみが有効な対象（呼び出し側・パーサ側で強制する）。
    /// </summary>
    public sealed class ActiveEffect
    {
        /// <summary>set/add/destroy/spawn/transferを区別しない、1操作の宣言順リスト。適用順は
        /// リスト順（パーサがset→add→transfer→destroy→spawnの順で並べる。同一プロパティへのset後add、
        /// destroyで空いた位置へのspawn（same_slot）という依存関係のため）。</summary>
        private readonly IReadOnlyList<ActiveOperation> operations;

        public ActiveEffect(IReadOnlyList<ActiveOperation> operations)
        {
            this.operations = operations;
        }

        /// <summary>この命令を、owner（self）として宣言順に適用する。same_slot spawnのための位置捕捉を
        /// destroyと共有するための文脈(ActiveApplication)を1回分だけ作り、各操作へ渡す。</summary>
        public void ApplyTo(WorldObject owner, WorldSession session, WorldObject actor, WorldObject dragged)
        {
            var context = new WorldObject.ActiveApplication(owner);
            foreach (ActiveOperation operation in operations)
                operation.Apply(owner, session, actor, dragged, context);
        }
    }

    /// <summary>
    /// 一時的な命令(active)の1操作（set/add/destroy/spawn/transfer、9節）。owner（この操作を発する自分自身）の
    /// 文脈（actor/dragged）を受け取り、「対象を解決して自分を適用する」までを自分で行う（PropertyValueへの
    /// 登録で持続するpassiveのPassiveEffectと対になる、一度きり側のポリモーフィズム。自分のことは自分でする、
    /// CLAUDE.md参照）。
    ///
    /// contextは1回の適用（1つのActiveEffect.ApplyTo）で共有される。same_slot spawnが必要とする「destroyで
    /// 失われる前のselfの位置」を、destroy側とspawn側が同じcontextを通して受け渡すために使う（それ以外の
    /// 操作は無視してよい）。
    /// </summary>
    public abstract class ActiveOperation
    {
        public abstract void Apply(
            WorldObject owner, WorldSession session, WorldObject actor, WorldObject dragged,
            WorldObject.ActiveApplication context);
    }

    /// <summary>
    /// プロパティを書き換える1操作（set/add、9.2節）。対象(Target)・対象プロパティを共通で持ち、ownerの文脈で
    /// 対象を解決する部分をActiveOperationとして共有する（対象の解決はowner.ResolveEffectTargetOrAncestorに
    /// 委ね、Ancestorのプロパティ別解決も含めて任せる）。
    /// </summary>
    public abstract class PropertyMutation : ActiveOperation
    {
        protected ReferenceRoot Target { get; }
        protected int PropertyGlobalId { get; }

        protected PropertyMutation(ReferenceRoot target, int propertyGlobalId)
        {
            Target = target;
            PropertyGlobalId = propertyGlobalId;
        }
    }

    /// <summary>
    /// set の1操作（対象プロパティへ絶対値を代入する）。valueRefが非nullの場合、リテラル値の代わりに、
    /// その{object, prop}参照先の現在の実効値を代入する（他のプロパティの値をそのままコピーする、
    /// conditionsのvalue参照・weightのpath参照と同じ「リテラルか参照か」の二択、9.2節）。
    /// </summary>
    public sealed class SetEffect : PropertyMutation
    {
        private readonly int value;
        private readonly PropertyPath? valueRef;

        public SetEffect(ReferenceRoot target, int propertyGlobalId, int value)
            : base(target, propertyGlobalId)
        {
            this.value = value;
            valueRef = null;
        }

        public SetEffect(ReferenceRoot target, int propertyGlobalId, PropertyPath valueRef)
            : base(target, propertyGlobalId)
        {
            value = default;
            this.valueRef = valueRef;
        }

        public override void Apply(
            WorldObject owner, WorldSession session, WorldObject actor, WorldObject dragged,
            WorldObject.ActiveApplication context)
        {
            WorldObject target = owner.ResolveEffectTargetOrAncestor(Target, PropertyGlobalId, actor, dragged);
            target?.SetNumber(PropertyGlobalId, ResolveValue(owner, actor, dragged), session);
        }

        /// <summary>実際に代入する値。valueRefが無ければリテラル、あればその参照先の現在の実効値
        /// （解決できなければ0）。</summary>
        private int ResolveValue(WorldObject owner, WorldObject actor, WorldObject dragged)
        {
            if (!valueRef.HasValue) return value;
            PropertyPath path = valueRef.Value;
            WorldObject source = owner.ResolveEffectTargetOrAncestor(path.Root, path.PropertyGlobalId, actor, dragged);
            return source != null && source.TryGetProperty(path.PropertyGlobalId, out PropertyValue v) ? v.GetEffectiveValue() : 0;
        }
    }

    /// <summary>add の1操作（対象プロパティへ加減算する）。</summary>
    public sealed class AddEffect : PropertyMutation
    {
        private readonly int amount;

        public AddEffect(ReferenceRoot target, int propertyGlobalId, int amount)
            : base(target, propertyGlobalId)
        {
            this.amount = amount;
        }

        public override void Apply(
            WorldObject owner, WorldSession session, WorldObject actor, WorldObject dragged,
            WorldObject.ActiveApplication context) =>
            ApplyScaled(owner, session, actor, dragged, numerator: 1, denominator: 1);

        /// <summary>transfer（9.5節）のlinked_add用: 実際に移動した量に比例してスケール（amount*numerator/
        /// denominator、整数除算）した量を加減算する。numerator/denominatorが1/1なら通常のadd（Apply）と同じ。
        /// スケール後が0なら何もしない。</summary>
        public void ApplyScaled(WorldObject owner, WorldSession session, WorldObject actor, WorldObject dragged, int numerator, int denominator)
        {
            int scaled = amount * numerator / denominator;
            if (scaled == 0) return;
            WorldObject target = owner.ResolveEffectTargetOrAncestor(Target, PropertyGlobalId, actor, dragged);
            target?.AddNumber(PropertyGlobalId, scaled, session);
        }
    }

    /// <summary>
    /// destroy の1操作（対象オブジェクトそのものを削除する、9.3節）。`destroy: self`は要素1つ、
    /// `destroy: [self, dragged]`は要素2つのDestroyEffectとして表す。対象がselfの場合、削除で位置が
    /// 失われる前に、same_slot spawnのための位置アンカーをcontextへ捕捉させてから削除する
    /// （destroyの後ろに並ぶspawnがその位置を引き継げるようにするため。ApplyActiveEffectの適用順参照）。
    /// </summary>
    public sealed class DestroyEffect : ActiveOperation
    {
        private readonly ReferenceRoot target;

        public DestroyEffect(ReferenceRoot target)
        {
            this.target = target;
        }

        public override void Apply(
            WorldObject owner, WorldSession session, WorldObject actor, WorldObject dragged,
            WorldObject.ActiveApplication context)
        {
            WorldObject victim = owner.ResolveEffectTarget(target, actor, dragged);
            if (victim == null) return;
            if (target == ReferenceRoot.Self)
                context.NotifyOriginWillBeDestroyed();
            victim.Destroy(session.Codex.WellKnown);
        }
    }

    /// <summary>
    /// spawn の配置先（9.4節）が起点にする参照ルート。スロットは指定しない。対象オブジェクトが持つ
    /// スロットを宣言順に走査し、最初に配置できたスロットへ入れる（型ごとに用意されたスロットへ
    /// 自然に振り分けられるため、著者がスロット名を知っている必要がない）。
    ///
    /// fallback はYAML上に存在しない。配置に失敗した場合は必ず、解決した起点自身の親へ伝播する
    /// （WorldObject.Place参照）。Actor はアクション実行文脈でのみ解決できる。on_min/on_overflow/
    /// on_shortfallにはactorが存在しないため、それらのspawnでintoにActorを指定しても何も起きない。
    /// </summary>
    public enum SpawnTargetRoot
    {
        /// <summary>
        /// into を省略した場合の既定値でもある。この spawn を宣言したオブジェクト（self）が今いる、
        /// まさにその場所（親と、self が現在占めているのと同じスロット）へ配置する。クラフト・腐敗など
        /// 「同じ場所で別の物に置き換わる」場合に使う。一意に決まる1つのスロットのため、走査は行わない。
        /// </summary>
        SameSlot,

        /// <summary>self が持つスロットを宣言順に走査する。</summary>
        Self,

        /// <summary>actor が持つスロットを宣言順に走査する。</summary>
        Actor,
    }

    /// <summary>
    /// spawn（9.4節）の1操作。Into への配置（起点が持つスロットの宣言順走査、または SameSlot の場合は
    /// 一意に決まる1スロットへの直接配置）に失敗した場合、必ずその起点自身の親へ伝播し、
    /// accepts/capacityを無視して強制的に配置する（すべてのオブジェクトは必ずどこかの親に属さなければ
    /// ならないため）。この伝播はYAML側で選択の余地がなく、常に同じルールで行われる。
    ///
    /// 伝播先の親も存在しない場合（起点がworld直下など）、spawn したオブジェクトはどこにも配置されない
    /// まま消える（何も起きなかったのと同じ扱い）。
    ///
    /// 実際の配置（スロット・スタックの操作、same_slotの位置引き継ぎ）はowner（self）とそのスロット/
    /// スタックの領分であるため、ExecuteSpawnへ委ねる（配置先の在庫や隙間を知っているのは配置先自身）。
    /// </summary>
    public sealed class SpawnEffect : ActiveOperation
    {
        public int ObjectGlobalId { get; }

        public SpawnTargetRoot Into { get; }

        public SpawnEffect(int objectGlobalId, SpawnTargetRoot into)
        {
            ObjectGlobalId = objectGlobalId;
            Into = into;
        }

        public override void Apply(
            WorldObject owner, WorldSession session, WorldObject actor, WorldObject dragged,
            WorldObject.ActiveApplication context) =>
            owner.ExecuteSpawn(this, session, actor, context);
    }

    /// <summary>
    /// transfer（9.5節）の1操作。fromが指すプロパティの実体値から、実際に出せる量とAmountの小さい方だけを
    /// toが指すプロパティへ移す（連続量の液体のような、setの固定値でもaddの無条件加減算でも表現できない
    /// 「在庫に応じて実際に動く量が変わる」移送を表す）。「実際にいくら動かせるか」の判断はfrom/to自身の
    /// PropertyValueに委ね、この操作は対象解決と移動量の確定・実行のみを行う（自分のことは自分でする、
    /// CLAUDE.md参照）。
    ///
    /// from/toの参照は、他の場所（`modify`/`set`/`add`等）と同じ「対象がキー、内容が値」という規約に
    /// 合わせず、conditions（14節）と同じくフラットな`from_object`/`from_prop`/`to_object`/`to_prop`の
    /// 4フィールドで表す。fromとtoの組は常に1組であり、複数プロパティの入れ物としてネストする理由が
    /// 無いため。
    /// </summary>
    public sealed class TransferEffect : ActiveOperation
    {
        private readonly ReferenceRoot fromObject;
        private readonly int fromPropertyGlobalId;
        private readonly ReferenceRoot toObject;
        private readonly int toPropertyGlobalId;
        private readonly int amount;
        private readonly bool allowOverflow;
        private readonly IReadOnlyList<AddEffect> linkedAdd;

        public TransferEffect(
            ReferenceRoot fromObject, int fromPropertyGlobalId,
            ReferenceRoot toObject, int toPropertyGlobalId,
            int amount, bool allowOverflow,
            IReadOnlyList<AddEffect> linkedAdd = null)
        {
            this.fromObject = fromObject;
            this.fromPropertyGlobalId = fromPropertyGlobalId;
            this.toObject = toObject;
            this.toPropertyGlobalId = toPropertyGlobalId;
            this.amount = amount;
            this.allowOverflow = allowOverflow;
            this.linkedAdd = linkedAdd ?? new List<AddEffect>();
        }

        /// <summary>
        /// 実際の移動量は、from自身が申告する「出せる量」（PropertyValue.AvailableToTransferOut）とAmountの
        /// 小さい方を基本とし、allow_overflowがfalseの場合はさらにtoが申告する「受け取れる量」
        /// （PropertyValue.RemainingTransferCapacity）でも制限する。
        ///
        /// linked_add（9.5節）が指定されている場合、実際に移動した量に比例してスケールされた加減算も適用する
        /// （比例量 = amount * actual_moved / Amount、整数除算・切り捨て。各AddEffect.ApplyScaled）。
        ///
        /// from/toのいずれかが解決できない、あるいは対象がそのプロパティを持たない場合は何もしない。
        /// </summary>
        public override void Apply(
            WorldObject owner, WorldSession session, WorldObject actor, WorldObject dragged,
            WorldObject.ActiveApplication context)
        {
            WorldObject from = owner.ResolveEffectTargetOrAncestor(fromObject, fromPropertyGlobalId, actor, dragged);
            WorldObject to = owner.ResolveEffectTargetOrAncestor(toObject, toPropertyGlobalId, actor, dragged);
            if (from == null || to == null) return;
            if (!from.TryGetProperty(fromPropertyGlobalId, out PropertyValue fromValue)) return;
            if (!to.TryGetProperty(toPropertyGlobalId, out PropertyValue toValue)) return;

            int moved = Math.Min(amount, fromValue.AvailableToTransferOut());
            if (!allowOverflow)
                moved = Math.Min(moved, toValue.RemainingTransferCapacity());
            if (moved <= 0) return;

            from.AddNumber(fromPropertyGlobalId, -moved, session);
            to.AddNumber(toPropertyGlobalId, moved, session);

            // 実際に動いた量(moved)に比例させて副効果を適用する。各AddEffectが自分でスケール適用する。
            foreach (AddEffect linked in linkedAdd)
                linked.ApplyScaled(owner, session, actor, dragged, numerator: moved, denominator: amount);
        }
    }
}
