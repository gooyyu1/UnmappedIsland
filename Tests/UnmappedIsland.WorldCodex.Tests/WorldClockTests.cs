using NUnit.Framework;
using UnmappedIsland.Codex;
using UnmappedIsland.GameTime;
using UnmappedIsland.Runtime;

namespace UnmappedIsland.Codex.Tests
{
    /// <summary>
    /// WorldClock（core.yamlのtick=15分という時間モデルに対する、ゲーム側の時間進行ロジック）に対する
    /// 自動テスト。YAMLパーサは対象外で、ObjectDefBlueprintを直接組み立てて検証する
    /// （ContributionTests.csと同じ方針）。
    /// </summary>
    [TestFixture]
    public class WorldClockTests
    {
        private static WorldCodex BuildWorldCodex()
        {
            var world = new ObjectDefBlueprint { Name = "world", IsSingleton = true };
            world.Properties.Add(new PropertyBlueprint { Name = "tick", DefaultValue = PropertyValue.FromNumber(0) });
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

            return WorldCodexBuilder.Build(new[] { world });
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
            var codex = BuildWorldCodex();
            var session = new WorldSession(codex);
            var world = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("world")));

            int tickId = codex.PropertyNames.GetId("tick");
            int minuteId = codex.PropertyNames.GetId("minute");
            int minuteOfTickId = codex.PropertyNames.GetId("minute_of_tick");

            WorldClock.Advance(codex, world, session, 5);

            Assert.That(world.GetNumber(minuteId), Is.EqualTo(5));
            Assert.That(world.GetNumber(minuteOfTickId), Is.EqualTo(5));
            Assert.That(world.GetNumber(tickId), Is.EqualTo(0), "15分未満はまだtickを跨がない");
        }

        [Test]
        public void Advance_CrossingTickBoundary_FiresExactlyOneTickAndWrapsMinuteOfTick()
        {
            // ユーザー提示の具体例: minute_of_tickが5の状態で20分進めると、Tickが1回実行され、
            // minute_of_tickは10になる。
            var codex = BuildWorldCodex();
            var session = new WorldSession(codex);
            var world = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("world")));

            int tickId = codex.PropertyNames.GetId("tick");
            int minuteId = codex.PropertyNames.GetId("minute");
            int minuteOfTickId = codex.PropertyNames.GetId("minute_of_tick");

            WorldClock.Advance(codex, world, session, 5);
            WorldClock.Advance(codex, world, session, 20);

            Assert.That(world.GetNumber(minuteOfTickId), Is.EqualTo(10));
            Assert.That(world.GetNumber(tickId), Is.EqualTo(1), "5+20=25分 -> 15分境界を1回だけ跨ぐ");
            Assert.That(world.GetNumber(minuteId), Is.EqualTo(25), "minuteはtickの回数によらずamountの合計をそのまま反映する");
        }

        [Test]
        public void Advance_LargeAmount_FiresMultipleTicksAndCascadesToHourAndDay()
        {
            var codex = BuildWorldCodex();
            var session = new WorldSession(codex);
            var world = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("world")));

            int tickId = codex.PropertyNames.GetId("tick");
            int minuteId = codex.PropertyNames.GetId("minute");
            int minuteOfTickId = codex.PropertyNames.GetId("minute_of_tick");
            int hourId = codex.PropertyNames.GetId("hour");
            int dayId = codex.PropertyNames.GetId("day");

            WorldClock.Advance(codex, world, session, 60 * 25); // 25時間分を1回で進める

            Assert.That(world.GetNumber(minuteId), Is.EqualTo(0));
            Assert.That(world.GetNumber(hourId), Is.EqualTo(1));
            Assert.That(world.GetNumber(dayId), Is.EqualTo(2));
            Assert.That(world.GetNumber(minuteOfTickId), Is.EqualTo(0));
            Assert.That(world.GetNumber(tickId), Is.EqualTo(60 * 25 / WorldClock.MinutesPerTick));
        }
    }
}
