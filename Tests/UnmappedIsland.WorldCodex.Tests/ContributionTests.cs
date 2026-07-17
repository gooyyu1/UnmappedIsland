using System.Linq;
using NUnit.Framework;
using UnmappedIsland.Codex;
using UnmappedIsland.Runtime;

namespace UnmappedIsland.Codex.Tests
{
    /// <summary>
    /// modify/accumulate（GameElementDefinition.md 8節）の実行時集計（WorldObject.GetEffectiveValue/
    /// Tick、Containment.TryMoveToSlot での登録）に対する自動テスト。YAMLパーサは対象外で、
    /// ObjectDefBlueprint を直接組み立てて検証する。
    /// </summary>
    [TestFixture]
    public class ContributionTests
    {
        private int nextInstanceId;

        [SetUp]
        public void SetUp()
        {
            nextInstanceId = 1;
        }

        private WorldObject Spawn(WorldCodex codex, string objectName)
        {
            ObjectDef def = codex.Objects.Get(codex.ObjectNames.GetId(objectName));
            return new WorldObject(nextInstanceId++, def);
        }

        private static PropertyBlueprint Prop(string name, int defaultValue, PropertyRange? range = null, ActiveEffectBlueprint onZero = null)
        {
            return new PropertyBlueprint
            {
                Name = name,
                DefaultValue = PropertyValue.FromNumber(defaultValue),
                Range = range,
                OnZero = onZero,
            };
        }

        private static ActiveEffectBlueprint OnZeroDestroy() => new ActiveEffectBlueprint { Destroy = true };

        private static ActiveEffectBlueprint OnZeroSpawnAndDestroy(
            string spawnObjectName, SpawnTargetRoot into = SpawnTargetRoot.SameSlot)
        {
            return new ActiveEffectBlueprint
            {
                Destroy = true,
                Spawn = new SpawnBlueprint { ObjectName = spawnObjectName, Into = into },
            };
        }

        private static ActiveEffectBlueprint OnZeroSpawn(
            string spawnObjectName, SpawnTargetRoot into = SpawnTargetRoot.SameSlot)
        {
            return new ActiveEffectBlueprint
            {
                Spawn = new SpawnBlueprint { ObjectName = spawnObjectName, Into = into },
            };
        }

        private static SlotBlueprint Slot(string name) => new SlotBlueprint { Name = name };

        private static ContributionBlueprint Contribution(
            ContributionTarget target,
            ContributionKind kind,
            string targetProperty,
            int amount,
            ContributionGateKind gateKind = ContributionGateKind.Always,
            string gateSlotName = null,
            string gateStageProperty = null,
            string gateStageName = null)
        {
            return new ContributionBlueprint
            {
                Target = target,
                Kind = kind,
                TargetPropertyName = targetProperty,
                Amount = amount,
                GateKind = gateKind,
                GateSlotName = gateSlotName,
                GateStagePropertyName = gateStageProperty,
                GateStageName = gateStageName,
            };
        }

        // ------------------------------------------------------------------
        // modify: 都度導出（GetEffectiveValue）。実体値そのものは書き換えない。
        // ------------------------------------------------------------------

        [Test]
        public void Modify_Self_Always_AppliesFromSpawn()
        {
            var torch = new ObjectDefBlueprint { Name = "torch" };
            torch.Properties.Add(Prop("brightness", 1));
            torch.Contributions.Add(Contribution(ContributionTarget.Self, ContributionKind.Modify, "brightness", 2));

            var codex = WorldCodexBuilder.Build(new[] { torch });
            int brightnessId = codex.PropertyNames.GetId("brightness");

            WorldObject instance = Spawn(codex, "torch");

            Assert.That(instance.GetEffectiveValue(brightnessId), Is.EqualTo(3));
        }

        [Test]
        public void Spawn_MultipleInstancesOfSameObjectDef_HaveIndependentPropertyState()
        {
            // PropertyDef.DefaultValueは全WorldObjectで共有される1つのテンプレートであり、
            // WorldObjectのコンストラクタがClone()し忘れると、片方への加算・効果登録がもう片方にも
            // 漏れてしまう。同じ"torch"から2体spawnし、互いに影響しないことを確認する。
            var torch = new ObjectDefBlueprint { Name = "torch" };
            torch.Properties.Add(Prop("brightness", 1));
            torch.Contributions.Add(Contribution(ContributionTarget.Self, ContributionKind.Accumulate, "brightness", 5));

            var codex = WorldCodexBuilder.Build(new[] { torch });
            int brightnessId = codex.PropertyNames.GetId("brightness");

            WorldObject first = Spawn(codex, "torch");
            WorldObject second = Spawn(codex, "torch");

            first.AddNumber(brightnessId, 10);
            first.Tick();

            Assert.That(first.GetNumber(brightnessId), Is.EqualTo(16), "1体目: 1(初期値) + 10(add) + 5(accumulate)");
            Assert.That(second.GetNumber(brightnessId), Is.EqualTo(1), "2体目は未タッチのまま初期値のはず");
        }

        [Test]
        public void Modify_Parent_WhenSlot_AppliesOnlyWhileInThatSlot()
        {
            var character = new ObjectDefBlueprint { Name = "character" };
            character.Properties.Add(Prop("defense", 10));
            character.Slots.Add(Slot("equip"));
            character.Slots.Add(Slot("inventory"));

            var armor = new ObjectDefBlueprint { Name = "armor" };
            armor.Contributions.Add(Contribution(
                ContributionTarget.Parent, ContributionKind.Modify, "defense", 5,
                ContributionGateKind.WhenSlot, gateSlotName: "equip"));

            var codex = WorldCodexBuilder.Build(new[] { character, armor });
            int defenseId = codex.PropertyNames.GetId("defense");
            int equipSlotId = codex.SlotNames.GetId("equip");
            int inventorySlotId = codex.SlotNames.GetId("inventory");

            Containment containment = codex.CreateContainment();
            WorldObject characterInstance = Spawn(codex, "character");
            WorldObject armorInstance = Spawn(codex, "armor");

            Assert.That(characterInstance.GetEffectiveValue(defenseId), Is.EqualTo(10), "装備前はボーナスなし");

            Assert.That(containment.TryMoveToSlot(armorInstance, characterInstance, equipSlotId, out _), Is.True);
            Assert.That(characterInstance.GetEffectiveValue(defenseId), Is.EqualTo(15), "equipに入っている間はボーナスが乗る");

            Assert.That(containment.TryMoveToSlot(armorInstance, characterInstance, inventorySlotId, out _), Is.True);
            Assert.That(characterInstance.GetEffectiveValue(defenseId), Is.EqualTo(10), "同じ親のままequip以外へ移すとボーナスが外れる");
        }

        [Test]
        public void Modify_Parent_WhenSlot_ClearsWhenMovedToDifferentParent()
        {
            var character = new ObjectDefBlueprint { Name = "character" };
            character.Properties.Add(Prop("defense", 10));
            character.Slots.Add(Slot("equip"));

            var chest = new ObjectDefBlueprint { Name = "chest" };
            chest.Slots.Add(Slot("storage"));

            var armor = new ObjectDefBlueprint { Name = "armor" };
            armor.Contributions.Add(Contribution(
                ContributionTarget.Parent, ContributionKind.Modify, "defense", 5,
                ContributionGateKind.WhenSlot, gateSlotName: "equip"));

            var codex = WorldCodexBuilder.Build(new[] { character, chest, armor });
            int defenseId = codex.PropertyNames.GetId("defense");
            int equipSlotId = codex.SlotNames.GetId("equip");
            int storageSlotId = codex.SlotNames.GetId("storage");

            Containment containment = codex.CreateContainment();
            WorldObject characterInstance = Spawn(codex, "character");
            WorldObject chestInstance = Spawn(codex, "chest");
            WorldObject armorInstance = Spawn(codex, "armor");

            Assert.That(containment.TryMoveToSlot(armorInstance, characterInstance, equipSlotId, out _), Is.True);
            Assert.That(characterInstance.GetEffectiveValue(defenseId), Is.EqualTo(15));

            Assert.That(containment.TryMoveToSlot(armorInstance, chestInstance, storageSlotId, out _), Is.True);
            Assert.That(characterInstance.GetEffectiveValue(defenseId), Is.EqualTo(10), "別の親へ移動したら元の親からの登録は消える");
        }

        [Test]
        public void Modify_Child_WhenSlot_UsesChildAsSlotBearer()
        {
            var container = new ObjectDefBlueprint { Name = "preserving_container" };
            container.Slots.Add(Slot("storage"));
            container.Contributions.Add(Contribution(
                ContributionTarget.Child, ContributionKind.Modify, "decay_rate", -1,
                ContributionGateKind.WhenSlot, gateSlotName: "storage"));

            var food = new ObjectDefBlueprint { Name = "food" };
            food.Properties.Add(Prop("decay_rate", 3));

            var codex = WorldCodexBuilder.Build(new[] { container, food });
            int decayRateId = codex.PropertyNames.GetId("decay_rate");
            int storageSlotId = codex.SlotNames.GetId("storage");

            Containment containment = codex.CreateContainment();
            WorldObject containerInstance = Spawn(codex, "preserving_container");
            WorldObject foodInstance = Spawn(codex, "food");

            Assert.That(foodInstance.GetEffectiveValue(decayRateId), Is.EqualTo(3), "格納前は影響なし");

            Assert.That(containment.TryMoveToSlot(foodInstance, containerInstance, storageSlotId, out _), Is.True);
            Assert.That(foodInstance.GetEffectiveValue(decayRateId), Is.EqualTo(2), "storageに入っている間は腐敗速度が下がる");
        }

        [Test]
        public void Modify_Self_WhenOwnStage_TracksStageWithoutReregistration()
        {
            var battery = new ObjectDefBlueprint { Name = "battery" };
            PropertyBlueprint charge = Prop("charge", 100);
            charge.Stages.Add(new StageBlueprint { Name = "full", Min = 50 });
            charge.Stages.Add(new StageBlueprint { Name = "low", Min = null });
            battery.Properties.Add(charge);
            battery.Properties.Add(Prop("output", 5));
            battery.Contributions.Add(Contribution(
                ContributionTarget.Self, ContributionKind.Modify, "output", 10,
                ContributionGateKind.WhenOwnStage, gateStageProperty: "charge", gateStageName: "full"));

            var codex = WorldCodexBuilder.Build(new[] { battery });
            int chargeId = codex.PropertyNames.GetId("charge");
            int outputId = codex.PropertyNames.GetId("output");

            WorldObject instance = Spawn(codex, "battery");

            Assert.That(instance.GetEffectiveValue(outputId), Is.EqualTo(15), "chargeが満タンなのでfullステージのボーナスが乗る");

            instance.SetProperty(chargeId, PropertyValue.FromNumber(10));

            Assert.That(instance.GetEffectiveValue(outputId), Is.EqualTo(5), "chargeがlowステージへ落ちたのでボーナスが消える（再登録なし）");
        }

        [Test]
        public void Modify_MultipleContributions_Sum()
        {
            var character = new ObjectDefBlueprint { Name = "character" };
            character.Properties.Add(Prop("defense", 10));
            character.Slots.Add(Slot("equip"));

            var helmet = new ObjectDefBlueprint { Name = "helmet" };
            helmet.Contributions.Add(Contribution(
                ContributionTarget.Parent, ContributionKind.Modify, "defense", 3,
                ContributionGateKind.WhenSlot, gateSlotName: "equip"));

            var armor = new ObjectDefBlueprint { Name = "armor" };
            armor.Contributions.Add(Contribution(
                ContributionTarget.Parent, ContributionKind.Modify, "defense", 5,
                ContributionGateKind.WhenSlot, gateSlotName: "equip"));

            var codex = WorldCodexBuilder.Build(new[] { character, helmet, armor });
            int defenseId = codex.PropertyNames.GetId("defense");
            int equipSlotId = codex.SlotNames.GetId("equip");

            Containment containment = codex.CreateContainment();
            WorldObject characterInstance = Spawn(codex, "character");
            WorldObject helmetInstance = Spawn(codex, "helmet");
            WorldObject armorInstance = Spawn(codex, "armor");

            Assert.That(containment.TryMoveToSlot(helmetInstance, characterInstance, equipSlotId, out _), Is.True);
            Assert.That(containment.TryMoveToSlot(armorInstance, characterInstance, equipSlotId, out _), Is.True);

            Assert.That(characterInstance.GetEffectiveValue(defenseId), Is.EqualTo(18));
        }

        [Test]
        public void Modify_EffectiveValue_IsClampedToRange()
        {
            var character = new ObjectDefBlueprint { Name = "character" };
            character.Properties.Add(Prop("defense", 95, new PropertyRange(0, 100)));
            character.Slots.Add(Slot("equip"));

            var armor = new ObjectDefBlueprint { Name = "armor" };
            armor.Contributions.Add(Contribution(
                ContributionTarget.Parent, ContributionKind.Modify, "defense", 20,
                ContributionGateKind.WhenSlot, gateSlotName: "equip"));

            var codex = WorldCodexBuilder.Build(new[] { character, armor });
            int defenseId = codex.PropertyNames.GetId("defense");
            int equipSlotId = codex.SlotNames.GetId("equip");

            Containment containment = codex.CreateContainment();
            WorldObject characterInstance = Spawn(codex, "character");
            WorldObject armorInstance = Spawn(codex, "armor");

            Assert.That(containment.TryMoveToSlot(armorInstance, characterInstance, equipSlotId, out _), Is.True);

            Assert.That(characterInstance.GetEffectiveValue(defenseId), Is.EqualTo(100));
        }

        [Test]
        public void Modify_GetEffectiveValue_OnMissingProperty_ReturnsZero()
        {
            var rock = new ObjectDefBlueprint { Name = "rock" };
            rock.Properties.Add(Prop("weight", 5));

            var other = new ObjectDefBlueprint { Name = "other_with_size" };
            other.Properties.Add(Prop("size", 1));

            var codex = WorldCodexBuilder.Build(new[] { rock, other });
            int sizeId = codex.PropertyNames.GetId("size");

            WorldObject rockInstance = Spawn(codex, "rock");

            Assert.That(rockInstance.GetEffectiveValue(sizeId), Is.EqualTo(0));
        }

        // ------------------------------------------------------------------
        // accumulate: tick毎に実体値そのものへ加減算する（不可逆）。GetEffectiveValueには現れない。
        // ------------------------------------------------------------------

        [Test]
        public void Accumulate_Self_Always_AccumulatesOnTickOnly()
        {
            var candle = new ObjectDefBlueprint { Name = "candle" };
            candle.Properties.Add(Prop("wax", 100));
            candle.Contributions.Add(Contribution(ContributionTarget.Self, ContributionKind.Accumulate, "wax", -1));

            var codex = WorldCodexBuilder.Build(new[] { candle });
            int waxId = codex.PropertyNames.GetId("wax");

            WorldObject instance = Spawn(codex, "candle");

            Assert.That(instance.GetEffectiveValue(waxId), Is.EqualTo(100), "Tick前は変化しない");

            instance.Tick();
            Assert.That(instance.GetEffectiveValue(waxId), Is.EqualTo(99), "Tick1回で実体値が減る");

            instance.Tick();
            Assert.That(instance.GetEffectiveValue(waxId), Is.EqualTo(98), "Tick毎に加算され続ける");
        }

        [Test]
        public void Accumulate_Parent_WhenSlot_OnlyWhileAttached()
        {
            var character = new ObjectDefBlueprint { Name = "character" };
            character.Properties.Add(Prop("hydration", 100));
            character.Slots.Add(Slot("conditions"));

            var trash = new ObjectDefBlueprint { Name = "trash" };
            trash.Slots.Add(Slot("storage"));

            var bleeding = new ObjectDefBlueprint { Name = "bleeding" };
            bleeding.Contributions.Add(Contribution(
                ContributionTarget.Parent, ContributionKind.Accumulate, "hydration", -5,
                ContributionGateKind.WhenSlot, gateSlotName: "conditions"));

            var codex = WorldCodexBuilder.Build(new[] { character, trash, bleeding });
            int hydrationId = codex.PropertyNames.GetId("hydration");
            int conditionsSlotId = codex.SlotNames.GetId("conditions");
            int storageSlotId = codex.SlotNames.GetId("storage");

            Containment containment = codex.CreateContainment();
            WorldObject characterInstance = Spawn(codex, "character");
            WorldObject trashInstance = Spawn(codex, "trash");
            WorldObject bleedingInstance = Spawn(codex, "bleeding");

            characterInstance.Tick();
            Assert.That(characterInstance.GetEffectiveValue(hydrationId), Is.EqualTo(100), "装着前はTickしても変化なし");

            Assert.That(containment.TryMoveToSlot(bleedingInstance, characterInstance, conditionsSlotId, out _), Is.True);
            characterInstance.Tick();
            Assert.That(characterInstance.GetEffectiveValue(hydrationId), Is.EqualTo(95), "conditionsに入っている間はTick毎に減る");

            Assert.That(containment.TryMoveToSlot(bleedingInstance, trashInstance, storageSlotId, out _), Is.True);
            characterInstance.Tick();
            Assert.That(characterInstance.GetEffectiveValue(hydrationId), Is.EqualTo(95), "取り除いた後はTickしても変化しない");
        }

        [Test]
        public void Accumulate_Parent_WhenOwnStage_TracksDeclarersStage()
        {
            var character = new ObjectDefBlueprint { Name = "character" };
            character.Properties.Add(Prop("temperature", 36));
            character.Slots.Add(Slot("conditions"));

            var infection = new ObjectDefBlueprint { Name = "infection" };
            PropertyBlueprint progress = Prop("progress", 0);
            progress.Stages.Add(new StageBlueprint { Name = "none", Min = 0 });
            progress.Stages.Add(new StageBlueprint { Name = "mild", Min = 20 });
            infection.Properties.Add(progress);
            infection.Contributions.Add(Contribution(
                ContributionTarget.Parent, ContributionKind.Accumulate, "temperature", 1,
                ContributionGateKind.WhenOwnStage, gateStageProperty: "progress", gateStageName: "mild"));

            var codex = WorldCodexBuilder.Build(new[] { character, infection });
            int temperatureId = codex.PropertyNames.GetId("temperature");
            int progressId = codex.PropertyNames.GetId("progress");
            int conditionsSlotId = codex.SlotNames.GetId("conditions");

            Containment containment = codex.CreateContainment();
            WorldObject characterInstance = Spawn(codex, "character");
            WorldObject infectionInstance = Spawn(codex, "infection");

            Assert.That(containment.TryMoveToSlot(infectionInstance, characterInstance, conditionsSlotId, out _), Is.True);

            characterInstance.Tick();
            Assert.That(characterInstance.GetEffectiveValue(temperatureId), Is.EqualTo(36), "progressがnoneの間は上がらない");

            infectionInstance.SetProperty(progressId, PropertyValue.FromNumber(30));
            characterInstance.Tick();
            Assert.That(characterInstance.GetEffectiveValue(temperatureId), Is.EqualTo(37), "mildへ遷移した後は毎Tick上がる（再登録なし）");
        }

        [Test]
        public void Modify_And_Accumulate_DoNotLeakBetweenEvaluationPaths()
        {
            var character = new ObjectDefBlueprint { Name = "character" };
            character.Properties.Add(Prop("stamina", 50));
            character.Slots.Add(Slot("equip"));

            var boots = new ObjectDefBlueprint { Name = "boots" };
            boots.Contributions.Add(Contribution(
                ContributionTarget.Parent, ContributionKind.Modify, "stamina", 10,
                ContributionGateKind.WhenSlot, gateSlotName: "equip"));

            var exhaustion = new ObjectDefBlueprint { Name = "exhaustion" };
            exhaustion.Contributions.Add(Contribution(
                ContributionTarget.Parent, ContributionKind.Accumulate, "stamina", -1,
                ContributionGateKind.WhenSlot, gateSlotName: "equip"));

            var codex = WorldCodexBuilder.Build(new[] { character, boots, exhaustion });
            int staminaId = codex.PropertyNames.GetId("stamina");
            int equipSlotId = codex.SlotNames.GetId("equip");

            Containment containment = codex.CreateContainment();
            WorldObject characterInstance = Spawn(codex, "character");
            WorldObject bootsInstance = Spawn(codex, "boots");
            WorldObject exhaustionInstance = Spawn(codex, "exhaustion");

            Assert.That(containment.TryMoveToSlot(bootsInstance, characterInstance, equipSlotId, out _), Is.True);
            Assert.That(containment.TryMoveToSlot(exhaustionInstance, characterInstance, equipSlotId, out _), Is.True);

            Assert.That(characterInstance.GetEffectiveValue(staminaId), Is.EqualTo(60), "modifyだけが都度加味される（実体値は50のまま）");

            characterInstance.Tick();
            Assert.That(characterInstance.GetEffectiveValue(staminaId), Is.EqualTo(59), "Tickでaccumulateだけが実体値へ入る(50-1+10=59)");
        }

        [Test]
        public void GetIncomingContributions_ListsAllRegardlessOfKind()
        {
            var character = new ObjectDefBlueprint { Name = "character" };
            character.Properties.Add(Prop("stamina", 50));
            character.Slots.Add(Slot("equip"));

            var boots = new ObjectDefBlueprint { Name = "boots" };
            boots.Contributions.Add(Contribution(
                ContributionTarget.Parent, ContributionKind.Modify, "stamina", 10,
                ContributionGateKind.WhenSlot, gateSlotName: "equip"));

            var exhaustion = new ObjectDefBlueprint { Name = "exhaustion" };
            exhaustion.Contributions.Add(Contribution(
                ContributionTarget.Parent, ContributionKind.Accumulate, "stamina", -1,
                ContributionGateKind.WhenSlot, gateSlotName: "equip"));

            var codex = WorldCodexBuilder.Build(new[] { character, boots, exhaustion });
            int staminaId = codex.PropertyNames.GetId("stamina");
            int equipSlotId = codex.SlotNames.GetId("equip");

            Containment containment = codex.CreateContainment();
            WorldObject characterInstance = Spawn(codex, "character");
            WorldObject bootsInstance = Spawn(codex, "boots");
            WorldObject exhaustionInstance = Spawn(codex, "exhaustion");

            Assert.That(containment.TryMoveToSlot(bootsInstance, characterInstance, equipSlotId, out _), Is.True);
            Assert.That(containment.TryMoveToSlot(exhaustionInstance, characterInstance, equipSlotId, out _), Is.True);

            var incoming = characterInstance.GetIncomingContributions(staminaId);

            Assert.That(incoming.Count, Is.EqualTo(2));
            Assert.That(incoming.Any(c => c.Def.Kind == ContributionKind.Modify), Is.True);
            Assert.That(incoming.Any(c => c.Def.Kind == ContributionKind.Accumulate), Is.True);
        }

        // ------------------------------------------------------------------
        // on_zero / destroy / spawn: 「プロパティが0以下である間、毎回実行されるactive内容」を
        // PostTick（Tickとは別の、値によるイベント処理のパス）が実行する。すべてのオブジェクトは
        // 必ずworldの下にぶら下がるため、別途「世界に存在するすべてのオブジェクト」一覧は持たず、
        // destroyは親スロットからの切り離し、spawnは生成+move_to_slotとして表現する。
        // ------------------------------------------------------------------

        [Test]
        public void OnZero_IsCarriedThroughToPropertyDef()
        {
            var candle = new ObjectDefBlueprint { Name = "candle" };
            candle.Properties.Add(Prop("wax", 100, onZero: OnZeroDestroy()));
            candle.Properties.Add(Prop("wick_length", 5)); // onZero: null (既定)

            var codex = WorldCodexBuilder.Build(new[] { candle });
            ObjectDef def = codex.Objects.Get(codex.ObjectNames.GetId("candle"));

            int waxLocal = def.PropertyLayout.ToLocal(codex.PropertyNames.GetId("wax"));
            int wickLocal = def.PropertyLayout.ToLocal(codex.PropertyNames.GetId("wick_length"));

            Assert.That(def.PropertyDefs[waxLocal].OnZero, Is.Not.Null);
            Assert.That(def.PropertyDefs[waxLocal].OnZero.Destroy, Is.True);
            Assert.That(def.PropertyDefs[wickLocal].OnZero, Is.Null);
        }

        [Test]
        public void Tick_RecursesIntoChildrenWithoutCallingChildTickDirectly()
        {
            var container = new ObjectDefBlueprint { Name = "backpack" };
            container.Slots.Add(Slot("items"));

            var battery = new ObjectDefBlueprint { Name = "power_cell" };
            battery.Properties.Add(Prop("charge", 10));
            battery.Contributions.Add(Contribution(ContributionTarget.Self, ContributionKind.Accumulate, "charge", -1));

            var codex = WorldCodexBuilder.Build(new[] { container, battery });
            int itemsSlotId = codex.SlotNames.GetId("items");
            int chargeId = codex.PropertyNames.GetId("charge");

            var session = new WorldSession(codex);
            WorldObject containerInstance = Spawn(codex, "backpack");
            WorldObject batteryInstance = Spawn(codex, "power_cell");
            Assert.That(session.Containment.TryMoveToSlot(batteryInstance, containerInstance, itemsSlotId, out _), Is.True);

            containerInstance.Tick();

            Assert.That(batteryInstance.GetEffectiveValue(chargeId), Is.EqualTo(9));
        }

        [Test]
        public void PostTick_DestroysSelfWhenOnZeroFires()
        {
            var container = new ObjectDefBlueprint { Name = "lantern_holder" };
            container.Slots.Add(Slot("items"));

            var torch = new ObjectDefBlueprint { Name = "torch" };
            torch.Properties.Add(Prop("durability", 0, onZero: OnZeroDestroy()));

            var codex = WorldCodexBuilder.Build(new[] { container, torch });
            int itemsSlotId = codex.SlotNames.GetId("items");

            var session = new WorldSession(codex);
            WorldObject containerInstance = Spawn(codex, "lantern_holder");
            WorldObject torchInstance = Spawn(codex, "torch");
            Assert.That(session.Containment.TryMoveToSlot(torchInstance, containerInstance, itemsSlotId, out _), Is.True);

            containerInstance.PostTick(session);

            Assert.That(torchInstance.Parent, Is.Null);
            containerInstance.TryGetSlot(itemsSlotId, out Slot slot);
            Assert.That(slot.Contents.Count, Is.EqualTo(0));
        }

        [Test]
        public void PostTick_SpawnsIntoOwnSlotWhenIntoIsSelf()
        {
            var bush = new ObjectDefBlueprint { Name = "bush" };
            bush.Slots.Add(Slot("ground"));
            bush.Properties.Add(Prop("ripeness", 0,
                onZero: OnZeroSpawn("berry", into: SpawnTargetRoot.Self)));

            var berry = new ObjectDefBlueprint { Name = "berry" };

            var codex = WorldCodexBuilder.Build(new[] { bush, berry });
            int groundSlotId = codex.SlotNames.GetId("ground");

            var session = new WorldSession(codex);
            WorldObject bushInstance = Spawn(codex, "bush");

            bushInstance.PostTick(session);

            bushInstance.TryGetSlot(groundSlotId, out Slot slot);
            Assert.That(slot.Contents.Count, Is.EqualTo(1));
            Assert.That(slot.Contents[0].Def.Name, Is.EqualTo("berry"), "into: selfなので、自分自身が持つスロットへ入る");
        }

        [Test]
        public void PostTick_SpawnsIntoSameSlotAsSelfForCraftingOrDecay()
        {
            var location = new ObjectDefBlueprint { Name = "clearing2" };
            location.Slots.Add(Slot("ground"));

            var wetLog = new ObjectDefBlueprint { Name = "wet_log" };
            wetLog.Properties.Add(Prop("freshness", 0,
                onZero: OnZeroSpawnAndDestroy("rotten_log"))); // intoを省略（既定値SameSlot）

            var rottenLog = new ObjectDefBlueprint { Name = "rotten_log" };

            var codex = WorldCodexBuilder.Build(new[] { location, wetLog, rottenLog });
            int groundSlotId = codex.SlotNames.GetId("ground");

            var session = new WorldSession(codex);
            WorldObject locationInstance = Spawn(codex, "clearing2");
            WorldObject wetLogInstance = Spawn(codex, "wet_log");
            Assert.That(session.Containment.TryMoveToSlot(wetLogInstance, locationInstance, groundSlotId, out _), Is.True);

            locationInstance.PostTick(session);

            Assert.That(wetLogInstance.Parent, Is.Null, "wet_log自身は破棄される");
            locationInstance.TryGetSlot(groundSlotId, out Slot slot);
            Assert.That(slot.Contents.Count, Is.EqualTo(1));
            Assert.That(slot.Contents[0].Def.Name, Is.EqualTo("rotten_log"), "自分がいたのと同じslotにrotten_logが入る");
        }

        [Test]
        public void PostTick_SpawnEscalatesToParentWhenPrimaryCapacityIsExceeded()
        {
            // fallbackはYAML側で選べず、常に起点自身の親へ強制的に伝播する。ここでは起点(Self=geode)が
            // 持つ唯一のスロットがcapacity超過で拒否するため、geodeの親(box)の先頭スロットへ
            // accepts/capacityを無視して伝播することを確認する。
            var box = new ObjectDefBlueprint { Name = "small_box" };
            box.Slots.Add(Slot("shelf"));

            var boulder = new ObjectDefBlueprint { Name = "boulder" };
            boulder.Properties.Add(Prop("size", 10));

            var geode = new ObjectDefBlueprint { Name = "geode" };
            geode.Slots.Add(new SlotBlueprint { Name = "cavity", Capacity = 5 });
            geode.Properties.Add(Prop("ripeness", 0,
                onZero: OnZeroSpawn("boulder", into: SpawnTargetRoot.Self)));

            var codex = WorldCodexBuilder.Build(new[] { box, boulder, geode });
            int shelfSlotId = codex.SlotNames.GetId("shelf");
            int cavitySlotId = codex.SlotNames.GetId("cavity");

            var session = new WorldSession(codex);
            WorldObject boxInstance = Spawn(codex, "small_box");
            WorldObject geodeInstance = Spawn(codex, "geode");
            Assert.That(session.Containment.TryMoveToSlot(geodeInstance, boxInstance, shelfSlotId, out _), Is.True);

            boxInstance.PostTick(session);

            geodeInstance.TryGetSlot(cavitySlotId, out Slot cavitySlot);
            boxInstance.TryGetSlot(shelfSlotId, out Slot shelfSlot);

            Assert.That(cavitySlot.Contents.Count, Is.EqualTo(0), "boulderはgeode自身のcavityにcapacity超過で入らない");
            Assert.That(shelfSlot.Contents.Count, Is.EqualTo(2), "geode自身とboulderの両方がbox.shelfに並ぶ（親への強制伝播）");
            Assert.That(shelfSlot.Contents.Any(c => c.Def.Name == "boulder"), Is.True);
        }

        [Test]
        public void PostTick_SpawnEscalatesToParentWhenPrimaryRejectsDueToAcceptsRestriction()
        {
            var cave = new ObjectDefBlueprint { Name = "cave" };
            cave.Slots.Add(Slot("floor"));

            var pebble = new ObjectDefBlueprint { Name = "pebble" };
            var goldNugget = new ObjectDefBlueprint { Name = "gold_nugget" };

            var vein = new ObjectDefBlueprint { Name = "vein" };
            var orePocket = new SlotBlueprint { Name = "ore_pocket" };
            orePocket.Accepts.Add(new AcceptBlueprint { ObjectName = "gold_nugget", Max = 10, Consume = false });
            vein.Slots.Add(orePocket);
            vein.Properties.Add(Prop("yield", 0,
                onZero: OnZeroSpawn("pebble", into: SpawnTargetRoot.Self)));

            var codex = WorldCodexBuilder.Build(new[] { cave, pebble, goldNugget, vein });
            int floorSlotId = codex.SlotNames.GetId("floor");
            int orePocketSlotId = codex.SlotNames.GetId("ore_pocket");

            var session = new WorldSession(codex);
            WorldObject caveInstance = Spawn(codex, "cave");
            WorldObject veinInstance = Spawn(codex, "vein");
            Assert.That(session.Containment.TryMoveToSlot(veinInstance, caveInstance, floorSlotId, out _), Is.True);

            caveInstance.PostTick(session);

            veinInstance.TryGetSlot(orePocketSlotId, out Slot orePocketSlot);
            caveInstance.TryGetSlot(floorSlotId, out Slot floorSlot);

            Assert.That(orePocketSlot.Contents.Count, Is.EqualTo(0), "pebbleはore_pocketのaccepts制約(gold_nuggetのみ)で入らない");
            Assert.That(floorSlot.Contents.Count, Is.EqualTo(2), "vein自身とpebbleの両方がcave.floorに並ぶ（親への強制伝播）");
            Assert.That(floorSlot.Contents.Any(c => c.Def.Name == "pebble"), Is.True);
        }

        [Test]
        public void PostTick_SpawnDoesNothingWhenPrimaryFailsAndNoParentToEscalateTo()
        {
            var pebble = new ObjectDefBlueprint { Name = "pebble2" };
            pebble.Properties.Add(Prop("size", 10));

            var vein = new ObjectDefBlueprint { Name = "vein2" };
            vein.Slots.Add(new SlotBlueprint { Name = "contents", Capacity = 1 });
            vein.Properties.Add(Prop("yield", 0,
                onZero: OnZeroSpawn("pebble2", into: SpawnTargetRoot.Self)));

            var codex = WorldCodexBuilder.Build(new[] { pebble, vein });
            int contentsSlotId = codex.SlotNames.GetId("contents");

            var session = new WorldSession(codex);
            WorldObject veinInstance = Spawn(codex, "vein2"); // 親を持たない(どこにも格納されていない)

            veinInstance.PostTick(session);

            veinInstance.TryGetSlot(contentsSlotId, out Slot slot);
            Assert.That(slot.Contents.Count, Is.EqualTo(0),
                "pebble2はcapacity超過で入れず、vein2には親が無いため伝播先も無く、どこにも配置されない");
        }

        [Test]
        public void PostTick_SpawnWithActorRootDoesNothingBecauseOnZeroHasNoActor()
        {
            var location = new ObjectDefBlueprint { Name = "clearing3" };
            location.Slots.Add(Slot("ground"));

            var berry = new ObjectDefBlueprint { Name = "berry" };

            var bush = new ObjectDefBlueprint { Name = "bush" };
            bush.Properties.Add(Prop("ripeness", 0,
                onZero: OnZeroSpawnAndDestroy("berry", into: SpawnTargetRoot.Actor)));

            var codex = WorldCodexBuilder.Build(new[] { location, berry, bush });
            int groundSlotId = codex.SlotNames.GetId("ground");

            var session = new WorldSession(codex);
            WorldObject locationInstance = Spawn(codex, "clearing3");
            WorldObject bushInstance = Spawn(codex, "bush");
            Assert.That(session.Containment.TryMoveToSlot(bushInstance, locationInstance, groundSlotId, out _), Is.True);

            locationInstance.PostTick(session);

            Assert.That(bushInstance.Parent, Is.Null, "bush自身は破棄される");
            locationInstance.TryGetSlot(groundSlotId, out Slot slot);
            Assert.That(slot.Contents.Count, Is.EqualTo(0), "actorルートはon_zero文脈では解決できないため、berryはどこにも配置されない");
        }

        [Test]
        public void PostTick_SurvivesMultipleChildrenDestroyingThemselvesInSamePass()
        {
            var container = new ObjectDefBlueprint { Name = "trashcan" };
            container.Slots.Add(Slot("contents"));

            var junk = new ObjectDefBlueprint { Name = "junk" };
            junk.Properties.Add(Prop("integrity", 0, onZero: OnZeroDestroy()));

            var codex = WorldCodexBuilder.Build(new[] { container, junk });
            int contentsSlotId = codex.SlotNames.GetId("contents");

            var session = new WorldSession(codex);
            WorldObject containerInstance = Spawn(codex, "trashcan");
            WorldObject junk1 = Spawn(codex, "junk");
            WorldObject junk2 = Spawn(codex, "junk");
            WorldObject junk3 = Spawn(codex, "junk");

            Assert.That(session.Containment.TryMoveToSlot(junk1, containerInstance, contentsSlotId, out _), Is.True);
            Assert.That(session.Containment.TryMoveToSlot(junk2, containerInstance, contentsSlotId, out _), Is.True);
            Assert.That(session.Containment.TryMoveToSlot(junk3, containerInstance, contentsSlotId, out _), Is.True);

            containerInstance.PostTick(session); // 例外を投げればテスト自体が失敗する

            containerInstance.TryGetSlot(contentsSlotId, out Slot slot);
            Assert.That(slot.Contents.Count, Is.EqualTo(0));
            Assert.That(junk1.Parent, Is.Null);
            Assert.That(junk2.Parent, Is.Null);
            Assert.That(junk3.Parent, Is.Null);
        }

        [Test]
        public void Destroy_IsIdempotent()
        {
            var box = new ObjectDefBlueprint { Name = "box" };
            box.Slots.Add(Slot("contents"));

            var item = new ObjectDefBlueprint { Name = "trinket" };

            var codex = WorldCodexBuilder.Build(new[] { box, item });
            int contentsSlotId = codex.SlotNames.GetId("contents");

            Containment containment = codex.CreateContainment();
            WorldObject boxInstance = Spawn(codex, "box");
            WorldObject itemInstance = Spawn(codex, "trinket");
            Assert.That(containment.TryMoveToSlot(itemInstance, boxInstance, contentsSlotId, out _), Is.True);

            containment.Destroy(itemInstance);
            Assert.That(itemInstance.Parent, Is.Null);

            containment.Destroy(itemInstance); // 例外を投げればテスト自体が失敗する
            Assert.That(itemInstance.Parent, Is.Null);
        }
    }
}
