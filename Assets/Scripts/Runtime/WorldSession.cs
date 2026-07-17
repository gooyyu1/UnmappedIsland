using UnmappedIsland.Codex;

namespace UnmappedIsland.Runtime
{
    /// <summary>
    /// 実行中に生成される WorldObject の発行と、それに紐づく Containment をまとめて持つ、
    /// 1セッション分の実行時状態（WorldCodex.cs のコメントで予告されている「実行時側」の最小実装）。
    /// WorldCodex 自体はロード後不変な定義の集合であり続けるため、instance ID の発行という
    /// 可変な状態はここに持たせる。
    /// </summary>
    public sealed class WorldSession
    {
        public WorldCodex Codex { get; }
        public Containment Containment { get; }

        private int nextInstanceId = 1;

        public WorldSession(WorldCodex codex)
        {
            Codex = codex;
            Containment = codex.CreateContainment();
        }

        /// <summary>
        /// 指定した ObjectDef の新しい WorldObject を生成する（spawn、9.4節）。まだどこにも配置されて
        /// いないため、呼び出し側が Containment.TryMoveToSlot で配置する。
        /// </summary>
        public WorldObject Spawn(int objectDefGlobalId)
        {
            ObjectDef def = Codex.Objects.Get(objectDefGlobalId);
            return new WorldObject(nextInstanceId++, def);
        }
    }
}
