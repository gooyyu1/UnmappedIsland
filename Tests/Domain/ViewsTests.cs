using NUnit.Framework;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Loader;
using UnmappedIsland.Domain.Runtime;
using UnmappedIsland.Domain.Runtime.Views;

namespace UnmappedIsland.Domain
{
    /// <summary>
    /// World/PlayerCharacter/Location（Views）に対する自動テスト。ラップ対象の WorldObject が
    /// 実際に持つプロパティを、コンストラクタで解決したグローバルIDを通じて正しく読めることだけを確認する。
    /// </summary>
    [TestFixture]
    public class ViewsTests
    {
        private static WorldCodex Load(string yaml) => new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();

        [Test]
        public void World_ExposesDayHourAndMinute()
        {
            const string yaml = @"
object_defs:
  world:
    singleton: true
    props:
      day:
        value: 3
      hour:
        value: 8
      minute:
        value: 30
      minutes_per_tick:
        value: 15
";
            var codex = Load(yaml);
            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("world")));

            var world = new World(instance, codex.PropertyNames);

            Assert.That(world.Day, Is.EqualTo(3));
            Assert.That(world.Hour, Is.EqualTo(8));
            Assert.That(world.Minute, Is.EqualTo(30));
            Assert.That(world.Instance, Is.SameAs(instance));
        }

        [Test]
        public void World_ReflectsModifyPassives_NotJustRawValue()
        {
            const string yaml = @"
object_defs:
  world:
    singleton: true
    props:
      day:
        value: 3
      hour:
        value: 8
      minute:
        value: 30
      minutes_per_tick:
        value: 15
    passives:
      - modify:
          self:
            minute: 10
";
            var codex = Load(yaml);
            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("world")));

            var world = new World(instance, codex.PropertyNames);

            Assert.That(world.Minute, Is.EqualTo(40));
        }

        [Test]
        public void PlayerCharacter_ExposesHpAndSatiety()
        {
            const string yaml = @"
object_defs:
  character:
    props:
      hp:
        value: 100
      satiety:
        value: 50
";
            var codex = Load(yaml);
            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("character")));

            var actor = new PlayerCharacter(instance, codex.PropertyNames);

            Assert.That(actor.Hp, Is.EqualTo(100));
            Assert.That(actor.Satiety, Is.EqualTo(50));
        }

        [Test]
        public void Location_WrapsInstanceWithoutRequiringAnyProperty()
        {
            const string yaml = @"
object_defs:
  forest_clearing: {}
";
            var codex = Load(yaml);
            var instance = new WorldObject(1, codex.Objects.Get(codex.ObjectNames.GetId("forest_clearing")));

            var location = new Location(instance);

            Assert.That(location.Instance, Is.SameAs(instance));
        }
    }
}
