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
            Assert.That(PropOf(world, "ambient_temperature").DefaultNumber, Is.EqualTo(20));
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
        public void World_Sunlight_ModifiesAmbientTemperature()
        {
            ObjectDef world = codex.Objects.Get(codex.ObjectNames.GetId("world"));
            int hourId = codex.PropertyNames.GetId("hour");
            int weatherId = codex.PropertyNames.GetId("weather");
            int ambientTemperatureId = codex.PropertyNames.GetId("ambient_temperature");

            var worldInstance = new WorldObject(1, world);

            void AssertAmbientTemperatureAt(int weather, int hour, int expectedEffective, string because)
            {
                worldInstance.SetProperty(weatherId, PropertyValue.FromNumber(weather));
                worldInstance.SetProperty(hourId, PropertyValue.FromNumber(hour));
                Assert.That(worldInstance.GetEffectiveValue(ambientTemperatureId), Is.EqualTo(expectedEffective), because);
            }

            // 夜はweatherによらずsunlight=0のため、常にやや涼しい（hourを直接見ず、sunlight経由で補正）
            AssertAmbientTemperatureAt(weather: 0, hour: 2, expectedEffective: 17, "晴れの深夜でもsunlightは0なのでやや涼しい");
            AssertAmbientTemperatureAt(weather: 3, hour: 23, expectedEffective: 17, "大雨の夜もやや涼しい");

            // sunlightが中間(1-6)の時間帯は補正なし
            AssertAmbientTemperatureAt(weather: 1, hour: 6, expectedEffective: 20, "曇りの朝(sunlight=2+2=4)は補正なし");
            AssertAmbientTemperatureAt(weather: 3, hour: 12, expectedEffective: 20, "大雨の昼(sunlight=5+0=5)も補正なし");

            // sunlightが7以上ならやや暑い
            AssertAmbientTemperatureAt(weather: 0, hour: 12, expectedEffective: 23, "晴れた昼(sunlight=5+5=10)はやや暑い");
            AssertAmbientTemperatureAt(weather: 0, hour: 6, expectedEffective: 23, "晴れの朝(sunlight=2+5=7)もやや暑い");
            AssertAmbientTemperatureAt(weather: 1, hour: 12, expectedEffective: 23, "曇りの昼(sunlight=5+2=7)もやや暑い");
        }

        [Test]
        public void World_WeatherAndHour_ModifySunlight()
        {
            ObjectDef world = codex.Objects.Get(codex.ObjectNames.GetId("world"));
            int hourId = codex.PropertyNames.GetId("hour");
            int weatherId = codex.PropertyNames.GetId("weather");
            int sunlightId = codex.PropertyNames.GetId("sunlight");

            var worldInstance = new WorldObject(1, world);

            void AssertSunlightAt(int weather, int hour, int expectedEffective, string because)
            {
                worldInstance.SetProperty(weatherId, PropertyValue.FromNumber(weather));
                worldInstance.SetProperty(hourId, PropertyValue.FromNumber(hour));
                Assert.That(worldInstance.GetEffectiveValue(sunlightId), Is.EqualTo(expectedEffective), because);
            }

            // 夜: hour側の最低限の寄与が0であり、weather側の追加ボーナスもconditionsで無効化されるため、
            // weatherによらず常に0（晴れていても夜であれば日差しは強くない、という設計意図）
            AssertSunlightAt(weather: 0, hour: 2, expectedEffective: 0, "晴れの深夜でも0");
            AssertSunlightAt(weather: 3, hour: 23, expectedEffective: 0, "大雨の夜は0");

            // 昼(10-17時): hour側の最低限の寄与(5)に、weather側の追加ボーナスが加算される
            AssertSunlightAt(weather: 0, hour: 12, expectedEffective: 10, "晴れた昼はhour(5)+weather(5)で最大");
            AssertSunlightAt(weather: 1, hour: 12, expectedEffective: 7, "曇りの昼はhour(5)+weather(2)");
            AssertSunlightAt(weather: 2, hour: 12, expectedEffective: 6, "小雨の昼はhour(5)+weather(1)");
            AssertSunlightAt(weather: 3, hour: 12, expectedEffective: 5,
                "大雨の昼はweatherの追加ボーナスがなくhour(5)の最低限の寄与のみ");

            // 朝(6-9時)・夕方(18-21時): hour側の最低限の寄与(2)は昼より弱いが、weather側のボーナスは昼と同じ
            AssertSunlightAt(weather: 0, hour: 7, expectedEffective: 7, "晴れの朝はhour(2)+weather(5)");
            AssertSunlightAt(weather: 0, hour: 20, expectedEffective: 7, "晴れの夕方は朝と同じ強さ");
            AssertSunlightAt(weather: 3, hour: 8, expectedEffective: 2,
                "大雨の朝でもhour側の最低限の寄与(2)は残る（雨でも昼は夜より明るいはず、という設計意図）");
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
