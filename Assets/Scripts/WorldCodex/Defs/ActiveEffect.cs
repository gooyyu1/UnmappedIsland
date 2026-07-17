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
    /// spawn の `into` が指す参照ルート（9.4節）。actor/dragged はアクション実行文脈でのみ意味を持つため、
    /// アクション文脈を持たない on_zero からの spawn では self/parent のみを対象とする。
    /// </summary>
    public enum SpawnIntoRoot
    {
        Self,
        Parent,
    }

    /// <summary>spawn（9.4節）の内容。</summary>
    public sealed class SpawnEffect
    {
        public int ObjectGlobalId { get; }
        public SpawnIntoRoot IntoRoot { get; }
        public int IntoSlotGlobalId { get; }

        public SpawnEffect(int objectGlobalId, SpawnIntoRoot intoRoot, int intoSlotGlobalId)
        {
            ObjectGlobalId = objectGlobalId;
            IntoRoot = intoRoot;
            IntoSlotGlobalId = intoSlotGlobalId;
        }
    }
}
