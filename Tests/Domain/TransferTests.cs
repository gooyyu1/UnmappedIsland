using NUnit.Framework;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Loader;
using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain
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
            return new WorldObject(nextInstanceId++, def, new WorldSession(codex));
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

            bool executed = canteen.TryExecuteAction("drink", actor, session);

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

            canteen.TryExecuteAction("drink", actor, session);

            Assert.That(canteen.GetNumber(waterId), Is.EqualTo(0), "容器に実際に入っていた分(500)しか出せない");
            Assert.That(actor.GetNumber(hydrationId), Is.EqualTo(500), "実際に出せた分(500)しか回復しない");
        }

        [Test]
        public void Transfer_Array_AppliesMultipleTransfersInOneAction()
        {
            const string yaml = @"
object_defs:
  player_multi:
    props:
      hydration:
        value: 0
        range: {min: 0, max: 28800}
      vitamin:
        value: 0
        range: {min: 0, max: 28800}
  canteen_multi:
    props:
      water_amount:
        value: 5000
        range: {min: 0, max: 5000}
      juice_amount:
        value: 3000
        range: {min: 0, max: 5000}
    actions:
      drink:
        transfer:
          - amount: 2000
            from_prop: water_amount
            to_object: actor
            to_prop: hydration
          - amount: 1000
            from_prop: juice_amount
            to_object: actor
            to_prop: vitamin
";
            var codex = Load(yaml);
            int waterId = codex.PropertyNames.GetId("water_amount");
            int juiceId = codex.PropertyNames.GetId("juice_amount");
            int hydrationId = codex.PropertyNames.GetId("hydration");
            int vitaminId = codex.PropertyNames.GetId("vitamin");

            var session = new WorldSession(codex);
            WorldObject actor = Spawn(codex, "player_multi");
            WorldObject canteen = Spawn(codex, "canteen_multi");

            bool executed = canteen.TryExecuteAction("drink", actor, session);

            Assert.That(executed, Is.True);
            Assert.That(canteen.GetNumber(waterId), Is.EqualTo(3000));
            Assert.That(canteen.GetNumber(juiceId), Is.EqualTo(2000));
            Assert.That(actor.GetNumber(hydrationId), Is.EqualTo(2000));
            Assert.That(actor.GetNumber(vitaminId), Is.EqualTo(1000));
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

            canteen.TryExecuteAction("drink", actor, session);

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

            canteen.TryExecuteAction("drink", actor, session);

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

            bool executed = cauldron.TryExecuteAction("pour_in", actor: null, session);

            Assert.That(executed, Is.True, "from_object/to_objectを省略してもself同士で成立する");
            Assert.That(cauldron.GetNumber(waterId), Is.EqualTo(2000));
            Assert.That(cauldron.GetNumber(brothId), Is.EqualTo(1000));
        }

        [Test]
        public void Transfer_LinkedAdd_ScalesToFullAmountWhenFullyTransferred()
        {
            const string yaml = @"
object_defs:
  player5:
    props:
      hydration:
        value: 0
        range: {min: 0, max: 28800}
      wakefulness:
        value: 0
        range: {min: 0, max: 28800}
  canteen5:
    props:
      tea_amount:
        value: 5000
        range: {min: 0, max: 5000}
    actions:
      drink:
        transfer:
          amount: 1200
          from_prop: tea_amount
          to_object: actor
          to_prop: hydration
          linked_add:
            actor:
              wakefulness: 200
";
            var codex = Load(yaml);
            int teaId = codex.PropertyNames.GetId("tea_amount");
            int hydrationId = codex.PropertyNames.GetId("hydration");
            int wakefulnessId = codex.PropertyNames.GetId("wakefulness");

            var session = new WorldSession(codex);
            WorldObject actor = Spawn(codex, "player5");
            WorldObject canteen = Spawn(codex, "canteen5");

            canteen.TryExecuteAction("drink", actor, session);

            Assert.That(actor.GetNumber(hydrationId), Is.EqualTo(1200), "amount(1200)分を全量移送する");
            Assert.That(actor.GetNumber(wakefulnessId), Is.EqualTo(200), "全量移送時はlinked_addも全量(200)適用される");
            Assert.That(canteen.GetNumber(teaId), Is.EqualTo(3800));
        }

        [Test]
        public void Transfer_LinkedAdd_ScalesProportionallyWhenPartiallyTransferred()
        {
            const string yaml = @"
object_defs:
  player6:
    props:
      hydration:
        value: 0
        range: {min: 0, max: 28800}
      wakefulness:
        value: 0
        range: {min: 0, max: 28800}
  canteen6:
    props:
      tea_amount:
        value: 600
        range: {min: 0, max: 5000}
    actions:
      drink:
        transfer:
          amount: 1200
          from_prop: tea_amount
          to_object: actor
          to_prop: hydration
          linked_add:
            actor:
              wakefulness: 200
";
            var codex = Load(yaml);
            int teaId = codex.PropertyNames.GetId("tea_amount");
            int hydrationId = codex.PropertyNames.GetId("hydration");
            int wakefulnessId = codex.PropertyNames.GetId("wakefulness");

            var session = new WorldSession(codex);
            WorldObject actor = Spawn(codex, "player6");
            WorldObject canteen = Spawn(codex, "canteen6");

            canteen.TryExecuteAction("drink", actor, session);

            Assert.That(actor.GetNumber(hydrationId), Is.EqualTo(600), "在庫(600)の分しか移送されない");
            Assert.That(actor.GetNumber(wakefulnessId), Is.EqualTo(100),
                "実際に移送された量(600)に比例してlinked_addもスケールされる(200 * 600 / 1200 = 100)");
            Assert.That(canteen.GetNumber(teaId), Is.EqualTo(0));
        }
    }
}
