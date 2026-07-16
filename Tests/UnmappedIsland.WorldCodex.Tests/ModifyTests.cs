using NUnit.Framework;
using UnmappedIsland.Codex;
using UnmappedIsland.Codex.Defs;
using UnmappedIsland.Codex.Runtime;

namespace UnmappedIsland.Codex.Tests
{
    /// <summary>
    /// modify（GameElementDefinition.md 8.2〜8.3節）の実行時集計（WorldObject.GetEffectiveValue、
    /// Containment.TryMoveToSlot での登録）に対する自動テスト。YAMLパーサは対象外で、
    /// ObjectDefBlueprint を直接組み立てて検証する。
    /// </summary>
    [TestFixture]
    public class ModifyTests
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

        private static PropertyBlueprint Prop(string name, double defaultValue, PropertyRange? range = null)
        {
            return new PropertyBlueprint
            {
                Name = name,
                DefaultValue = PropertyValue.FromNumber(defaultValue),
                Range = range,
            };
        }

        private static SlotBlueprint Slot(string name) => new SlotBlueprint { Name = name };

        private static ModifyContributionBlueprint SelfAlways(string targetProperty, double amount)
        {
            return new ModifyContributionBlueprint
            {
                Target = ModifyTarget.Self,
                TargetPropertyName = targetProperty,
                Amount = amount,
                GateKind = ModifyGateKind.Always,
            };
        }

        private static ModifyContributionBlueprint ParentWhenSlot(string targetProperty, double amount, string slotName)
        {
            return new ModifyContributionBlueprint
            {
                Target = ModifyTarget.Parent,
                TargetPropertyName = targetProperty,
                Amount = amount,
                GateKind = ModifyGateKind.WhenSlot,
                GateSlotName = slotName,
            };
        }

        private static ModifyContributionBlueprint ChildWhenSlot(string targetProperty, double amount, string slotName)
        {
            return new ModifyContributionBlueprint
            {
                Target = ModifyTarget.Child,
                TargetPropertyName = targetProperty,
                Amount = amount,
                GateKind = ModifyGateKind.WhenSlot,
                GateSlotName = slotName,
            };
        }

        private static ModifyContributionBlueprint SelfWhenOwnStage(string targetProperty, double amount, string stageProperty, string stageName)
        {
            return new ModifyContributionBlueprint
            {
                Target = ModifyTarget.Self,
                TargetPropertyName = targetProperty,
                Amount = amount,
                GateKind = ModifyGateKind.WhenOwnStage,
                GateStagePropertyName = stageProperty,
                GateStageName = stageName,
            };
        }

        [Test]
        public void Self_Always_AppliesFromSpawn()
        {
            var torch = new ObjectDefBlueprint { Name = "torch" };
            torch.Properties.Add(Prop("brightness", 1));
            torch.ModifyContributions.Add(SelfAlways("brightness", 2));

            var codex = WorldCodexBuilder.Build(new[] { torch });
            int brightnessId = codex.PropertyNames.GetId("brightness");

            WorldObject instance = Spawn(codex, "torch");

            Assert.That(instance.GetEffectiveValue(brightnessId), Is.EqualTo(3));
        }

        [Test]
        public void Parent_WhenSlot_AppliesOnlyWhileInThatSlot()
        {
            var character = new ObjectDefBlueprint { Name = "character" };
            character.Properties.Add(Prop("defense", 10));
            character.Slots.Add(Slot("equip"));
            character.Slots.Add(Slot("inventory"));

            var armor = new ObjectDefBlueprint { Name = "armor" };
            armor.ModifyContributions.Add(ParentWhenSlot("defense", 5, "equip"));

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
        public void Parent_WhenSlot_ClearsWhenMovedToDifferentParent()
        {
            var character = new ObjectDefBlueprint { Name = "character" };
            character.Properties.Add(Prop("defense", 10));
            character.Slots.Add(Slot("equip"));

            var chest = new ObjectDefBlueprint { Name = "chest" };
            chest.Slots.Add(Slot("storage"));

            var armor = new ObjectDefBlueprint { Name = "armor" };
            armor.ModifyContributions.Add(ParentWhenSlot("defense", 5, "equip"));

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
        public void Child_WhenSlot_UsesChildAsSlotBearer()
        {
            var container = new ObjectDefBlueprint { Name = "preserving_container" };
            container.Slots.Add(Slot("storage"));
            container.ModifyContributions.Add(ChildWhenSlot("decay_rate", -1, "storage"));

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
        public void Self_WhenOwnStage_TracksStageWithoutReregistration()
        {
            var battery = new ObjectDefBlueprint { Name = "battery" };
            PropertyBlueprint charge = Prop("charge", 100);
            charge.Stages.Add(new StageBlueprint { Name = "full", Min = 50 });
            charge.Stages.Add(new StageBlueprint { Name = "low", Min = null });
            battery.Properties.Add(charge);
            battery.Properties.Add(Prop("output", 5));
            battery.ModifyContributions.Add(SelfWhenOwnStage("output", 10, "charge", "full"));

            var codex = WorldCodexBuilder.Build(new[] { battery });
            int chargeId = codex.PropertyNames.GetId("charge");
            int outputId = codex.PropertyNames.GetId("output");

            WorldObject instance = Spawn(codex, "battery");

            Assert.That(instance.GetEffectiveValue(outputId), Is.EqualTo(15), "chargeが満タンなのでfullステージのボーナスが乗る");

            instance.SetProperty(chargeId, PropertyValue.FromNumber(10));

            Assert.That(instance.GetEffectiveValue(outputId), Is.EqualTo(5), "chargeがlowステージへ落ちたのでボーナスが消える（再登録なし）");
        }

        [Test]
        public void MultipleContributions_Sum()
        {
            var character = new ObjectDefBlueprint { Name = "character" };
            character.Properties.Add(Prop("defense", 10));
            character.Slots.Add(Slot("equip"));

            var helmet = new ObjectDefBlueprint { Name = "helmet" };
            helmet.ModifyContributions.Add(ParentWhenSlot("defense", 3, "equip"));

            var armor = new ObjectDefBlueprint { Name = "armor" };
            armor.ModifyContributions.Add(ParentWhenSlot("defense", 5, "equip"));

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
        public void EffectiveValue_IsClampedToRange()
        {
            var character = new ObjectDefBlueprint { Name = "character" };
            character.Properties.Add(Prop("defense", 95, new PropertyRange(0, 100)));
            character.Slots.Add(Slot("equip"));

            var armor = new ObjectDefBlueprint { Name = "armor" };
            armor.ModifyContributions.Add(ParentWhenSlot("defense", 20, "equip"));

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
        public void GetEffectiveValue_OnMissingProperty_ReturnsZero()
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
    }
}
