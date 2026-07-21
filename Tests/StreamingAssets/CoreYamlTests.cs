using System;
using System.IO;
using NUnit.Framework;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Loader;
using UnmappedIsland.Domain.Runtime;
using UnmappedIsland.Domain.Runtime.Views;

namespace UnmappedIsland.StreamingAssets
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
            codex = new WorldCodexYamlLoader().LoadFromFile(path).Build();
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

        private static WorldCodex Load(string yaml) => new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();

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
            // 処理自体をWorldSession（ゲーム側）が担うため（WorldClockTests参照）、core.yaml単体で
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
            Assert.That(worldInstance.GetNumber(minuteId), Is.EqualTo(0), "minuteはtick駆動では変化しない(WorldSession経由でのみ進む)");
        }

        [Test]
        public void World_MinuteOverflow_CarriesToHourAndCascadesToDay()
        {
            ObjectDef world = codex.Objects.Get(codex.ObjectNames.GetId("world"));
            int minuteId = codex.PropertyNames.GetId("minute");
            int hourId = codex.PropertyNames.GetId("hour");
            int dayId = codex.PropertyNames.GetId("day");

            var worldInstance = new WorldObject(1, world);
            var worldView = new World(worldInstance, codex.PropertyNames);
            var session = new WorldSession(codex, worldView);

            session.AdvanceWorldTime(60); // 60分 -> minuteが折り返し、hourへ+1

            Assert.That(worldInstance.GetNumber(minuteId), Is.EqualTo(0));
            Assert.That(worldInstance.GetNumber(hourId), Is.EqualTo(1));

            session.AdvanceWorldTime(60 * 23); // 残り23時間分進め、hourもdayへ折り返させる

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

            void AssertAmbientTemperatureAt(string weather, int hour, int expectedEffective, string because)
            {
                worldInstance.SetProperty(weatherId, codex.SymbolNames.Intern(weather));
                worldInstance.SetProperty(hourId, hour);
                Assert.That(worldInstance.GetEffectiveValue(ambientTemperatureId), Is.EqualTo(expectedEffective), because);
            }

            // 夜はweatherによらずsunlight=0のため、常にやや涼しい（hourを直接見ず、sunlight経由で補正）
            AssertAmbientTemperatureAt(weather: "storm", hour: 2, expectedEffective: 17, "暴風雨の深夜でもsunlightは0なのでやや涼しい");
            AssertAmbientTemperatureAt(weather: "heavy_rain", hour: 23, expectedEffective: 17, "大雨の夜もやや涼しい");

            // sunlightが中間(1-6)の時間帯は補正なし
            AssertAmbientTemperatureAt(weather: "cloudy", hour: 6, expectedEffective: 20, "曇りの朝(sunlight=2+2=4)は補正なし");
            AssertAmbientTemperatureAt(weather: "heavy_rain", hour: 12, expectedEffective: 20, "大雨の昼(sunlight=5+0=5)も補正なし");

            // sunlightが7以上ならやや暑い
            AssertAmbientTemperatureAt(weather: "clear", hour: 12, expectedEffective: 23, "晴れた昼(sunlight=5+5=10)はやや暑い");
            AssertAmbientTemperatureAt(weather: "clear", hour: 6, expectedEffective: 23, "晴れの朝(sunlight=2+5=7)もやや暑い");
            AssertAmbientTemperatureAt(weather: "cloudy", hour: 12, expectedEffective: 23, "曇りの昼(sunlight=5+2=7)もやや暑い");
            AssertAmbientTemperatureAt(weather: "sunny", hour: 12, expectedEffective: 23, "快晴の昼(sunlight=5+7=12)もbright帯のまま");
            AssertAmbientTemperatureAt(weather: "scorching", hour: 12, expectedEffective: 23, "最上級の晴れの昼(sunlight=5+10=15)もbright帯のまま");
        }

        [Test]
        public void World_WeatherAndHour_ModifySunlight()
        {
            ObjectDef world = codex.Objects.Get(codex.ObjectNames.GetId("world"));
            int hourId = codex.PropertyNames.GetId("hour");
            int weatherId = codex.PropertyNames.GetId("weather");
            int sunlightId = codex.PropertyNames.GetId("sunlight");

            var worldInstance = new WorldObject(1, world);

            void AssertSunlightAt(string weather, int hour, int expectedEffective, string because)
            {
                worldInstance.SetProperty(weatherId, codex.SymbolNames.Intern(weather));
                worldInstance.SetProperty(hourId, hour);
                Assert.That(worldInstance.GetEffectiveValue(sunlightId), Is.EqualTo(expectedEffective), because);
            }

            // 夜: hour側の最低限の寄与が0であり、weather側の追加ボーナスもconditionsで無効化されるため、
            // weatherによらず常に0（晴れていても夜であれば日差しは強くない、という設計意図）
            AssertSunlightAt(weather: "scorching", hour: 2, expectedEffective: 0, "最上級の晴れの深夜でも0");
            AssertSunlightAt(weather: "heavy_rain", hour: 23, expectedEffective: 0, "大雨の夜は0");

            // 昼(10-17時): hour側の最低限の寄与(5)に、weather側の追加ボーナスが加算される
            AssertSunlightAt(weather: "storm", hour: 12, expectedEffective: 5, "暴風雨の昼はweatherの追加ボーナスがなくhour(5)の最低限の寄与のみ");
            AssertSunlightAt(weather: "heavy_rain", hour: 12, expectedEffective: 5, "大雨の昼も同様");
            AssertSunlightAt(weather: "light_rain", hour: 12, expectedEffective: 6, "小雨の昼はhour(5)+weather(1)");
            AssertSunlightAt(weather: "cloudy", hour: 12, expectedEffective: 7, "曇りの昼はhour(5)+weather(2)");
            AssertSunlightAt(weather: "clear", hour: 12, expectedEffective: 10, "晴れた昼はhour(5)+weather(5)");
            AssertSunlightAt(weather: "sunny", hour: 12, expectedEffective: 12, "快晴の昼はhour(5)+weather(7)");
            AssertSunlightAt(weather: "scorching", hour: 12, expectedEffective: 15, "最上級の晴れの昼はhour(5)+weather(10)で最大");

            // 朝(6-9時)・夕方(18-21時): hour側の最低限の寄与(2)は昼より弱いが、weather側のボーナスは昼と同じ
            AssertSunlightAt(weather: "clear", hour: 7, expectedEffective: 7, "晴れの朝はhour(2)+weather(5)");
            AssertSunlightAt(weather: "clear", hour: 20, expectedEffective: 7, "晴れの夕方は朝と同じ強さ");
            AssertSunlightAt(weather: "storm", hour: 8, expectedEffective: 2,
                "暴風雨の朝でもhour側の最低限の寄与(2)は残る（雨でも昼は夜より明るいはず、という設計意図）");
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
            var testCodex = Load(yaml);

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
            return def.GetPropertyDef(codex.PropertyNames.GetId(propertyName));
        }

        private SlotDef SlotOf(ObjectDef def, string slotName)
        {
            int local = def.SlotLayout.ToLocal(codex.SlotNames.GetId(slotName));
            return def.SlotDefs[local];
        }
    }
}
