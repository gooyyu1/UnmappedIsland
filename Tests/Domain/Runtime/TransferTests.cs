using NUnit.Framework;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Loader;
using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain.Runtime
{
    /// <summary>
    /// transfer（GameElementDefinition.md 9.5節）の実行エンジン（WorldObject.ApplyActiveEffect）に対する
    /// 自動テスト。core.yamlと同じ形のYAMLフィクスチャをWorldCodexYamlLoader経由でパースして検証する
    /// （InteractionTests.csと同じ方針）。
    /// </summary>
    [TestFixture]
    public class TransferTests
    {
        private int nextInstanceId;

        [SetUp]
        public void SetUp()
        {
            nextInstanceId = 1;
        }

        private static WorldCodex Load(string yaml) => new WorldCodexYamlLoader().Load("core.yaml", yaml).Build();

        private WorldObject Spawn(WorldCodex codex, string objectName)
        {
            ObjectDef def = codex.Objects.Get(codex.ObjectNames.GetId(objectName));
            return new WorldObject(nextInstanceId++, def);
        }

        [Test]
        public void Transfer_MovesAmount_WhenSourceAndDestinationHaveEnoughRoom()
        {
            const string yaml = @"
object_defs:
  player:
    props:
      hydration:
        value: 0
        range: {min: 0, max: 28800}
  canteen:
    props:
      water_amount:
        value: 5000
        range: {min: 0, max: 5000}
    actions:
      drink:
        transfer:
          amount: 2000
          from_prop: water_amount
          to_object: actor
          to_prop: hydration
";
            var codex = Load(yaml);
            int waterId = codex.PropertyNames.GetId("water_amount");
            int hydrationId = codex.PropertyNames.GetId("hydration");

            var session = new WorldSession(codex);
            WorldObject actor = Spawn(codex, "player");
            WorldObject canteen = Spawn(codex, "canteen");

            bool executed = InteractionExecutor.TryExecuteAction(canteen, actor, "drink", session);

            Assert.That(executed, Is.True);
            Assert.That(canteen.GetNumber(waterId), Is.EqualTo(3000), "amount(2000)だけ減る");
            Assert.That(actor.GetNumber(hydrationId), Is.EqualTo(2000), "amount(2000)だけ増える");
        }

        [Test]
        public void Transfer_ClampsToSourceAvailable_WhenSourceHasLessThanAmount()
        {
            const string yaml = @"
object_defs:
  player2:
    props:
      hydration:
        value: 0
        range: {min: 0, max: 28800}
  canteen2:
    props:
      water_amount:
        value: 500
        range: {min: 0, max: 4800}
    actions:
      drink:
        transfer:
          amount: 2000
          from_prop: water_amount
          to_object: actor
          to_prop: hydration
";
            var codex = Load(yaml);
            int waterId = codex.PropertyNames.GetId("water_amount");
            int hydrationId = codex.PropertyNames.GetId("hydration");

            var session = new WorldSession(codex);
            WorldObject actor = Spawn(codex, "player2");
            WorldObject canteen = Spawn(codex, "canteen2");

            InteractionExecutor.TryExecuteAction(canteen, actor, "drink", session);

            Assert.That(canteen.GetNumber(waterId), Is.EqualTo(0), "容器に実際に入っていた分(500)しか出せない");
            Assert.That(actor.GetNumber(hydrationId), Is.EqualTo(500), "実際に出せた分(500)しか回復しない");
        }

        [Test]
        public void Transfer_AllowOverflowFalse_ClampsToDestinationRemainingCapacity_LeavingRestInSource()
        {
            const string yaml = @"
object_defs:
  player3:
    props:
      hydration:
        value: 28700
        range: {min: 0, max: 28800}
  canteen3:
    props:
      water_amount:
        value: 5000
        range: {min: 0, max: 5000}
    actions:
      drink:
        transfer:
          amount: 2000
          from_prop: water_amount
          to_object: actor
          to_prop: hydration
";
            var codex = Load(yaml);
            int waterId = codex.PropertyNames.GetId("water_amount");
            int hydrationId = codex.PropertyNames.GetId("hydration");

            var session = new WorldSession(codex);
            WorldObject actor = Spawn(codex, "player3");
            WorldObject canteen = Spawn(codex, "canteen3");

            InteractionExecutor.TryExecuteAction(canteen, actor, "drink", session);

            Assert.That(actor.GetNumber(hydrationId), Is.EqualTo(28800), "残容量(100)分しか回復しない");
            Assert.That(canteen.GetNumber(waterId), Is.EqualTo(4900), "収まらない分(1900)は容器に残る(水を無駄にしない)");
        }

        [Test]
        public void Transfer_AllowOverflowTrue_MovesFullAvailableRegardlessOfDestinationCapacity_WastingTheExcess()
        {
            const string yaml = @"
object_defs:
  player4:
    props:
      hydration:
        value: 28700
        range: {min: 0, max: 28800}
  canteen4:
    props:
      water_amount:
        value: 5000
        range: {min: 0, max: 5000}
    actions:
      drink:
        transfer:
          amount: 2000
          from_prop: water_amount
          to_object: actor
          to_prop: hydration
          allow_overflow: true
";
            var codex = Load(yaml);
            int waterId = codex.PropertyNames.GetId("water_amount");
            int hydrationId = codex.PropertyNames.GetId("hydration");

            var session = new WorldSession(codex);
            WorldObject actor = Spawn(codex, "player4");
            WorldObject canteen = Spawn(codex, "canteen4");

            InteractionExecutor.TryExecuteAction(canteen, actor, "drink", session);

            Assert.That(canteen.GetNumber(waterId), Is.EqualTo(3000), "toの残容量を見ずにamount(2000)そのまま出す");
            Assert.That(actor.GetNumber(hydrationId), Is.EqualTo(28800),
                "range超過分はtoのon_overflow既定動作(range.maxへクランプ)で失われる(あふれた分は無駄になる)");
        }

        [Test]
        public void Transfer_DefaultsFromObjectAndToObjectToSelf()
        {
            const string yaml = @"
object_defs:
  cauldron:
    props:
      water_amount:
        value: 3000
        range: {min: 0, max: 4800}
      broth_amount:
        value: 0
        range: {min: 0, max: 4800}
    actions:
      pour_in:
        transfer:
          amount: 1000
          from_prop: water_amount
          to_prop: broth_amount
";
            var codex = Load(yaml);
            int waterId = codex.PropertyNames.GetId("water_amount");
            int brothId = codex.PropertyNames.GetId("broth_amount");

            var session = new WorldSession(codex);
            WorldObject cauldron = Spawn(codex, "cauldron");

            bool executed = InteractionExecutor.TryExecuteAction(cauldron, actor: null, "pour_in", session);

            Assert.That(executed, Is.True, "from_object/to_objectを省略してもself同士で成立する");
            Assert.That(cauldron.GetNumber(waterId), Is.EqualTo(2000));
            Assert.That(cauldron.GetNumber(brothId), Is.EqualTo(1000));
        }
    }
}
