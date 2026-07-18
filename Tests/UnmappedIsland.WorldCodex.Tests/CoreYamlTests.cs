using System;
using System.IO;
using System.Linq;
using NUnit.Framework;
using UnmappedIsland.Codex;
using UnmappedIsland.GameTime;
using UnmappedIsland.Loader;
using UnmappedIsland.Runtime;
using UnmappedIsland.Runtime.Views;

namespace UnmappedIsland.Codex.Tests
{
    /// <summary>
    /// Assets/StreamingAssets/WorldCodex/core.yaml（ゲーム本体の最も基本的な定義: world・locationトレイト）
    /// が、実際のファイルとして正しくロードできることを確認する自動テスト。
    /// </summary>
    [TestFixture]
    public class CoreYamlTests
    {
        private WorldCodex codex;

        [OneTimeSetUp]
        public void LoadCoreYaml()
        {
            string path = FindRepoFile("Assets/StreamingAssets/WorldCodex/core.yaml");
            codex = WorldCodexYamlLoader.LoadFromGroups(new[]
            {
                new WorldCodexYamlLoader.SourceGroup(
                    "core", new[] { new WorldCodexYamlLoader.SourceFile(path, File.ReadAllText(path)) }),
            });
        }

        /// <summary>dotnet testの実行ディレクトリ(bin/配下)から、リポジトリルート基準の相対パスを
        /// たどれるよう、targetを含む祖先ディレクトリを探索する。</summary>
        private static string FindRepoFile(string relativePath)
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null)
            {
                string candidate = Path.Combine(dir.FullName, relativePath);
                if (File.Exists(candidate)) return candidate;
                dir = dir.Parent;
            }
            throw new FileNotFoundException($"'{relativePath}' が祖先ディレクトリの中に見つかりませんでした。");
        }

        private static WorldCodexYamlLoader.SourceGroup Group(string label, params (string FileLabel, string Text)[] files)
        {
            return new WorldCodexYamlLoader.SourceGroup(
                label, files.Select(f => new WorldCodexYamlLoader.SourceFile(f.FileLabel, f.Text)).ToList());
        }

        [Test]
        public void World_IsSingletonWithExpectedDefaultProperties()
        {
            ObjectDef world = codex.Objects.Get(codex.ObjectNames.GetId("world"));
            Assert.That(world.IsSingleton, Is.True);

            Assert.That(PropOf(world, "tick").DefaultNumber, Is.EqualTo(0));
            Assert.That(PropOf(world, "minutes_per_tick").DefaultNumber, Is.EqualTo(15));
            Assert.That(PropOf(world, "minute").DefaultNumber, Is.EqualTo(0));
            Assert.That(PropOf(world, "hour").DefaultNumber, Is.EqualTo(0));
            Assert.That(PropOf(world, "day").DefaultNumber, Is.EqualTo(1));
            Assert.That(PropOf(world, "temperature").DefaultNumber, Is.EqualTo(20));
        }

        [Test]
        public void World_MinuteAndHour_HaveWrapOverflowConfigured()
        {
            ObjectDef world = codex.Objects.Get(codex.ObjectNames.GetId("world"));

            PropertyDef minute = PropOf(world, "minute");
            Assert.That(minute.Range.Value.Max, Is.EqualTo(59));
            Assert.That(minute.OnOverflow, Is.Not.Null);
            Assert.That(minute.OnOverflow.Adds[ReferenceRoot.Self].Count, Is.GreaterThan(0));

            PropertyDef hour = PropOf(world, "hour");
            Assert.That(hour.Range.Value.Max, Is.EqualTo(23));
            Assert.That(hour.OnOverflow, Is.Not.Null);
            Assert.That(hour.OnOverflow.Adds[ReferenceRoot.Self].Count, Is.GreaterThan(0));
        }

        [Test]
        public void World_Tick_AccumulatesPerTick_MinuteDoesNot()
        {
            // minuteはtick駆動のpassivesを持たない。「1tick進める」たびにminutes_per_tick分だけ加算する
            // 処理自体をWorldClock（ゲーム側）が担うため（GameTime.WorldClockTests参照）、core.yaml単体で
            // Tick()を直接呼んでもminuteは変化しないことをここで確認する。
            ObjectDef world = codex.Objects.Get(codex.ObjectNames.GetId("world"));
            int tickId = codex.PropertyNames.GetId("tick");
            int minuteId = codex.PropertyNames.GetId("minute");

            var session = new WorldSession(codex);
            var worldInstance = new WorldObject(1, world);
            worldInstance.Tick(session);
            worldInstance.Tick(session);
            worldInstance.Tick(session);

            Assert.That(worldInstance.GetNumber(tickId), Is.EqualTo(3), "tickは毎tick+1される");
            Assert.That(worldInstance.GetNumber(minuteId), Is.EqualTo(0), "minuteはtick駆動では変化しない(WorldClock経由でのみ進む)");
        }

        [Test]
        public void World_MinuteOverflow_CarriesToHourAndCascadesToDay()
        {
            ObjectDef world = codex.Objects.Get(codex.ObjectNames.GetId("world"));
            int minuteId = codex.PropertyNames.GetId("minute");
            int hourId = codex.PropertyNames.GetId("hour");
            int dayId = codex.PropertyNames.GetId("day");

            var session = new WorldSession(codex);
            var worldInstance = new WorldObject(1, world);
            var worldView = new World(worldInstance, codex.PropertyNames);

            WorldClock.Advance(worldView, session, 60); // 60分 -> minuteが折り返し、hourへ+1

            Assert.That(worldInstance.GetNumber(minuteId), Is.EqualTo(0));
            Assert.That(worldInstance.GetNumber(hourId), Is.EqualTo(1));

            WorldClock.Advance(worldView, session, 60 * 23); // 残り23時間分進め、hourもdayへ折り返させる

            Assert.That(worldInstance.GetNumber(minuteId), Is.EqualTo(0));
            Assert.That(worldInstance.GetNumber(hourId), Is.EqualTo(0));
            Assert.That(worldInstance.GetNumber(dayId), Is.EqualTo(2));
        }

        [Test]
        public void World_HourStage_ModifiesTemperatureByTimeOfDay()
        {
            ObjectDef world = codex.Objects.Get(codex.ObjectNames.GetId("world"));
            int hourId = codex.PropertyNames.GetId("hour");
            int temperatureId = codex.PropertyNames.GetId("temperature");

            var worldInstance = new WorldObject(1, world);

            void AssertTemperatureAt(int hour, int expectedEffective, string because)
            {
                worldInstance.SetProperty(hourId, PropertyValue.FromNumber(hour));
                Assert.That(worldInstance.GetEffectiveValue(temperatureId), Is.EqualTo(expectedEffective), because);
            }

            AssertTemperatureAt(0, 17, "深夜(フォールバックのnight)はやや涼しい");
            AssertTemperatureAt(5, 17, "night(0-5時)の最後の時間もやや涼しいまま");
            AssertTemperatureAt(6, 20, "morning(6-9時)は補正なし");
            AssertTemperatureAt(9, 20, "morning(6-9時)の最後の時間も補正なしのまま");
            AssertTemperatureAt(10, 23, "day(10-17時)はやや暑い");
            AssertTemperatureAt(17, 23, "day(10-17時)の最後の時間もやや暑いまま");
            AssertTemperatureAt(18, 20, "evening(18-21時)は補正なし");
            AssertTemperatureAt(21, 20, "evening(18-21時)の最後の時間も補正なしのまま");
            AssertTemperatureAt(22, 17, "night_late(22-23時)はnightと同じくやや涼しい");
            AssertTemperatureAt(23, 17, "night_late(22-23時)の最後の時間もやや涼しいまま");
        }

        [Test]
        public void World_LocationsSlot_AcceptsOnlyObjectsWithLocationTag()
        {
            ObjectDef world = codex.Objects.Get(codex.ObjectNames.GetId("world"));
            SlotDef locations = SlotOf(world, "locations");

            Assert.That(locations.Accepts.Count, Is.EqualTo(1));

            // locationタグを、traitを経由して持つobject_defと、traitを介さず直接tagsで持つobject_def、
            // どちらも同じように受け入れられることを確認する（同一traitでなくても同じタグを共有していれば
            // 受け入れたい、という設計意図。CLAUDE.md参照ではなく本タスクの意図そのもの）。
            const string yaml = @"
traits:
  location: {tags: [location]}
object_defs:
  test_world:
    slots:
      locations:
        accepts:
          - {tag: location, max: 9999}
  test_forest:
    traits: [location]
  test_beach:
    tags: [location]
  test_rock: {}
";
            var testCodex = WorldCodexYamlLoader.LoadFromGroups(new[] { Group("core", ("core.yaml", yaml)) });

            int locationsSlotId = testCodex.SlotNames.GetId("locations");
            var session = new WorldSession(testCodex);
            WorldObject worldInstance = new WorldObject(1, testCodex.Objects.Get(testCodex.ObjectNames.GetId("test_world")));
            WorldObject forestInstance = new WorldObject(2, testCodex.Objects.Get(testCodex.ObjectNames.GetId("test_forest")));
            WorldObject beachInstance = new WorldObject(3, testCodex.Objects.Get(testCodex.ObjectNames.GetId("test_beach")));
            WorldObject rockInstance = new WorldObject(4, testCodex.Objects.Get(testCodex.ObjectNames.GetId("test_rock")));

            Assert.That(forestInstance.MoveToSlot(worldInstance, locationsSlotId, session.Codex.WellKnown, out _), Is.True,
                "traitを経由してlocationタグを持つオブジェクトは受け入れられる");
            Assert.That(beachInstance.MoveToSlot(worldInstance, locationsSlotId, session.Codex.WellKnown, out _), Is.True,
                "traitを介さず直接tagsでlocationタグを持つオブジェクトも、同一traitでなくても受け入れられる");
            Assert.That(rockInstance.MoveToSlot(worldInstance, locationsSlotId, session.Codex.WellKnown, out _), Is.False,
                "locationタグを持たないオブジェクトは拒否される");
        }

        private PropertyDef PropOf(ObjectDef def, string propertyName)
        {
            int local = def.PropertyLayout.ToLocal(codex.PropertyNames.GetId(propertyName));
            return def.PropertyDefs[local];
        }

        private SlotDef SlotOf(ObjectDef def, string slotName)
        {
            int local = def.SlotLayout.ToLocal(codex.SlotNames.GetId(slotName));
            return def.SlotDefs[local];
        }
    }
}
