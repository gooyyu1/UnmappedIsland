using System;
using UnmappedIsland.Codex;

namespace UnmappedIsland.Runtime
{
    /// <summary>
    /// 実行中に生成される WorldObject の instance ID 発行をまとめて持つ、1セッション分の実行時状態
    /// （WorldCodex.cs のコメントで予告されている「実行時側」の最小実装）。WorldCodex 自体は
    /// ロード後不変な定義の集合であり続けるため、instance ID の発行という可変な状態はここに持たせる。
    /// スロット移動（move_to_slot）自体は WorldObject.MoveToSlot が自分自身の責務として行うため、
    /// ここでは仲介しない（WellKnownPropertiesは Codex.WellKnown からその都度渡す）。
    /// </summary>
    public sealed class WorldSession
    {
        public WorldCodex Codex { get; }

        /// <summary>pick（10節）の重み付き抽選に使う乱数源。テストで決定的に振る舞わせたい場合は、
        /// シード固定の Random を渡せるようにコンストラクタで差し替え可能にしている。</summary>
        public Random Rng { get; }

        private int nextInstanceId = 1;

        public WorldSession(WorldCodex codex, Random rng = null)
        {
            Codex = codex;
            Rng = rng ?? new Random();
        }

        /// <summary>
        /// 指定した ObjectDef の新しい WorldObject を生成する（spawn、9.4節）。まだどこにも配置されて
        /// いないため、呼び出し側が生成された WorldObject.MoveToSlot で配置する。
        /// </summary>
        public WorldObject Spawn(int objectDefGlobalId)
        {
            ObjectDef def = Codex.Objects.Get(objectDefGlobalId);
            return new WorldObject(nextInstanceId++, def);
        }
    }
}
