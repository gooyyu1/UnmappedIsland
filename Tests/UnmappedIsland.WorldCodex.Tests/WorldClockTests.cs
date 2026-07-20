using NUnit.Framework;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Loader;
using UnmappedIsland.Domain.Runtime;
using UnmappedIsland.Domain.Runtime.Views;

namespace UnmappedIsland.Domain.Defs.Tests
{
    /// <summary>
    /// WorldSession.AdvanceWorldTime（core.yamlのtick=15分という時間モデルに対する、ゲーム側の時間進行ロジック）に対する
    /// 自動テスト。core.yamlのworld object_defと同じ形のYAMLフィクスチャをWorldCodexYamlLoader経由で
    /// パースして検証する（YamlLoaderTests.csと同じ方針）。プロパティ名の解決はRuntime.Views.Worldに
    /// 委ね、WorldSession自体は文字列のプロパティ名を一切知らない（テスト側の確認もWorld越しに行う）。
    ///
    /// minuteはtick駆動のaccumulateを持たない（YAML側の自動加算とWorldSessionの加算が二重にならないように
    /// するため）。minuteへの加算はすべてWorldSessionが、常にminutes_per_tick以下の小さな量ずつ行う。
    /// </summary>
    [TestFixture]
    public class WorldTimeAdvanceTests
    {
        private static WorldCodex Load(string yaml) => new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();

        private static (WorldCodex Codex, World World) BuildWorld(int minutesPerTick = 15)
        {
            string yaml = $@"
object_defs:
  world:
    singleton: true
    props:
      tick:
        value: 0
        passives:
          - accumulate:
              self:
                tick: 1
      minutes_per_tick:
        value: {minutesPerTick}
      minute:
        value: 0
        range: {{min: 0, max: 59}}
        on_overflow:
          add:
            self:
              minute: -60
              hour: 1
      hour:
        value: 0
        range: {{min: 0, max: 23}}
        on_overflow:
          add:
            self:
              hour: -24
              day: 1
      day:
        value: 1
";
            var codex = Load(yaml);
            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("world")));
            return (codex, new World(instance, codex.PropertyNames));
        }

        [Test]
        public void Advance_WithinSameTick_OnlyAddsAmountWithoutFiringTick()
        {
            var (codex, world) = BuildWorld();
            var session = new WorldSession(codex, world);
            int tickId = codex.PropertyNames.GetId("tick");

            session.AdvanceWorldTime(5);

            Assert.That(world.Minute, Is.EqualTo(5), "15分未満はTickを跨がず、そのまま加算される");
            Assert.That(world.Instance.GetNumber(tickId), Is.EqualTo(0));
        }

        [Test]
        public void Advance_CrossingTickBoundary_FiresExactlyOneTickAndEndsAtCorrectMinute()
        {
            // ユーザー提示の具体例: tick内経過分(minute % minutes_per_tick)が5の状態で20分進めると、
            // Tickが1回実行され、tick内経過分は10になる。
            var (codex, world) = BuildWorld();
            var session = new WorldSession(codex, world);
            int tickId = codex.PropertyNames.GetId("tick");

            session.AdvanceWorldTime(5);
            session.AdvanceWorldTime(20);

            Assert.That(world.Instance.GetNumber(tickId), Is.EqualTo(1), "5+20=25分 -> 15分境界を1回だけ跨ぐ");
            Assert.That(world.Minute, Is.EqualTo(25), "minuteはtickの回数によらずamountの合計をそのまま反映する");
            Assert.That(world.Minute % world.MinutesPerTick, Is.EqualTo(10), "tick内経過分は10になる");
        }

        [Test]
        public void Advance_AccumulatesAcrossCallsEvenWhenEachAmountIsSmallerThanOneTick()
        {
            // 1回あたりの呼び出しがminutes_per_tick未満でも、複数回の呼び出しの累積で境界を跨いだことを
            // 正しく検知できる（tick内経過分をminuteから毎回読み直しているため）。
            var (codex, world) = BuildWorld();
            var session = new WorldSession(codex, world);
            int tickId = codex.PropertyNames.GetId("tick");

            session.AdvanceWorldTime(10); // tick内経過分は10、まだ境界に届かない
            session.AdvanceWorldTime(10); // 10+10=20分 -> 15を1回跨ぐ

            Assert.That(world.Instance.GetNumber(tickId), Is.EqualTo(1));
            Assert.That(world.Minute, Is.EqualTo(20));
            Assert.That(world.Minute % world.MinutesPerTick, Is.EqualTo(5));
        }

        [Test]
        public void Advance_LargeAmount_FiresMultipleTicksAndCascadesToHourAndDay()
        {
            var (codex, world) = BuildWorld();
            var session = new WorldSession(codex, world);
            int tickId = codex.PropertyNames.GetId("tick");
            int dayId = codex.PropertyNames.GetId("day");

            int minutesPerTick = world.MinutesPerTick;

            session.AdvanceWorldTime(60 * 25); // 25時間分を1回で進める

            Assert.That(world.Minute, Is.EqualTo(0));
            Assert.That(world.Hour, Is.EqualTo(1));
            Assert.That(world.Instance.GetNumber(dayId), Is.EqualTo(2));
            Assert.That(world.Instance.GetNumber(tickId), Is.EqualTo(60 * 25 / minutesPerTick));
        }

        [Test]
        public void Advance_UsesConfiguredMinutesPerTick_NotAHardcodedConstant()
        {
            // 1tickの長さはworld.minutes_per_tick（core.yaml側）が持つ値であり、WorldSession側に
            // ハードコードされていないことを、15以外の値でも確認する。
            var (codex, world) = BuildWorld(minutesPerTick: 20);
            var session = new WorldSession(codex, world);
            int tickId = codex.PropertyNames.GetId("tick");

            session.AdvanceWorldTime(25);

            Assert.That(world.Instance.GetNumber(tickId), Is.EqualTo(1), "minutes_per_tickが20なら25分で1tick跨ぐ");
            Assert.That(world.Minute % world.MinutesPerTick, Is.EqualTo(5));
        }
    }
}
