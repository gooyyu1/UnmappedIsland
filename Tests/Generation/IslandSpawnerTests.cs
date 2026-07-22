using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using NUnit.Framework;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Domain.Generation;
using UnmappedIsland.Domain.Runtime;
using UnmappedIsland.Domain.Runtime.Views;
using UnmappedIsland.Loader;
using Path = UnmappedIsland.Domain.Runtime.Views.Path;

namespace UnmappedIsland.Generation
{
    /// <summary>
    /// IslandSpawner / NewGame（生成結果の世界への実体化）に対する自動テスト。実際のWorldCodex定義を
    /// 使い、「新しいゲームを開始 → 探索で道を全部見つける → 道で移動する」という一連の流れまでを検証する。
    /// </summary>
    [TestFixture]
    public class IslandSpawnerTests
    {
        private WorldCodex codex;

        [OneTimeSetUp]
        public void LoadWorldCodexDirectory()
        {
            string directory = FindRepoDirectory("Assets/StreamingAssets/WorldCodex");
            codex = new WorldCodexYamlLoader().LoadFromDirectory(directory).Build();
        }

        private static string FindRepoDirectory(string relativePath)
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null)
            {
                string candidate = System.IO.Path.Combine(dir.FullName, relativePath);
                if (Directory.Exists(candidate)) return candidate;
                dir = dir.Parent;
            }
            throw new DirectoryNotFoundException($"'{relativePath}' が祖先ディレクトリの中に見つかりませんでした。");
        }

        [Test]
        public void Start_SpawnsAllLocationsIntoWorld_AndPathsForEveryEdgeEnd()
        {
            NewGameSession game = NewGame.Start(codex, seed: 3, new Random(99));
            IslandMap map = game.Map;

            int locationsSlotId = codex.SlotNames.GetId("locations");
            Assert.That(game.World.Instance.TryGetSlot(locationsSlotId, out Slot locations), Is.True);
            Assert.That(locations.Contents.Count, Is.EqualTo(map.Sites.Count), "全サイトが土地として実体化される");

            int totalPaths = 0;
            foreach (Site site in map.Sites)
            {
                WorldObject location = game.World.Instance.FindDescendantByInstanceId(map.SiteInstanceIds[site.Index]);
                Assert.That(location, Is.Not.Null, $"サイト{site.Index}の土地が世界に居る");
                Assert.That(location.Def.GlobalId, Is.EqualTo(site.Type.ObjectDefGlobalId),
                    $"サイト{site.Index}はLocationTypeどおりのobject_defで実体化される");

                var view = new Location(location, codex);
                int degree = map.Edges.Count(e => e.A == site.Index || e.B == site.Index);
                Assert.That(view.Paths, Is.Empty, "開始直後、発見済みの道は無い");

                location.TryGetSlot(codex.SlotNames.GetId("undiscovered_paths"), out Slot hidden);
                Assert.That(hidden.Contents.Count, Is.EqualTo(degree),
                    $"サイト{site.Index}: 繋がる辺の数だけ道が隠されている");
                totalPaths += hidden.Contents.Count;
            }

            Assert.That(totalPaths, Is.EqualTo(map.Edges.Count * 2), "辺1本につき両端へ1個ずつ道が作られる");
        }

        [Test]
        public void Start_PathProperties_PointToNeighborWithTravelTime_AndAreDiscoverableBeforeMax()
        {
            NewGameSession game = NewGame.Start(codex, seed: 5, new Random(99));
            IslandMap map = game.Map;
            int progressId = codex.PropertyNames.GetId("exploration_progress");

            foreach (Site site in map.Sites)
            {
                WorldObject location = game.World.Instance.FindDescendantByInstanceId(map.SiteInstanceIds[site.Index]);
                int progressMax = location.Def.GetPropertyDef(progressId).Range.Value.Max;
                location.TryGetSlot(codex.SlotNames.GetId("undiscovered_paths"), out Slot hidden);

                var neighborInstanceIds = map.Edges
                    .Where(e => e.A == site.Index || e.B == site.Index)
                    .Select(e => map.SiteInstanceIds[e.A == site.Index ? e.B : e.A])
                    .ToHashSet();

                foreach (WorldObject pathInstance in hidden.Contents)
                {
                    var path = new Path(pathInstance, codex.PropertyNames);
                    Assert.That(neighborInstanceIds, Does.Contain(path.DestinationInstanceId),
                        $"サイト{site.Index}: 道は隣接する土地を指す");
                    Assert.That(path.TravelMinutes, Is.GreaterThanOrEqualTo(15));
                    Assert.That(path.RequiredProgress, Is.InRange(2, progressMax - 1),
                        $"サイト{site.Index}: すべての道は進捗が最大へ達する前に見つかる");
                }
            }
        }

        [Test]
        public void Start_PlacesPlayerOnACoastLand()
        {
            NewGameSession game = NewGame.Start(codex, seed: 8, new Random(99));

            Assert.That(game.StartLocation.Characters, Does.Contain(game.Player.Instance),
                "プレイヤーは開始地点のcharactersスロットに居る");

            int startIndex = Array.IndexOf(game.Map.SiteInstanceIds, game.StartLocation.Instance.InstanceId);
            Assert.That(game.Map.Sites[startIndex].OnCoastRing, Is.True, "漂着地点は海岸（外周リング）の土地");
        }

        [Test]
        public void FullPlaythrough_ExploreFindsAllPaths_ThenTravelMovesPlayerAndTime()
        {
            NewGameSession game = NewGame.Start(codex, seed: 11, new Random(1234));
            WorldSession session = game.Session;
            Location start = game.StartLocation;
            WorldObject actor = game.Player.Instance;

            int startIndex = Array.IndexOf(game.Map.SiteInstanceIds, start.Instance.InstanceId);
            int degree = game.Map.Edges.Count(e => e.A == startIndex || e.B == startIndex);
            Assert.That(degree, Is.GreaterThanOrEqualTo(1), "開始地点にも必ず道がある(MSTの連結性)");

            // 探索を上限まで繰り返す。途中(上限-1以前)ですべての道が見つかる。
            int explorations = 0;
            while (start.Explore(actor, session)) explorations++;

            Assert.That(explorations, Is.EqualTo(start.ExplorationProgressMax), "上限回数だけ探索できる");
            Assert.That(start.Paths.Count, Is.EqualTo(degree), "探索でこの土地のすべての道が見つかる");

            // 見つかった道で移動する。
            var path = new Path(start.Paths[0], codex.PropertyNames);
            int minutesBefore = TotalMinutes(game.World);

            Assert.That(path.Travel(actor, session), Is.True);

            Assert.That(actor.Parent.InstanceId, Is.EqualTo(path.DestinationInstanceId),
                "プレイヤーは道の行き先の土地へ移る");
            Assert.That(new Location(actor.Parent, codex).Characters, Does.Contain(actor),
                "移動先ではcharactersスロットに入る");
            Assert.That(TotalMinutes(game.World) - minutesBefore, Is.EqualTo(path.TravelMinutes),
                "移動時間の分だけゲーム内時間が進む");
        }

        [Test]
        public void Start_SameSeed_ProducesSameIslandLayout()
        {
            // 地形レイアウト(IslandMap)はシードのみに依存し、WorldSession.Rng(pick抽選など)には
            // 依存しない: Rngのシードを変えても同じ島になる。
            NewGameSession first = NewGame.Start(codex, seed: 21, new Random(1));
            NewGameSession second = NewGame.Start(codex, seed: 21, new Random(2));

            Assert.That(second.Map.Sites.Select(s => (s.X, s.Y, s.Type.Name, s.Name)),
                Is.EqualTo(first.Map.Sites.Select(s => (s.X, s.Y, s.Type.Name, s.Name))));
            Assert.That(second.Map.Edges.Select(e => (e.A, e.B, e.TravelMinutes)),
                Is.EqualTo(first.Map.Edges.Select(e => (e.A, e.B, e.TravelMinutes))));
        }

        private static int TotalMinutes(World world) =>
            (world.Day - 1) * 24 * 60 + world.Hour * 60 + world.Minute;
    }
}
