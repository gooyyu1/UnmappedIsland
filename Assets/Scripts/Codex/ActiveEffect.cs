using System.Collections.Generic;

namespace UnmappedIsland.Codex
{
    /// <summary>
    /// 一時的な命令の内容（`add`/`destroy`/`spawn`、9節）。on_zero（6.5節）専用の型にはせず、
    /// 将来 actions/combinations/pick を実装する際にも同じ形をそのまま再利用できる汎用的な名前にしている。
    ///
    /// 現時点では self のみを対象に持てる（on_zero の既存サンプルはすべて self のみが対象であるため。
    /// parent/child を対象にする用途は必要になった時点で改めて拡張する）。
    /// </summary>
    public sealed class ActiveEffect
    {
        /// <summary>add。空なら add なし。</summary>
        public IReadOnlyList<PropertyDelta> Adds { get; }

        public bool Destroy { get; }

        /// <summary>spawn。null なら spawn なし。</summary>
        public SpawnEffect Spawn { get; }

        public ActiveEffect(IReadOnlyList<PropertyDelta> adds, bool destroy, SpawnEffect spawn)
        {
            Adds = adds;
            Destroy = destroy;
            Spawn = spawn;
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
    /// （WorldObject.Place参照）。旧設計にあった `actor_parent`（actorがいる場所）・`parent`
    /// （selfの親）は、この自動伝播によって置き換えられたため、明示的な起点としては存在しない。
    /// Actor はアクション実行文脈でのみ解決できる。on_zeroにはactorが存在しないため、
    /// on_zeroのspawnでintoにActorを指定しても何も起きない。
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
    /// accepts/capacity を無視して強制的に配置する（すべてのオブジェクトは必ずどこかの親に属さなければ
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
}
