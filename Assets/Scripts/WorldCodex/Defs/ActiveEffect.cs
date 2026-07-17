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
    /// spawn の配置先（9.4節）が起点にする参照ルート。
    ///
    /// - SameAsSelf: このspawnを宣言したオブジェクト（self）が今いる、まさにその場所（親+スロット）。
    ///   クラフト・腐敗など「同じ場所で別の物に置き換わる」場合に使う。スロット名の指定は不要（selfの
    ///   現在の所属先から動的に決まるため）。
    /// - Self / Parent: 対象スロットを明示的に指定する必要がある。
    /// - Actor / ActorParent: アクション実行文脈でのみ解決できる（実行者=actorが存在するため）。
    ///   on_zeroにはactorが存在しないため、on_zeroのspawnではこの2つは解決されない
    ///   （fallbackが無ければ何も起きない）。
    /// </summary>
    public enum SpawnTargetRoot
    {
        SameAsSelf,
        Self,
        Parent,
        Actor,
        ActorParent,
    }

    /// <summary>spawn の配置先1件（9.4節）。</summary>
    public sealed class SpawnTarget
    {
        public SpawnTargetRoot Root { get; }

        /// <summary>Root が SameAsSelf の場合は使わない（null）。それ以外は対象スロットのグローバルID。</summary>
        public int? SlotGlobalId { get; }

        public SpawnTarget(SpawnTargetRoot root, int? slotGlobalId)
        {
            Root = root;
            SlotGlobalId = slotGlobalId;
        }
    }

    /// <summary>
    /// spawn（9.4節）の内容。Primary への配置に失敗した場合（accepts/capacityで拒否された場合）にのみ
    /// Fallback を試みる。Fallback は accepts/capacity を無視して必ず配置に成功する（すべてのオブジェクトは
    /// 必ずどこかの親に属さなければならないため）。Fallback が無く Primary が失敗した場合、spawn した
    /// オブジェクトはどこにも配置されないまま消える（何も起きなかったのと同じ扱い）。
    /// </summary>
    public sealed class SpawnEffect
    {
        public int ObjectGlobalId { get; }
        public SpawnTarget Primary { get; }

        /// <summary>null なら fallback なし。</summary>
        public SpawnTarget Fallback { get; }

        public SpawnEffect(int objectGlobalId, SpawnTarget primary, SpawnTarget fallback)
        {
            ObjectGlobalId = objectGlobalId;
            Primary = primary;
            Fallback = fallback;
        }
    }
}
