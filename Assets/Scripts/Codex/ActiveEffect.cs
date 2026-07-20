using System.Collections.Generic;

namespace UnmappedIsland.Codex
{
    /// <summary>
    /// 一時的な命令の内容（`set`/`add`/`destroy`/`spawn`、9節）。on_min・on_overflow・on_shortfall（6節）、
    /// actions/combinations/pickのactive（11・12・10節）のすべてから、この1つの型をそのまま共用する。
    ///
    /// 文法は「操作が上位、対象(self/parent/actor/dragged)が下位」（例: `add: {self: {hour: 1}}`）。
    /// set/addは複数の対象へ同時に書けるため、対象ごとの一覧を辞書として持つ。destroyは削除対象を
    /// 直接指すリスト（`destroy: self`は要素1つのリストとして表す）。spawnは常にselfが実行するものと
    /// みなすため対象キーを持たない（対象別に分かれているのはSpawn.Into＝配置先の起点であり、
    /// 実行者＝selfとは別の概念）。
    ///
    /// on_min/on_overflow/on_shortfallはselfのみが有効な対象（呼び出し側・パーサ側で強制する）。
    /// </summary>
    public sealed class ActiveEffect
    {
        /// <summary>対象ごとのset(絶対値代入)。空なら該当対象へのsetなし。</summary>
        public IReadOnlyDictionary<ReferenceRoot, IReadOnlyList<PropertyAssignment>> Sets { get; }

        /// <summary>対象ごとのadd(加減算)。空なら該当対象へのaddなし。</summary>
        public IReadOnlyDictionary<ReferenceRoot, IReadOnlyList<PropertyDelta>> Adds { get; }

        /// <summary>削除する対象。空なら destroy なし。</summary>
        public IReadOnlyList<ReferenceRoot> Destroy { get; }

        /// <summary>spawn。null なら spawn なし。常にselfが実行する。</summary>
        public SpawnEffect Spawn { get; }

        /// <summary>transfer（9.5節）。null なら transfer なし。fromとtoの組が常に1組のため、spawnと同じく
        /// 対象キーを持たない単一の値として持つ（`transfer`は複数形キーではないため、8節の
        /// 「複数形キーは常に配列」規約の対象外）。</summary>
        public TransferEffect Transfer { get; }

        public ActiveEffect(
            IReadOnlyDictionary<ReferenceRoot, IReadOnlyList<PropertyAssignment>> sets,
            IReadOnlyDictionary<ReferenceRoot, IReadOnlyList<PropertyDelta>> adds,
            IReadOnlyList<ReferenceRoot> destroy,
            SpawnEffect spawn,
            TransferEffect transfer = null)
        {
            Sets = sets;
            Adds = adds;
            Destroy = destroy;
            Spawn = spawn;
            Transfer = transfer;
        }
    }

    /// <summary>
    /// set の1エントリ（対象プロパティのグローバルIDと代入する絶対値）。ValueRefが非nullの場合、Valueの
    /// 代わりに、その{object, prop}参照先の現在の実効値を代入する（他のプロパティの値をそのままコピーする、
    /// conditionsのvalue参照・weightのpath参照と同じ「リテラルか参照か」の二択、9.2節）。
    /// </summary>
    public readonly struct PropertyAssignment
    {
        public readonly int PropertyGlobalId;
        public readonly int Value;
        public readonly PropertyPath? ValueRef;

        public PropertyAssignment(int propertyGlobalId, int value)
        {
            PropertyGlobalId = propertyGlobalId;
            Value = value;
            ValueRef = null;
        }

        public PropertyAssignment(int propertyGlobalId, PropertyPath valueRef)
        {
            PropertyGlobalId = propertyGlobalId;
            Value = default;
            ValueRef = valueRef;
        }
    }

    /// <summary>add の1エントリ（対象プロパティのグローバルIDと加減算量）。</summary>
    public readonly struct PropertyDelta
    {
        public readonly int PropertyGlobalId;
        public readonly int Amount;

        public PropertyDelta(int propertyGlobalId, int amount)
        {
            PropertyGlobalId = propertyGlobalId;
            Amount = amount;
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

        public TransferEffect(
            ReferenceRoot fromObject, int fromPropertyGlobalId,
            ReferenceRoot toObject, int toPropertyGlobalId,
            int amount, bool allowOverflow)
        {
            FromObject = fromObject;
            FromPropertyGlobalId = fromPropertyGlobalId;
            ToObject = toObject;
            ToPropertyGlobalId = toPropertyGlobalId;
            Amount = amount;
            AllowOverflow = allowOverflow;
        }
    }
}
