using System.Collections.Generic;
using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain.Defs
{
    /// <summary>
    /// 一時的な命令の内容（`set`/`add`/`destroy`/`spawn`、9節）。on_min・on_overflow・on_shortfall（6節）、
    /// actions/combinations/pickのactive（11・12・10節）のすべてから、この1つの型をそのまま共用する。
    ///
    /// set/addは「対象付きの1操作(SetEffect/AddEffect)」のリストとして持つ（passiveのmodify/accumulateが
    /// ModifyEffect/AccumulateEffectのリストなのと対称。対象は各操作自身がReferenceRootとして持つ）。
    /// destroyは削除対象を直接指すリスト（`destroy: self`は要素1つのリストとして表す）。spawnは常にselfが
    /// 実行するものとみなすため対象キーを持たない（対象別に分かれているのはSpawn.Into＝配置先の起点であり、
    /// 実行者＝selfとは別の概念）。
    ///
    /// on_min/on_overflow/on_shortfallはselfのみが有効な対象（呼び出し側・パーサ側で強制する）。
    /// </summary>
    public sealed class ActiveEffect
    {
        /// <summary>set(絶対値代入)の一覧。宣言順。空ならsetなし。</summary>
        public IReadOnlyList<SetEffect> Sets { get; }

        /// <summary>add(加減算)の一覧。宣言順。空ならaddなし。</summary>
        public IReadOnlyList<AddEffect> Adds { get; }

        /// <summary>削除する対象。空なら destroy なし。</summary>
        public IReadOnlyList<ReferenceRoot> Destroy { get; }

        /// <summary>spawn。空なら spawn なし。常にselfが実行する。</summary>
        public IReadOnlyList<SpawnEffect> Spawns { get; }

        /// <summary>transfer（9.5節）。空なら transfer なし。</summary>
        public IReadOnlyList<TransferEffect> Transfers { get; }

        public ActiveEffect(
            IReadOnlyList<SetEffect> sets,
            IReadOnlyList<AddEffect> adds,
            IReadOnlyList<ReferenceRoot> destroy,
            IReadOnlyList<SpawnEffect> spawns,
            IReadOnlyList<TransferEffect> transfers)
        {
            Sets = sets;
            Adds = adds;
            Destroy = destroy;
            Spawns = spawns;
            Transfers = transfers;
        }
    }

    /// <summary>
    /// 一度きりのプロパティ書き換え1操作（set/add、9.2節）。対象(Target)・対象プロパティ・適用方法を自分で
    /// 持ち、ownerの文脈（actor/dragged）を受け取って「対象を解決し自分を適用する」までを自分で行う
    /// （PropertyValueへの登録で持続するpassiveのModifyEffect/AccumulateEffectと対になる、一度きり側の
    /// ポリモーフィズム。自分のことは自分でする、CLAUDE.md参照）。対象の解決（Ancestorのプロパティ別解決を
    /// 含む）はowner.ResolveEffectTargetOrAncestorに委ねる。
    /// </summary>
    public abstract class PropertyMutation
    {
        protected ReferenceRoot Target { get; }
        protected int PropertyGlobalId { get; }

        protected PropertyMutation(ReferenceRoot target, int propertyGlobalId)
        {
            Target = target;
            PropertyGlobalId = propertyGlobalId;
        }

        /// <summary>owner（この操作を発する自分自身）の文脈で対象を解決し、自分を1回適用する。
        /// 対象が解決できなければ何もしない。</summary>
        public abstract void Apply(WorldObject owner, WorldSession session, WorldObject actor, WorldObject dragged);
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

        public override void Apply(WorldObject owner, WorldSession session, WorldObject actor, WorldObject dragged)
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

        public override void Apply(WorldObject owner, WorldSession session, WorldObject actor, WorldObject dragged) =>
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
    /// spawn（9.4節）の内容。Into への配置（起点が持つスロットの宣言順走査、または SameSlot の場合は
    /// 一意に決まる1スロットへの直接配置）に失敗した場合、必ずその起点自身の親へ伝播し、
    /// accepts/capacityを無視して強制的に配置する（すべてのオブジェクトは必ずどこかの親に属さなければ
    /// ならないため）。この伝播はYAML側で選択の余地がなく、常に同じルールで行われる。
    ///
    /// 伝播先の親も存在しない場合（起点がworld直下など）、spawn したオブジェクトはどこにも配置されない
    /// まま消える（何も起きなかったのと同じ扱い）。
    /// </summary>
    public sealed class SpawnEffect
    {
        public int ObjectGlobalId { get; }

        public SpawnTargetRoot Into { get; }

        public SpawnEffect(int objectGlobalId, SpawnTargetRoot into)
        {
            ObjectGlobalId = objectGlobalId;
            Into = into;
        }
    }

    /// <summary>
    /// transfer（9.5節）の内容。fromが指すプロパティの実体値から、実際に出せる量とamountの小さい方だけを
    /// toが指すプロパティへ移す（連続量の液体のような、setの固定値でもaddの無条件加減算でも表現できない
    /// 「在庫に応じて実際に動く量が変わる」移送を表す）。
    ///
    /// from/toの参照は、他の場所（`modify`/`set`/`add`等）と同じ「対象がキー、内容が値」という規約に
    /// 合わせず、conditions（14節）と同じくフラットな`from_object`/`from_prop`/`to_object`/`to_prop`の
    /// 4フィールドで表す。fromとtoの組は常に1組であり、複数プロパティの入れ物としてネストする理由が
    /// 無いため。
    /// </summary>
    public sealed class TransferEffect
    {
        /// <summary>移送元の参照ルート。既定値self（conditionsのobject省略時と同じ規約）。</summary>
        public ReferenceRoot FromObject { get; }

        public int FromPropertyGlobalId { get; }

        /// <summary>移送先の参照ルート。既定値self。</summary>
        public ReferenceRoot ToObject { get; }

        public int ToPropertyGlobalId { get; }

        /// <summary>一度に移送を試みる量の上限。実際の移動量はこれとfromの残量（・allow_overflowが falseなら
        /// toの残容量）の小さい方になる。</summary>
        public int Amount { get; }

        /// <summary>
        /// falseの場合（既定）、toのrangeで実際に収まる量までしか移動しない（収まらない分はfromに残す。
        /// 液体を無駄にしない）。trueの場合、fromの残量とamountだけで移動量を決め、toのrange超過分は
        /// toのon_overflow（未指定ならrange.maxへ自動でクランプする既定動作）に委ねる（あふれた分は失われる）。
        /// </summary>
        public bool AllowOverflow { get; }

        /// <summary>
        /// 実際に移動した量に比例して適用する追加の加減算（9.5節 linked_add）。各エントリの量は
        /// `amount * actual_moved / transfer.amount`（整数除算、切り捨て）で確定する（AddEffect.ApplyScaled）。
        /// amountより少ない量しか移動できなかった場合（在庫不足など）に、副効果も自動的に按分される。
        /// 空の場合は何もしない。
        /// </summary>
        public IReadOnlyList<AddEffect> LinkedAdd { get; }

        public TransferEffect(
            ReferenceRoot fromObject, int fromPropertyGlobalId,
            ReferenceRoot toObject, int toPropertyGlobalId,
            int amount, bool allowOverflow,
            IReadOnlyList<AddEffect> linkedAdd = null)
        {
            FromObject = fromObject;
            FromPropertyGlobalId = fromPropertyGlobalId;
            ToObject = toObject;
            ToPropertyGlobalId = toPropertyGlobalId;
            Amount = amount;
            AllowOverflow = allowOverflow;
            LinkedAdd = linkedAdd ?? new List<AddEffect>();
        }
    }
}
