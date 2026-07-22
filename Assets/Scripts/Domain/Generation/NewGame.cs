using System;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Domain.Runtime;
using UnmappedIsland.Domain.Runtime.Views;

namespace UnmappedIsland.Domain.Generation
{
    /// <summary>NewGame.Startが組み立てた、開始直後のゲーム一式。</summary>
    public sealed class NewGameSession
    {
        public WorldSession Session { get; }
        public World World { get; }
        public PlayerCharacter Player { get; }

        /// <summary>プレイヤーが漂着した開始地点の土地。</summary>
        public Location StartLocation { get; }

        /// <summary>生成された島のレイアウト（土地の座標・名前・道のネットワーク。UI/デバッグ用）。</summary>
        public IslandMap Map { get; }

        public NewGameSession(WorldSession session, World world, PlayerCharacter player, Location startLocation, IslandMap map)
        {
            Session = session;
            World = world;
            Player = player;
            StartLocation = startLocation;
            Map = map;
        }
    }

    /// <summary>
    /// 新しいゲームの開始一式（world/プレイヤーの生成 → 地形生成 → 島の実体化 → プレイヤー配置）を
    /// 1回の呼び出しに閉じ込める入口。呼び出し側（UnityのGameManager等）は「Codexとシードを渡す」
    /// だけでよく、生成と配置の手順・順序を知らなくてよい（自分のことは自分でする、CLAUDE.md参照）。
    /// </summary>
    public static class NewGame
    {
        /// <summary>
        /// 新しいゲームを開始する。rngはpick抽選・初期値ロール用のWorldSession.Rng（省略時は非決定。
        /// 地形レイアウト自体はseedのみで決まり、rngには依存しない）。
        /// </summary>
        public static NewGameSession Start(WorldCodex codex, int seed, Random rng = null)
        {
            // worldはInstanceId 0で直接生成する（WorldSession.Spawnの発行IDは1始まりのため衝突しない）。
            // 生成用の一時セッションを使うのは、WorldObjectの生成にsession（初期値ロール文脈）が必要で、
            // World付きセッション自体がworldインスタンスを必要とするという相互依存を断ち切るため。
            var bootstrap = new WorldSession(codex);
            var worldInstance = new WorldObject(0, codex.Objects.Get(codex.ObjectNames.GetId("world")), bootstrap);
            var world = new World(worldInstance, codex.PropertyNames);

            var session = new WorldSession(codex, world, rng);
            WorldObject character = session.Spawn(codex.ObjectNames.GetId("character"));

            IslandMap map = TerrainGenerator.Generate(codex.Generation, "island", seed);
            IslandSpawner.Populate(session, map);
            Location start = IslandSpawner.PlacePlayer(session, map, character);

            return new NewGameSession(session, world, new PlayerCharacter(character, codex.PropertyNames), start, map);
        }
    }
}
