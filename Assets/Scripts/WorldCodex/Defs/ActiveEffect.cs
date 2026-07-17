using System.Collections.Generic;

namespace UnmappedIsland.Codex.Defs
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
    /// Actor / ActorParent はアクション実行文脈でのみ解決できる（実行者=actorが存在するため）。
    /// on_zeroにはactorが存在しないため、on_zeroのspawnではこの2つは解決されない
    /// （fallbackが無ければ何も起きない）。
    /// </summary>
    public enum SpawnTargetRoot
    {
        Self,
        Parent,
        Actor,
        ActorParent,
    }

    /// <summary>
    /// spawn（9.4節）の内容。Into への配置に失敗した場合（対象の全スロットがaccepts/capacityで拒否した
    /// 場合）にのみ Fallback を試みる。Fallback は accepts/capacity を無視して必ず配置に成功する
    /// （すべてのオブジェクトは必ずどこかの親に属さなければならないため）。
    ///
    /// Into が null（YAML上 into を省略した場合）は、このspawnを宣言したオブジェクト（self）が今いる、
    /// まさにその場所（親と、selfが現在占めているのと同じスロット）へ配置する。クラフト・腐敗など
    /// 「同じ場所で別の物に置き換わる」場合に使う既定動作であり、スロットを走査する必要がないため
    /// SpawnTargetRoot とは別に null で表す。
    ///
    /// Fallback が無く Into が失敗した場合、spawn したオブジェクトはどこにも配置されないまま消える
    /// （何も起きなかったのと同じ扱い）。
    /// </summary>
    public sealed class SpawnEffect
    {
        public int ObjectGlobalId { get; }

        /// <summary>null なら「selfが今いる、まさにその場所」（省略時の既定動作）。</summary>
        public SpawnTargetRoot? Into { get; }

        /// <summary>null なら fallback なし。</summary>
        public SpawnTargetRoot? Fallback { get; }

        public SpawnEffect(int objectGlobalId, SpawnTargetRoot? into, SpawnTargetRoot? fallback)
        {
            ObjectGlobalId = objectGlobalId;
            Into = into;
            Fallback = fallback;
        }
    }
}
