using NUnit.Framework;
using UnmappedIsland.Codex;
using UnmappedIsland.Runtime;
using UnmappedIsland.Runtime.Views;

namespace UnmappedIsland.Codex.Tests
{
    /// <summary>
    /// World/PlayerCharacter/Location（Views）に対する自動テスト。ラップ対象の WorldObject が
    /// 実際に持つプロパティを、コンストラクタで解決したグローバルIDを通じて正しく読めることだけを確認する。
    /// </summary>
    [TestFixture]
    public class ViewsTests
    {
        private static PropertyBlueprint Prop(string name, int defaultValue)
        {
            return new PropertyBlueprint { Name = name, DefaultValue = PropertyValue.FromNumber(defaultValue) };
        }

        [Test]
        public void World_ExposesDayHourAndMinute()
        {
            var worldDef = new ObjectDefBlueprint { Name = "world", IsSingleton = true };
            worldDef.Properties.Add(Prop("day", 3));
            worldDef.Properties.Add(Prop("hour", 8));
            worldDef.Properties.Add(Prop("minute", 30));
            worldDef.Properties.Add(Prop("minute_of_tick", 0));
            worldDef.Properties.Add(Prop("minutes_per_tick", 15));

            var codex = WorldCodexBuilder.Build(new[] { worldDef });
            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("world")));

            var world = new World(instance, codex.PropertyNames);

            Assert.That(world.Day, Is.EqualTo(3));
            Assert.That(world.Hour, Is.EqualTo(8));
            Assert.That(world.Minute, Is.EqualTo(30));
            Assert.That(world.Instance, Is.SameAs(instance));
        }

        [Test]
        public void World_ReflectsModifyContributions_NotJustRawValue()
        {
            var worldDef = new ObjectDefBlueprint { Name = "world", IsSingleton = true };
            worldDef.Properties.Add(Prop("day", 3));
            worldDef.Properties.Add(Prop("hour", 8));
            worldDef.Properties.Add(Prop("minute", 30));
            worldDef.Properties.Add(Prop("minute_of_tick", 0));
            worldDef.Properties.Add(Prop("minutes_per_tick", 15));
            worldDef.Contributions.Add(new ContributionBlueprint
            {
                Target = ContributionTarget.Self,
                Kind = ContributionKind.Modify,
                TargetPropertyName = "minute",
                Amount = 10,
            });

            var codex = WorldCodexBuilder.Build(new[] { worldDef });
            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("world")));

            var world = new World(instance, codex.PropertyNames);

            Assert.That(world.Minute, Is.EqualTo(40));
        }

        [Test]
        public void PlayerCharacter_ExposesHpAndSatiety()
        {
            var characterDef = new ObjectDefBlueprint { Name = "character" };
            characterDef.Properties.Add(Prop("hp", 100));
            characterDef.Properties.Add(Prop("satiety", 50));

            var codex = WorldCodexBuilder.Build(new[] { characterDef });
            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("character")));

            var actor = new PlayerCharacter(instance, codex.PropertyNames);

            Assert.That(actor.Hp, Is.EqualTo(100));
            Assert.That(actor.Satiety, Is.EqualTo(50));
        }

        [Test]
        public void Location_WrapsInstanceWithoutRequiringAnyProperty()
        {
            var locationDef = new ObjectDefBlueprint { Name = "forest_clearing" };

            var codex = WorldCodexBuilder.Build(new[] { locationDef });
            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("forest_clearing")));

            var location = new Location(instance);

            Assert.That(location.Instance, Is.SameAs(instance));
        }
    }
}
