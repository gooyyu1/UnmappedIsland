using NUnit.Framework;
using UnmappedIsland.Codex;
using UnmappedIsland.GameTime;
using UnmappedIsland.Runtime;
using UnmappedIsland.Runtime.Views;

namespace UnmappedIsland.Codex.Tests
{
    /// <summary>
    /// WorldClock（core.yamlのtick=15分という時間モデルに対する、ゲーム側の時間進行ロジック）に対する
    /// 自動テスト。YAMLパーサは対象外で、ObjectDefBlueprintを直接組み立てて検証する
    /// （ContributionTests.csと同じ方針）。プロパティ名の解決はRuntime.Views.Worldに委ね、WorldClock自体は
    /// 文字列のプロパティ名を一切知らない（テスト側の確認もWorld越しに行う）。
    /// </summary>
    [TestFixture]
    public class WorldClockTests
    {
        private static (WorldCodex Codex, World World) BuildWorld(int minutesPerTick = 15)
        {
            var world = new ObjectDefBlueprint { Name = "world", IsSingleton = true };
            world.Properties.Add(new PropertyBlueprint { Name = "tick", DefaultValue = PropertyValue.FromNumber(0) });
            world.Properties.Add(new PropertyBlueprint { Name = "minutes_per_tick", DefaultValue = PropertyValue.FromNumber(minutesPerTick) });
            world.Properties.Add(new PropertyBlueprint { Name = "minute_of_tick", DefaultValue = PropertyValue.FromNumber(0) });
            world.Properties.Add(new PropertyBlueprint
            {
                Name = "minute",
                DefaultValue = PropertyValue.FromNumber(0),
                Range = new PropertyRange(0, 59),
                OnOverflow = AddSelf(("minute", -60), ("hour", 1)),
            });
            world.Properties.Add(new PropertyBlueprint
            {
                Name = "hour",
                DefaultValue = PropertyValue.FromNumber(0),
                Range = new PropertyRange(0, 23),
                OnOverflow = AddSelf(("hour", -24), ("day", 1)),
            });
            world.Properties.Add(new PropertyBlueprint { Name = "day", DefaultValue = PropertyValue.FromNumber(1) });
            world.Contributions.Add(new ContributionBlueprint
            {
                Target = ContributionTarget.Self, Kind = ContributionKind.Accumulate, TargetPropertyName = "tick", Amount = 1,
            });

            var codex = WorldCodexBuilder.Build(new[] { world });
            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("world")));
            return (codex, new World(instance, codex.PropertyNames));
        }

        private static ActiveEffectBlueprint AddSelf(params (string Property, int Amount)[] adds)
        {
            var bp = new ActiveEffectBlueprint();
            var list = new System.Collections.Generic.List<AddBlueprint>();
            foreach (var (property, amount) in adds)
                list.Add(new AddBlueprint { PropertyName = property, Amount = amount });
            bp.Adds[ReferenceRoot.Self] = list;
            return bp;
        }

        [Test]
        public void Advance_WithinSameTick_OnlyUpdatesMinuteAndMinuteOfTick()
        {
            var (codex, world) = BuildWorld();
            var session = new WorldSession(codex);

            WorldClock.Advance(world, session, 5);

            Assert.That(world.Minute, Is.EqualTo(5));
            Assert.That(world.MinuteOfTick, Is.EqualTo(5));
            Assert.That(world.Instance.GetNumber(codex.PropertyNames.GetId("tick")), Is.EqualTo(0), "15分未満はまだtickを跨がない");
        }

        [Test]
        public void Advance_CrossingTickBoundary_FiresExactlyOneTickAndWrapsMinuteOfTick()
        {
            // ユーザー提示の具体例: minute_of_tickが5の状態で20分進めると、Tickが1回実行され、
            // minute_of_tickは10になる。
            var (codex, world) = BuildWorld();
            var session = new WorldSession(codex);
            int tickId = codex.PropertyNames.GetId("tick");

            WorldClock.Advance(world, session, 5);
            WorldClock.Advance(world, session, 20);

            Assert.That(world.MinuteOfTick, Is.EqualTo(10));
            Assert.That(world.Instance.GetNumber(tickId), Is.EqualTo(1), "5+20=25分 -> 15分境界を1回だけ跨ぐ");
            Assert.That(world.Minute, Is.EqualTo(25), "minuteはtickの回数によらずamountの合計をそのまま反映する");
        }

        [Test]
        public void Advance_LargeAmount_FiresMultipleTicksAndCascadesToHourAndDay()
        {
            var (codex, world) = BuildWorld();
            var session = new WorldSession(codex);
            int tickId = codex.PropertyNames.GetId("tick");
            int dayId = codex.PropertyNames.GetId("day");

            int minutesPerTick = world.MinutesPerTick;

            WorldClock.Advance(world, session, 60 * 25); // 25時間分を1回で進める

            Assert.That(world.Minute, Is.EqualTo(0));
            Assert.That(world.Hour, Is.EqualTo(1));
            Assert.That(world.Instance.GetNumber(dayId), Is.EqualTo(2));
            Assert.That(world.MinuteOfTick, Is.EqualTo(0));
            Assert.That(world.Instance.GetNumber(tickId), Is.EqualTo(60 * 25 / minutesPerTick));
        }

        [Test]
        public void Advance_UsesConfiguredMinutesPerTick_NotAHardcodedConstant()
        {
            // 1tickの長さはworld.minutes_per_tick（core.yaml側）が持つ値であり、WorldClock側に
            // ハードコードされていないことを、15以外の値でも確認する。
            var (codex, world) = BuildWorld(minutesPerTick: 20);
            var session = new WorldSession(codex);
            int tickId = codex.PropertyNames.GetId("tick");

            WorldClock.Advance(world, session, 25);

            Assert.That(world.Instance.GetNumber(tickId), Is.EqualTo(1), "minutes_per_tickが20なら25分で1tick跨ぐ");
            Assert.That(world.MinuteOfTick, Is.EqualTo(5));
        }
    }
}
