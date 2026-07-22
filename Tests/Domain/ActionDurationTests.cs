using NUnit.Framework;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Loader;
using UnmappedIsland.Domain.Runtime;
using UnmappedIsland.Domain.Runtime.Views;

namespace UnmappedIsland.Domain
{
    /// <summary>
    /// アクションのduration（実行にかかるゲーム内時間・分）に対する自動テスト。durationを持つアクションを
    /// 実行すると、効果の適用後にWorldSession.AdvanceWorldTimeで相当分だけ時間が進む（tick境界を跨げば
    /// passivesも動く）。時間進行まで含めてActionDef自身が行うため、呼び出し側（UI等）は実行後に別途
    /// 時間を進める必要がない。
    /// </summary>
    [TestFixture]
    public class ActionDurationTests
    {
        private const string WorldYaml = @"
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
        value: 15
      minute:
        value: 0
        range: {min: 0, max: 59}
        on_overflow:
          add:
            self:
              minute: -60
              hour: 1
      hour:
        value: 0
        range: {min: 0, max: 23}
        on_overflow:
          add:
            self:
              hour: -24
              day: 1
      day:
        value: 1
    slots:
      stuff: {}
";

        private static (WorldCodex Codex, WorldSession Session, World World) BuildWorldSession(string extraYaml)
        {
            var codex = new WorldCodexYamlLoader()
                .Load("world.yaml", WorldYaml)
                .Load("extra.yaml", extraYaml)
                .Build();
            var bootstrap = new WorldSession(codex);
            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("world")), bootstrap);
            var world = new World(instance, codex.PropertyNames);
            var session = new WorldSession(codex, world);
            return (codex, session, world);
        }

        [Test]
        public void LiteralDuration_AdvancesWorldTimeAfterEffect()
        {
            var (codex, session, world) = BuildWorldSession(@"
object_defs:
  campfire:
    props:
      warmth:
        value: 0
    actions:
      rest:
        duration: 30
        add:
          self:
            warmth: 1
");
            var campfire = session.Spawn(codex.ObjectNames.GetId("campfire"));
            campfire.MoveToSlot(world.Instance, codex.SlotNames.GetId("stuff"), codex.WellKnown, out _);

            bool executed = campfire.TryExecuteAction("rest", actor: null, session);

            Assert.That(executed, Is.True);
            Assert.That(campfire.GetNumber(codex.PropertyNames.GetId("warmth")), Is.EqualTo(1), "効果は適用される");
            Assert.That(world.Minute, Is.EqualTo(30), "duration分だけ時間が進む");
            Assert.That(world.Instance.GetNumber(codex.PropertyNames.GetId("tick")), Is.EqualTo(2), "15分tickを2回跨ぐ");
        }

        [Test]
        public void PropertyReferenceDuration_ReadsSelfProperty()
        {
            var (codex, session, world) = BuildWorldSession(@"
object_defs:
  trail:
    props:
      travel_minutes:
        value: 45
    actions:
      travel:
        duration: {prop: travel_minutes}
");
            var trail = session.Spawn(codex.ObjectNames.GetId("trail"));
            trail.MoveToSlot(world.Instance, codex.SlotNames.GetId("stuff"), codex.WellKnown, out _);

            Assert.That(trail.TryExecuteAction("travel", actor: null, session), Is.True);
            Assert.That(world.Minute, Is.EqualTo(45), "self.travel_minutesの値だけ時間が進む");
        }

        [Test]
        public void FailedConditions_DoNotConsumeTime()
        {
            var (codex, session, world) = BuildWorldSession(@"
object_defs:
  campfire:
    props:
      warmth:
        value: 0
    actions:
      rest:
        duration: 30
        conditions:
          - {prop: warmth, op: gt, value: 10}
");
            var campfire = session.Spawn(codex.ObjectNames.GetId("campfire"));
            campfire.MoveToSlot(world.Instance, codex.SlotNames.GetId("stuff"), codex.WellKnown, out _);

            Assert.That(campfire.TryExecuteAction("rest", actor: null, session), Is.False);
            Assert.That(world.Minute, Is.EqualTo(0), "条件不成立なら時間は進まない");
        }

        [Test]
        public void SessionWithoutWorld_SkipsTimeAdvance()
        {
            // Worldを持たないセッション（時間の概念が無いテスト文脈）でも、durationつきアクションは
            // 例外を出さずに効果だけを適用する。
            var codex = new WorldCodexYamlLoader().Load("extra.yaml", @"
object_defs:
  campfire:
    props:
      warmth:
        value: 0
    actions:
      rest:
        duration: 30
        add:
          self:
            warmth: 1
").Build();
            var session = new WorldSession(codex);
            var campfire = session.Spawn(codex.ObjectNames.GetId("campfire"));

            Assert.That(campfire.TryExecuteAction("rest", actor: null, session), Is.True);
            Assert.That(campfire.GetNumber(codex.PropertyNames.GetId("warmth")), Is.EqualTo(1));
        }
    }
}
