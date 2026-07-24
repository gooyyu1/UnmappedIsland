using System;
using System.Collections.Generic;
using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain.Defs
{
    /// <summary>
    /// 「条件成立時に何を起こすか」を表すポリモーフィックな効果1つ（9・10節）。対象の解決と適用まで自分で行う。
    /// 具象は、単一の命令（Set/Add/Destroy/Spawn/Transfer、9節）、その宣言順合成（ActiveEffects）、
    /// weightで1候補を選ぶpick（PickEffect、10節。候補もActiveEffectなので再帰しうる）の3種。
    /// activeとpickの排他は「ActiveEffect型の変数が1つ」というだけで表せる（判別子不要）。
    ///
    /// effectSiteは、適用の入口（WorldObject.ApplyActiveEffect）で捕捉した「selfが今占めている位置」の
    /// スナップショット。same_slot spawnだけがこれを使い、self破棄後でも「その位置がまだ同種を保持しているか」を
    /// 配置時に見て置き換え位置を決める（他の効果は無視してよく、destroyが何かを書き込む必要もない）。
    /// </summary>
    public abstract class ActiveEffect
    {
        public abstract void Apply(
            WorldObject owner, WorldSession session, WorldObject actor, WorldObject dragged,
            WorldObject.EffectSite? effectSite);
    }

    /// <summary>
    /// 一時的な命令（`set`/`add`/`destroy`/`spawn`/`transfer`、9節）を宣言順にまとめた合成効果。
    /// on_min・on_overflow・on_shortfall（6節）、actions/combinations/pickのactive（11・12・10節）が共用する。
    /// on_min/on_overflow/on_shortfallはselfのみが有効な対象（パーサ側で強制する）。
    /// </summary>
    public sealed class ActiveEffects : ActiveEffect
    {
        /// <summary>単一命令の宣言順リスト。適用順はリスト順（パーサがset→add→transfer→destroy→spawnの順で
        /// 並べる。同一プロパティへのset後add、destroyで空いた位置へのspawn（same_slot）という依存関係のため）。</summary>
        private readonly IReadOnlyList<ActiveEffect> operations;

        public ActiveEffects(IReadOnlyList<ActiveEffect> operations)
        {
            this.operations = operations;
        }

        public override void Apply(
            WorldObject owner, WorldSession session, WorldObject actor, WorldObject dragged,
            WorldObject.EffectSite? effectSite)
        {
            foreach (ActiveEffect operation in operations)
                operation.Apply(owner, session, actor, dragged, effectSite);
        }
    }

    /// <summary>
    /// set の1命令（対象プロパティへ絶対値を代入する）。valueRefが非nullなら、リテラルの代わりに
    /// その{object, prop}参照先の現在の実効値を代入する（「リテラルか参照か」の二択、9.2節）。
    /// </summary>
    public sealed class SetEffect : ActiveEffect
    {
        private readonly ReferenceRoot target;
        private readonly int propertyGlobalId;
        private readonly int value;
        private readonly PropertyPath? valueRef;

        public SetEffect(ReferenceRoot target, int propertyGlobalId, int value)
        {
            this.target = target;
            this.propertyGlobalId = propertyGlobalId;
            this.value = value;
            valueRef = null;
        }

        public SetEffect(ReferenceRoot target, int propertyGlobalId, PropertyPath valueRef)
        {
            this.target = target;
            this.propertyGlobalId = propertyGlobalId;
            value = default;
            this.valueRef = valueRef;
        }

        public override void Apply(
            WorldObject owner, WorldSession session, WorldObject actor, WorldObject dragged,
            WorldObject.EffectSite? effectSite)
        {
            WorldObject resolved = owner.ResolveEffectTargetOrAncestor(target, propertyGlobalId, actor, dragged);
            resolved?.SetNumber(propertyGlobalId, ResolveValue(owner, actor, dragged), session);
        }

        /// <summary>valueRefが無ければリテラル、あれば参照先の現在の実効値（解決できなければ0）。</summary>
        private int ResolveValue(WorldObject owner, WorldObject actor, WorldObject dragged)
        {
            if (!valueRef.HasValue) return value;
            PropertyPath path = valueRef.Value;
            WorldObject source = owner.ResolveEffectTargetOrAncestor(path.Root, path.PropertyGlobalId, actor, dragged);
            return source != null && source.TryGetProperty(path.PropertyGlobalId, out PropertyValue v) ? v.GetEffectiveValue() : 0;
        }
    }

    /// <summary>add の1命令（対象プロパティへ加減算する）。</summary>
    public sealed class AddEffect : ActiveEffect
    {
        private readonly ReferenceRoot target;
        private readonly int propertyGlobalId;
        private readonly int amount;

        public AddEffect(ReferenceRoot target, int propertyGlobalId, int amount)
        {
            this.target = target;
            this.propertyGlobalId = propertyGlobalId;
            this.amount = amount;
        }

        public override void Apply(
            WorldObject owner, WorldSession session, WorldObject actor, WorldObject dragged,
            WorldObject.EffectSite? effectSite) =>
            ApplyScaled(owner, session, actor, dragged, numerator: 1, denominator: 1);

        /// <summary>transfer（9.5節）のlinked_add用: amount*numerator/denominator（整数除算）に
        /// スケールした量を加減算する。スケール後が0なら何もしない。</summary>
        public void ApplyScaled(WorldObject owner, WorldSession session, WorldObject actor, WorldObject dragged, int numerator, int denominator)
        {
            int scaled = amount * numerator / denominator;
            if (scaled == 0) return;
            WorldObject resolved = owner.ResolveEffectTargetOrAncestor(target, propertyGlobalId, actor, dragged);
            resolved?.AddNumber(propertyGlobalId, scaled, session);
        }
    }

    /// <summary>
    /// destroy の1命令（対象オブジェクトそのものを削除する、9.3節）。`destroy: [self, dragged]`は
    /// 要素2つのDestroyEffectとして表す。same_slot spawnとの連携はeffectSite（ActiveEffect参照）が担う。
    /// </summary>
    public sealed class DestroyEffect : ActiveEffect
    {
        private readonly ReferenceRoot target;

        public DestroyEffect(ReferenceRoot target)
        {
            this.target = target;
        }

        public override void Apply(
            WorldObject owner, WorldSession session, WorldObject actor, WorldObject dragged,
            WorldObject.EffectSite? effectSite)
        {
            WorldObject victim = owner.ResolveEffectTarget(target, actor, dragged);
            victim?.Destroy(session.Codex.WellKnown);
        }
    }

    /// <summary>
    /// spawn の配置先（9.4節）が起点にする参照ルート。スロットは指定せず、起点が持つスロットを宣言順に
    /// 走査して最初に配置できた所へ入れる（著者がスロット名を知らなくてよい）。fallbackはYAML上に存在せず、
    /// 配置失敗時は必ず起点自身の親へ伝播する（WorldObject.Place参照）。on_min/on_overflow/on_shortfallには
    /// actorが存在しないため、それらのspawnでintoにActorを指定しても何も起きない。
    /// </summary>
    public enum SpawnTargetRoot
    {
        /// <summary>
        /// into 省略時の既定値。selfが今占めている場所（親と同じスロット）へ配置する。クラフト・腐敗など
        /// 「同じ場所で別の物に置き換わる」場合に使う。一意の1スロットのため走査は行わない。
        /// </summary>
        SameSlot,

        /// <summary>self が持つスロットを宣言順に走査する。</summary>
        Self,

        /// <summary>actor が持つスロットを宣言順に走査する。</summary>
        Actor,
    }

    /// <summary>
    /// spawn（9.4節）の1命令。Into への配置に失敗した場合は必ず起点の親へ伝播し、accepts/capacityを無視して
    /// 強制配置する（オブジェクトは必ずどこかの親に属す必要があるため。YAML側に選択の余地はない）。
    /// 伝播先の親も無い場合、spawnしたオブジェクトは配置されないまま消える。
    /// </summary>
    public sealed class SpawnEffect : ActiveEffect
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
            WorldObject.EffectSite? effectSite) =>
            owner.ExecuteSpawn(this, session, actor, effectSite);
    }

    /// <summary>
    /// transfer（9.5節）の1命令。fromプロパティの実体値から、実際に出せる量とAmountの小さい方だけを
    /// toプロパティへ移す（「在庫に応じて実際に動く量が変わる」移送）。YAMLはフラットな
    /// `from_object`/`from_prop`/`to_object`/`to_prop`の4フィールドで表す。
    /// </summary>
    public sealed class TransferEffect : ActiveEffect
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
        /// 移動量は「出せる量」（PropertyValue.AvailableToTransferOut）とAmountの小さい方。allow_overflowが
        /// falseならさらに「受け取れる量」（RemainingTransferCapacity）でも制限する。linked_add（9.5節）は
        /// 実際に移動した量に比例（amount * actual_moved / Amount、整数除算）してスケール適用する。
        /// from/toが解決できない・対象がそのプロパティを持たない場合は何もしない。
        /// </summary>
        public override void Apply(
            WorldObject owner, WorldSession session, WorldObject actor, WorldObject dragged,
            WorldObject.EffectSite? effectSite)
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

            foreach (AddEffect linked in linkedAdd)
                linked.ApplyScaled(owner, session, actor, dragged, numerator: moved, denominator: amount);
        }
    }
}
