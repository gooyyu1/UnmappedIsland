using System;
using System.IO;
using System.Linq;
using NUnit.Framework;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Loader;
using UnmappedIsland.Domain.Runtime;
using UnmappedIsland.Domain.Runtime.Views;
using Path = UnmappedIsland.Domain.Runtime.Views.Path;

namespace UnmappedIsland.StreamingAssets
{
    /// <summary>
    /// Assets/StreamingAssets/WorldCodex/locations.yaml（土地と道の定義）が、他の実ファイル
    /// （core/characters/foods/containers）と一緒に正しくロードでき、要求仕様（全土地がlocation trait実装・
    /// 3種+道2種のスロット・キャラクタスロットは固定型でスタック1・探索回数10〜20・探索上限・
    /// 隠しスロット経由の道の発見・移動）を満たすことを確認する自動テスト。
    /// </summary>
    [TestFixture]
    public class LocationsYamlTests
    {
        /// <summary>locations.yamlが定義する全土地。</summary>
        private static readonly string[] LandNames =
        {
            "sandy_beach", "rocky_coast", "cliff_coast",
            "grassland", "forest", "jungle",
            "rocky_field", "wasteland", "mountainside", "mountain_peak",
        };

        private WorldCodex codex;

        [OneTimeSetUp]
        public void LoadWorldCodexDirectory()
        {
            // 土地の発見物（foods.yamlの食料等）・キャラクタ（characters.yaml）への参照があるため、
            // 単体ファイルではなくディレクトリ全体を一括ロードする。
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

        private ObjectDef Def(string name) => codex.Objects.Get(codex.ObjectNames.GetId(name));

        [Test]
        public void AllLands_HaveLocationTag()
        {
            int locationTag = codex.TagNames.GetId("location");
            foreach (string name in LandNames)
                Assert.That(Def(name).Tags, Does.Contain(locationTag), $"{name} はlocationタグ（location trait）を持つ");
        }

        [Test]
        public void AllLands_HaveExpectedSlots_AndFixedSingleCharacterSlot()
        {
            foreach (string name in LandNames)
            {
                ObjectDef land = Def(name);
                foreach (string slotName in new[] { "items", "fixtures", "characters", "undiscovered_paths", "paths" })
                    Assert.That(land.GetSlotDef(codex.SlotNames.GetId(slotName)), Is.Not.Null, $"{name} は {slotName} スロットを持つ");

                SlotDef characters = land.GetSlotDef(codex.SlotNames.GetId("characters"));
                Assert.That(characters.FixedPositions, Is.True, $"{name} のキャラクタスロットは固定型");
                Assert.That(characters.UnitCapacity, Is.EqualTo(1), $"{name} のキャラクタスロットのスタック数は1");

                SlotDef items = land.GetSlotDef(codex.SlotNames.GetId("items"));
                SlotDef fixtures = land.GetSlotDef(codex.SlotNames.GetId("fixtures"));
                Assert.That(items.Capacity, Is.Null, $"{name} のアイテムスロットにサイズ制限は無い");
                Assert.That(fixtures.Capacity, Is.Null, $"{name} の設置物スロットにサイズ制限は無い");
            }
        }

        [Test]
        public void AllLands_ExplorationCount_IsBetween10And20()
        {
            int progressId = codex.PropertyNames.GetId("exploration_progress");
            foreach (string name in LandNames)
            {
                PropertyDef progress = Def(name).GetPropertyDef(progressId);
                Assert.That(progress, Is.Not.Null, $"{name} は探索進捗プロパティを持つ");
                Assert.That(progress.Range.HasValue, Is.True, $"{name} の探索進捗はrangeを持つ");
                Assert.That(progress.Range.Value.Max, Is.InRange(10, 20), $"{name} の探索可能回数は10〜20");
            }
        }

        [Test]
        public void AllLands_Explore_AddsProgress_AndStopsExactlyAtMax()
        {
            // exploreのconditionsのリテラル値がrange.maxと一致していること（value: max記法が未対応のための
            // 二重管理）を、値の照合ではなく振る舞いで検証する: max-1では実行でき（実行後ちょうどmaxになる）、
            // maxでは実行できない。リテラルがmaxよりずれていれば、このどちらかが必ず破れる。
            int progressId = codex.PropertyNames.GetId("exploration_progress");
            var session = new WorldSession(codex, new Random(1));

            foreach (string name in LandNames)
            {
                WorldObject land = session.Spawn(codex.ObjectNames.GetId(name));
                int max = land.Def.GetPropertyDef(progressId).Range.Value.Max;

                land.SetProperty(progressId, max - 1);
                Assert.That(land.TryExecuteAction("explore", actor: null, session), Is.True,
                    $"{name}: 進捗max-1ではまだ探索できる");
                Assert.That(land.GetNumber(progressId), Is.EqualTo(max),
                    $"{name}: 探索1回で進捗が+1される（どの抽選候補でも）");

                Assert.That(land.TryExecuteAction("explore", actor: null, session), Is.False,
                    $"{name}: 進捗maxに達したらもう探索できない");
            }
        }

        [Test]
        public void Explore_SpawnedFindings_AreSortedIntoItemsAndFixturesSlots()
        {
            // 発見物のspawn（into: self）が、item/fixtureタグのacceptsによってitems/fixturesスロットへ
            // 正しく振り分けられることを、探索を回し切って確認する。
            var session = new WorldSession(codex, new Random(7));
            WorldObject land = session.Spawn(codex.ObjectNames.GetId("grassland"));
            var view = new Location(land, codex);

            while (view.Explore(actor: null, session: session)) { }

            Assert.That(view.ExplorationProgress, Is.EqualTo(view.ExplorationProgressMax));
            int itemTag = codex.TagNames.GetId("item");
            int fixtureTag = codex.TagNames.GetId("fixture");
            Assert.That(view.Items, Is.All.Matches<WorldObject>(o => o.Def.Tags.Contains(itemTag)),
                "itemsスロットにはitemタグの発見物だけが入る");
            Assert.That(view.Fixtures, Is.All.Matches<WorldObject>(o => o.Def.Tags.Contains(fixtureTag)),
                "fixturesスロットにはfixtureタグの発見物だけが入る");
        }

        [Test]
        public void ExploreRevealTravel_EndToEnd()
        {
            // 探索 → 進捗が必要値に達した道の発見（隠しスロット→公開スロット） → 移動、の一連の流れを
            // 実ファイルの定義だけで検証する（地形生成は使わず、道の配線はこのテストが手で行う）。
            var worldInstance = new WorldObject(0, Def("world"), new WorldSession(codex));
            var worldView = new World(worldInstance, codex.PropertyNames);
            var session = new WorldSession(codex, worldView, new Random(42));

            WorldObject grassland = session.Spawn(codex.ObjectNames.GetId("grassland"));
            WorldObject forest = session.Spawn(codex.ObjectNames.GetId("forest"));
            WorldObject character = session.Spawn(codex.ObjectNames.GetId("character"));
            WorldObject pathToForest = session.Spawn(codex.ObjectNames.GetId("path"));

            int locationsSlotId = codex.SlotNames.GetId("locations");
            Assert.That(grassland.MoveToSlot(worldInstance, locationsSlotId, codex.WellKnown, out string e1), Is.True, e1);
            Assert.That(forest.MoveToSlot(worldInstance, locationsSlotId, codex.WellKnown, out string e2), Is.True, e2);
            Assert.That(character.MoveToSlot(grassland, codex.SlotNames.GetId("characters"), codex.WellKnown, out string e3), Is.True, e3);
            Assert.That(pathToForest.MoveToSlot(grassland, codex.SlotNames.GetId("undiscovered_paths"), codex.WellKnown, out string e4), Is.True, e4);

            pathToForest.SetProperty(codex.PropertyNames.GetId("required_progress"), 3);
            pathToForest.SetProperty(codex.PropertyNames.GetId("travel_minutes"), 90);
            pathToForest.SetProperty(codex.PropertyNames.GetId("destination_id"), forest.InstanceId);

            var grasslandView = new Location(grassland, codex);
            var pathView = new Path(pathToForest, codex.PropertyNames);

            // 進捗2までは道は見つからず、未発見の道は移動アクションも成立しない（in_slot: paths条件）。
            Assert.That(grasslandView.Explore(character, session), Is.True);
            Assert.That(grasslandView.Explore(character, session), Is.True);
            Assert.That(grasslandView.Paths, Is.Empty, "進捗2ではまだ道は見つからない");
            Assert.That(pathView.Travel(character, session), Is.False, "未発見の道は移動できない");
            Assert.That(character.Parent, Is.SameAs(grassland));

            // 進捗3で道が発見される。
            Assert.That(grasslandView.Explore(character, session), Is.True);
            Assert.That(grasslandView.Paths, Does.Contain(pathToForest), "進捗3（required_progress）で道が公開される");

            // 発見済みの道で移動すると、プレイヤーは移動先のcharactersスロットへ移り、移動時間分だけ時間が進む。
            int minutesBefore = worldView.Hour * 60 + worldView.Minute;
            Assert.That(minutesBefore, Is.EqualTo(30 * 3), "草原の探索3回でduration 30分×3が経過している");
            Assert.That(pathView.Travel(character, session), Is.True);

            Assert.That(character.Parent, Is.SameAs(forest), "移動で移動先の土地へ移る");
            Assert.That(new Location(forest, codex).Characters, Does.Contain(character),
                "移動先ではcharactersスロットに入る");
            Assert.That(worldView.Hour * 60 + worldView.Minute, Is.EqualTo(minutesBefore + 90),
                "移動時間（travel_minutes=90分）が経過する");
        }
    }
}
