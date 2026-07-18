using System.Linq;
using NUnit.Framework;
using UnmappedIsland.Codex;
using UnmappedIsland.Loader;
using UnmappedIsland.Runtime;

namespace UnmappedIsland.Codex.Tests
{
    /// <summary>
    /// modify/accumulate（GameElementDefinition.md 8節）の実行時集計（WorldObject.GetEffectiveValue/
    /// Tick、WorldObject.MoveToSlot での登録）と、on_min/on_max（6節、値がRange境界に達している間
    /// 毎回実行されるactive内容）に対する自動テスト。YAML文字列をWorldCodexYamlLoader経由でパースして
    /// 検証する（YamlLoaderTests.csと同じ方針）。
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

        private static WorldCodexYamlLoader.SourceGroup Group(string label, params (string FileLabel, string Text)[] files)
        {
            return new WorldCodexYamlLoader.SourceGroup(
                label, files.Select(f => new WorldCodexYamlLoader.SourceFile(f.FileLabel, f.Text)).ToList());
        }

        private static WorldCodex Load(string yaml) =>
            WorldCodexYamlLoader.LoadFromGroups(new[] { Group("core", ("core.yaml", yaml)) });

        private WorldObject Spawn(WorldCodex codex, string objectName)
        {
            ObjectDef def = codex.Objects.Get(codex.ObjectNames.GetId(objectName));
            return new WorldObject(nextInstanceId++, def);
        }

        // ------------------------------------------------------------------
        // modify: 都度導出（GetEffectiveValue）。実体値そのものは書き換えない。
        // ------------------------------------------------------------------

        [Test]
        public void Modify_Self_Always_AppliesFromSpawn()
        {
            const string yaml = @"
object_defs:
  torch:
    props:
      brightness:
        value: 1
    passives:
      - modify:
          self:
            brightness: 2
";
            var codex = Load(yaml);
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
            const string yaml = @"
object_defs:
  torch:
    props:
      brightness:
        value: 1
    passives:
      - accumulate:
          self:
            brightness: 5
";
            var codex = Load(yaml);
            int brightnessId = codex.PropertyNames.GetId("brightness");
            var session = new WorldSession(codex);

            WorldObject first = Spawn(codex, "torch");
            WorldObject second = Spawn(codex, "torch");

            first.AddNumber(brightnessId, 10);
            first.Tick(session);

            Assert.That(first.GetNumber(brightnessId), Is.EqualTo(16), "1体目: 1(初期値) + 10(add) + 5(accumulate)");
            Assert.That(second.GetNumber(brightnessId), Is.EqualTo(1), "2体目は未タッチのまま初期値のはず");
        }

        [Test]
        public void Modify_Parent_WhenSlot_AppliesOnlyWhileInThatSlot()
        {
            const string yaml = @"
object_defs:
  character:
    props:
      defense:
        value: 10
    slots:
      equip: {}
      inventory: {}
  armor:
    passives:
      - conditions:
          - {slot: equip}
        modify:
          parent:
            defense: 5
";
            var codex = Load(yaml);
            int defenseId = codex.PropertyNames.GetId("defense");
            int equipSlotId = codex.SlotNames.GetId("equip");
            int inventorySlotId = codex.SlotNames.GetId("inventory");

            WorldObject characterInstance = Spawn(codex, "character");
            WorldObject armorInstance = Spawn(codex, "armor");

            Assert.That(characterInstance.GetEffectiveValue(defenseId), Is.EqualTo(10), "装備前はボーナスなし");

            Assert.That(armorInstance.MoveToSlot(characterInstance, equipSlotId, codex.WellKnown, out _), Is.True);
            Assert.That(characterInstance.GetEffectiveValue(defenseId), Is.EqualTo(15), "equipに入っている間はボーナスが乗る");

            Assert.That(armorInstance.MoveToSlot(characterInstance, inventorySlotId, codex.WellKnown, out _), Is.True);
            Assert.That(characterInstance.GetEffectiveValue(defenseId), Is.EqualTo(10), "同じ親のままequip以外へ移すとボーナスが外れる");
        }

        [Test]
        public void Modify_Parent_WhenSlot_ClearsWhenMovedToDifferentParent()
        {
            const string yaml = @"
object_defs:
  character:
    props:
      defense:
        value: 10
    slots:
      equip: {}
  chest:
    slots:
      storage: {}
  armor:
    passives:
      - conditions:
          - {slot: equip}
        modify:
          parent:
            defense: 5
";
            var codex = Load(yaml);
            int defenseId = codex.PropertyNames.GetId("defense");
            int equipSlotId = codex.SlotNames.GetId("equip");
            int storageSlotId = codex.SlotNames.GetId("storage");

            WorldObject characterInstance = Spawn(codex, "character");
            WorldObject chestInstance = Spawn(codex, "chest");
            WorldObject armorInstance = Spawn(codex, "armor");

            Assert.That(armorInstance.MoveToSlot(characterInstance, equipSlotId, codex.WellKnown, out _), Is.True);
            Assert.That(characterInstance.GetEffectiveValue(defenseId), Is.EqualTo(15));

            Assert.That(armorInstance.MoveToSlot(chestInstance, storageSlotId, codex.WellKnown, out _), Is.True);
            Assert.That(characterInstance.GetEffectiveValue(defenseId), Is.EqualTo(10), "別の親へ移動したら元の親からの登録は消える");
        }

        [Test]
        public void Modify_Child_WhenSlot_UsesChildAsSlotBearer()
        {
            const string yaml = @"
object_defs:
  preserving_container:
    slots:
      storage: {}
    passives:
      - conditions:
          - {slot: storage}
        modify:
          child:
            decay_rate: -1
  food:
    props:
      decay_rate:
        value: 3
";
            var codex = Load(yaml);
            int decayRateId = codex.PropertyNames.GetId("decay_rate");
            int storageSlotId = codex.SlotNames.GetId("storage");

            WorldObject containerInstance = Spawn(codex, "preserving_container");
            WorldObject foodInstance = Spawn(codex, "food");

            Assert.That(foodInstance.GetEffectiveValue(decayRateId), Is.EqualTo(3), "格納前は影響なし");

            Assert.That(foodInstance.MoveToSlot(containerInstance, storageSlotId, codex.WellKnown, out _), Is.True);
            Assert.That(foodInstance.GetEffectiveValue(decayRateId), Is.EqualTo(2), "storageに入っている間は腐敗速度が下がる");
        }

        [Test]
        public void Modify_Self_WhenOwnStage_TracksStageWithoutReregistration()
        {
            const string yaml = @"
object_defs:
  battery:
    props:
      charge:
        value: 100
        stages:
          - name: full
            min: 50
            passives:
              - modify:
                  self:
                    output: 10
          - name: low
      output:
        value: 5
";
            var codex = Load(yaml);
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
            const string yaml = @"
object_defs:
  character:
    props:
      defense:
        value: 10
    slots:
      equip: {}
  helmet:
    passives:
      - conditions:
          - {slot: equip}
        modify:
          parent:
            defense: 3
  armor:
    passives:
      - conditions:
          - {slot: equip}
        modify:
          parent:
            defense: 5
";
            var codex = Load(yaml);
            int defenseId = codex.PropertyNames.GetId("defense");
            int equipSlotId = codex.SlotNames.GetId("equip");

            WorldObject characterInstance = Spawn(codex, "character");
            WorldObject helmetInstance = Spawn(codex, "helmet");
            WorldObject armorInstance = Spawn(codex, "armor");

            Assert.That(helmetInstance.MoveToSlot(characterInstance, equipSlotId, codex.WellKnown, out _), Is.True);
            Assert.That(armorInstance.MoveToSlot(characterInstance, equipSlotId, codex.WellKnown, out _), Is.True);

            Assert.That(characterInstance.GetEffectiveValue(defenseId), Is.EqualTo(18));
        }

        [Test]
        public void Modify_EffectiveValue_IsClampedToRange()
        {
            const string yaml = @"
object_defs:
  character:
    props:
      defense:
        value: 95
        range: {min: 0, max: 100}
    slots:
      equip: {}
  armor:
    passives:
      - conditions:
          - {slot: equip}
        modify:
          parent:
            defense: 20
";
            var codex = Load(yaml);
            int defenseId = codex.PropertyNames.GetId("defense");
            int equipSlotId = codex.SlotNames.GetId("equip");

            WorldObject characterInstance = Spawn(codex, "character");
            WorldObject armorInstance = Spawn(codex, "armor");

            Assert.That(armorInstance.MoveToSlot(characterInstance, equipSlotId, codex.WellKnown, out _), Is.True);

            Assert.That(characterInstance.GetEffectiveValue(defenseId), Is.EqualTo(100));
        }

        [Test]
        public void Modify_GetEffectiveValue_OnMissingProperty_ReturnsZero()
        {
            const string yaml = @"
object_defs:
  rock:
    props:
      weight:
        value: 5
  other_with_size:
    props:
      size:
        value: 1
";
            var codex = Load(yaml);
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
            const string yaml = @"
object_defs:
  candle:
    props:
      wax:
        value: 100
    passives:
      - accumulate:
          self:
            wax: -1
";
            var codex = Load(yaml);
            int waxId = codex.PropertyNames.GetId("wax");
            var session = new WorldSession(codex);

            WorldObject instance = Spawn(codex, "candle");

            Assert.That(instance.GetEffectiveValue(waxId), Is.EqualTo(100), "Tick前は変化しない");

            instance.Tick(session);
            Assert.That(instance.GetEffectiveValue(waxId), Is.EqualTo(99), "Tick1回で実体値が減る");

            instance.Tick(session);
            Assert.That(instance.GetEffectiveValue(waxId), Is.EqualTo(98), "Tick毎に加算され続ける");
        }

        [Test]
        public void Accumulate_Parent_WhenSlot_OnlyWhileAttached()
        {
            const string yaml = @"
object_defs:
  character:
    props:
      hydration:
        value: 100
    slots:
      conditions: {}
  trash:
    slots:
      storage: {}
  bleeding:
    passives:
      - conditions:
          - {slot: conditions}
        accumulate:
          parent:
            hydration: -5
";
            var codex = Load(yaml);
            int hydrationId = codex.PropertyNames.GetId("hydration");
            int conditionsSlotId = codex.SlotNames.GetId("conditions");
            int storageSlotId = codex.SlotNames.GetId("storage");

            var session = new WorldSession(codex);
            WorldObject characterInstance = Spawn(codex, "character");
            WorldObject trashInstance = Spawn(codex, "trash");
            WorldObject bleedingInstance = Spawn(codex, "bleeding");

            characterInstance.Tick(session);
            Assert.That(characterInstance.GetEffectiveValue(hydrationId), Is.EqualTo(100), "装着前はTickしても変化なし");

            Assert.That(bleedingInstance.MoveToSlot(characterInstance, conditionsSlotId, codex.WellKnown, out _), Is.True);
            characterInstance.Tick(session);
            Assert.That(characterInstance.GetEffectiveValue(hydrationId), Is.EqualTo(95), "conditionsに入っている間はTick毎に減る");

            Assert.That(bleedingInstance.MoveToSlot(trashInstance, storageSlotId, codex.WellKnown, out _), Is.True);
            characterInstance.Tick(session);
            Assert.That(characterInstance.GetEffectiveValue(hydrationId), Is.EqualTo(95), "取り除いた後はTickしても変化しない");
        }

        [Test]
        public void Accumulate_Parent_WhenOwnStage_TracksDeclarersStage()
        {
            const string yaml = @"
object_defs:
  character:
    props:
      temperature:
        value: 36
    slots:
      conditions: {}
  infection:
    props:
      progress:
        value: 0
        stages:
          - name: none
            min: 0
          - name: mild
            min: 20
            passives:
              - accumulate:
                  parent:
                    temperature: 1
";
            var codex = Load(yaml);
            int temperatureId = codex.PropertyNames.GetId("temperature");
            int progressId = codex.PropertyNames.GetId("progress");
            int conditionsSlotId = codex.SlotNames.GetId("conditions");

            var session = new WorldSession(codex);
            WorldObject characterInstance = Spawn(codex, "character");
            WorldObject infectionInstance = Spawn(codex, "infection");

            Assert.That(infectionInstance.MoveToSlot(characterInstance, conditionsSlotId, codex.WellKnown, out _), Is.True);

            characterInstance.Tick(session);
            Assert.That(characterInstance.GetEffectiveValue(temperatureId), Is.EqualTo(36), "progressがnoneの間は上がらない");

            infectionInstance.SetProperty(progressId, PropertyValue.FromNumber(30));
            characterInstance.Tick(session);
            Assert.That(characterInstance.GetEffectiveValue(temperatureId), Is.EqualTo(37), "mildへ遷移した後は毎Tick上がる（再登録なし）");
        }

        [Test]
        public void Modify_And_Accumulate_DoNotLeakBetweenEvaluationPaths()
        {
            const string yaml = @"
object_defs:
  character:
    props:
      stamina:
        value: 50
    slots:
      equip: {}
  boots:
    passives:
      - conditions:
          - {slot: equip}
        modify:
          parent:
            stamina: 10
  exhaustion:
    passives:
      - conditions:
          - {slot: equip}
        accumulate:
          parent:
            stamina: -1
";
            var codex = Load(yaml);
            int staminaId = codex.PropertyNames.GetId("stamina");
            int equipSlotId = codex.SlotNames.GetId("equip");

            var session = new WorldSession(codex);
            WorldObject characterInstance = Spawn(codex, "character");
            WorldObject bootsInstance = Spawn(codex, "boots");
            WorldObject exhaustionInstance = Spawn(codex, "exhaustion");

            Assert.That(bootsInstance.MoveToSlot(characterInstance, equipSlotId, codex.WellKnown, out _), Is.True);
            Assert.That(exhaustionInstance.MoveToSlot(characterInstance, equipSlotId, codex.WellKnown, out _), Is.True);

            Assert.That(characterInstance.GetEffectiveValue(staminaId), Is.EqualTo(60), "modifyだけが都度加味される（実体値は50のまま）");

            characterInstance.Tick(session);
            Assert.That(characterInstance.GetEffectiveValue(staminaId), Is.EqualTo(59), "Tickでaccumulateだけが実体値へ入る(50-1+10=59)");
        }

        [Test]
        public void GetIncomingContributions_ListsAllRegardlessOfKind()
        {
            const string yaml = @"
object_defs:
  character:
    props:
      stamina:
        value: 50
    slots:
      equip: {}
  boots:
    passives:
      - conditions:
          - {slot: equip}
        modify:
          parent:
            stamina: 10
  exhaustion:
    passives:
      - conditions:
          - {slot: equip}
        accumulate:
          parent:
            stamina: -1
";
            var codex = Load(yaml);
            int staminaId = codex.PropertyNames.GetId("stamina");
            int equipSlotId = codex.SlotNames.GetId("equip");

            WorldObject characterInstance = Spawn(codex, "character");
            WorldObject bootsInstance = Spawn(codex, "boots");
            WorldObject exhaustionInstance = Spawn(codex, "exhaustion");

            Assert.That(bootsInstance.MoveToSlot(characterInstance, equipSlotId, codex.WellKnown, out _), Is.True);
            Assert.That(exhaustionInstance.MoveToSlot(characterInstance, equipSlotId, codex.WellKnown, out _), Is.True);

            var incoming = characterInstance.GetIncomingContributions(staminaId);

            Assert.That(incoming.Count, Is.EqualTo(2));
            Assert.That(incoming.Any(c => c.Def.Kind == ContributionKind.Modify), Is.True);
            Assert.That(incoming.Any(c => c.Def.Kind == ContributionKind.Accumulate), Is.True);
        }

        // ------------------------------------------------------------------
        // on_min / destroy / spawn: 「プロパティが0以下である間、毎回実行されるactive内容」を、
        // 値が変わった直後にプロパティ自身がTickの中で判定・実行する（PropertyValue.CheckOverflowAndZero
        // 参照。以前はTickとは別のPostTickパスだったが、現在はTickに統合されている）。すべてのオブジェクトは
        // 必ずworldの下にぶら下がるため、別途「世界に存在するすべてのオブジェクト」一覧は持たず、
        // destroyは親スロットからの切り離し、spawnは生成+move_to_slotとして表現する。
        // ------------------------------------------------------------------

        [Test]
        public void OnMin_IsCarriedThroughToPropertyDef()
        {
            const string yaml = @"
object_defs:
  candle:
    props:
      wax:
        value: 100
        range: {min: 0, max: 2147483647}
        on_min:
          destroy: self
      wick_length:
        value: 5
";
            var codex = Load(yaml);
            ObjectDef def = codex.Objects.Get(codex.ObjectNames.GetId("candle"));

            int waxLocal = def.PropertyLayout.ToLocal(codex.PropertyNames.GetId("wax"));
            int wickLocal = def.PropertyLayout.ToLocal(codex.PropertyNames.GetId("wick_length"));

            Assert.That(def.PropertyDefs[waxLocal].OnMin, Is.Not.Null);
            Assert.That(def.PropertyDefs[waxLocal].OnMin.Destroy, Contains.Item(ReferenceRoot.Self));
            Assert.That(def.PropertyDefs[wickLocal].OnMin, Is.Null);
        }

        // ------------------------------------------------------------------
        // on_max: on_minの上限側の鏡像。値がRange.Max以上である間、毎tick実行されるactive内容。
        // ------------------------------------------------------------------

        [Test]
        public void OnMax_IsCarriedThroughToPropertyDef()
        {
            const string yaml = @"
object_defs:
  tank:
    props:
      pressure:
        value: 0
        range: {min: 0, max: 2147483647}
        on_max:
          destroy: self
      temperature:
        value: 20
";
            var codex = Load(yaml);
            ObjectDef def = codex.Objects.Get(codex.ObjectNames.GetId("tank"));

            int pressureLocal = def.PropertyLayout.ToLocal(codex.PropertyNames.GetId("pressure"));
            int tempLocal = def.PropertyLayout.ToLocal(codex.PropertyNames.GetId("temperature"));

            Assert.That(def.PropertyDefs[pressureLocal].OnMax, Is.Not.Null);
            Assert.That(def.PropertyDefs[pressureLocal].OnMax.Destroy, Contains.Item(ReferenceRoot.Self));
            Assert.That(def.PropertyDefs[tempLocal].OnMax, Is.Null);
        }

        [Test]
        public void Tick_DestroysSelfWhenOnMaxFires()
        {
            const string yaml = @"
object_defs:
  holder:
    slots:
      items: {}
  bomb:
    props:
      pressure:
        value: 100
        range: {min: 0, max: 100}
        on_max:
          destroy: self
";
            var codex = Load(yaml);
            int itemsSlotId = codex.SlotNames.GetId("items");

            var session = new WorldSession(codex);
            WorldObject containerInstance = Spawn(codex, "holder");
            WorldObject bombInstance = Spawn(codex, "bomb");
            Assert.That(bombInstance.MoveToSlot(containerInstance, itemsSlotId, session.Codex.WellKnown, out _), Is.True);

            containerInstance.Tick(session);

            Assert.That(bombInstance.Parent, Is.Null);
            containerInstance.TryGetSlot(itemsSlotId, out Slot slot);
            Assert.That(slot.Contents.Count, Is.EqualTo(0));
        }

        [Test]
        public void Tick_DoesNotFireOnMaxWhenValueBelowMax()
        {
            const string yaml = @"
object_defs:
  holder:
    slots:
      items: {}
  tank:
    props:
      pressure:
        value: 50
        range: {min: 0, max: 100}
        on_max:
          destroy: self
";
            var codex = Load(yaml);
            int itemsSlotId = codex.SlotNames.GetId("items");

            var session = new WorldSession(codex);
            WorldObject containerInstance = Spawn(codex, "holder");
            WorldObject tankInstance = Spawn(codex, "tank");
            Assert.That(tankInstance.MoveToSlot(containerInstance, itemsSlotId, session.Codex.WellKnown, out _), Is.True);

            containerInstance.Tick(session);

            Assert.That(tankInstance.Parent, Is.Not.Null, "on_maxは上限未満では発火しない");
        }

        [Test]
        public void Tick_RecursesIntoChildrenWithoutCallingChildTickDirectly()
        {
            const string yaml = @"
object_defs:
  backpack:
    slots:
      items: {}
  power_cell:
    props:
      charge:
        value: 10
    passives:
      - accumulate:
          self:
            charge: -1
";
            var codex = Load(yaml);
            int itemsSlotId = codex.SlotNames.GetId("items");
            int chargeId = codex.PropertyNames.GetId("charge");

            var session = new WorldSession(codex);
            WorldObject containerInstance = Spawn(codex, "backpack");
            WorldObject batteryInstance = Spawn(codex, "power_cell");
            Assert.That(batteryInstance.MoveToSlot(containerInstance, itemsSlotId, session.Codex.WellKnown, out _), Is.True);

            containerInstance.Tick(session);

            Assert.That(batteryInstance.GetEffectiveValue(chargeId), Is.EqualTo(9));
        }

        [Test]
        public void Tick_DestroysSelfWhenOnMinFires()
        {
            const string yaml = @"
object_defs:
  lantern_holder:
    slots:
      items: {}
  torch:
    props:
      durability:
        value: 0
        range: {min: 0, max: 2147483647}
        on_min:
          destroy: self
";
            var codex = Load(yaml);
            int itemsSlotId = codex.SlotNames.GetId("items");

            var session = new WorldSession(codex);
            WorldObject containerInstance = Spawn(codex, "lantern_holder");
            WorldObject torchInstance = Spawn(codex, "torch");
            Assert.That(torchInstance.MoveToSlot(containerInstance, itemsSlotId, session.Codex.WellKnown, out _), Is.True);

            containerInstance.Tick(session);

            Assert.That(torchInstance.Parent, Is.Null);
            containerInstance.TryGetSlot(itemsSlotId, out Slot slot);
            Assert.That(slot.Contents.Count, Is.EqualTo(0));
        }

        [Test]
        public void Tick_SpawnsIntoOwnSlotWhenIntoIsSelf()
        {
            const string yaml = @"
object_defs:
  bush:
    slots:
      ground: {}
    props:
      ripeness:
        value: 0
        range: {min: 0, max: 2147483647}
        on_min:
          spawn:
            object: berry
            into: self
  berry: {}
";
            var codex = Load(yaml);
            int groundSlotId = codex.SlotNames.GetId("ground");

            var session = new WorldSession(codex);
            WorldObject bushInstance = Spawn(codex, "bush");

            bushInstance.Tick(session);

            bushInstance.TryGetSlot(groundSlotId, out Slot slot);
            Assert.That(slot.Contents.Count, Is.EqualTo(1));
            Assert.That(slot.Contents[0].Def.Name, Is.EqualTo("berry"), "into: selfなので、自分自身が持つスロットへ入る");
        }

        [Test]
        public void Tick_SpawnsIntoSameSlotAsSelfForCraftingOrDecay()
        {
            const string yaml = @"
object_defs:
  clearing2:
    slots:
      ground: {}
  wet_log:
    props:
      freshness:
        value: 0
        range: {min: 0, max: 2147483647}
        on_min:
          destroy: self
          spawn:
            object: rotten_log
  rotten_log: {}
";
            var codex = Load(yaml);
            int groundSlotId = codex.SlotNames.GetId("ground");

            var session = new WorldSession(codex);
            WorldObject locationInstance = Spawn(codex, "clearing2");
            WorldObject wetLogInstance = Spawn(codex, "wet_log");
            Assert.That(wetLogInstance.MoveToSlot(locationInstance, groundSlotId, session.Codex.WellKnown, out _), Is.True);

            locationInstance.Tick(session);

            Assert.That(wetLogInstance.Parent, Is.Null, "wet_log自身は破棄される");
            locationInstance.TryGetSlot(groundSlotId, out Slot slot);
            Assert.That(slot.Contents.Count, Is.EqualTo(1));
            Assert.That(slot.Contents[0].Def.Name, Is.EqualTo("rotten_log"), "自分がいたのと同じslotにrotten_logが入る");
        }

        [Test]
        public void Tick_SpawnEscalatesToParentWhenPrimaryCapacityIsExceeded()
        {
            // fallbackはYAML側で選べず、常に起点自身の親へ強制的に伝播する。ここでは起点(Self=geode)が
            // 持つ唯一のスロットがcapacity超過で拒否するため、geodeの親(box)の先頭スロットへ
            // accepts/capacityを無視して伝播することを確認する。
            const string yaml = @"
object_defs:
  small_box:
    slots:
      shelf: {}
  boulder:
    props:
      size:
        value: 10
  geode:
    slots:
      cavity:
        capacity: 5
    props:
      ripeness:
        value: 0
        range: {min: 0, max: 2147483647}
        on_min:
          spawn:
            object: boulder
            into: self
";
            var codex = Load(yaml);
            int shelfSlotId = codex.SlotNames.GetId("shelf");
            int cavitySlotId = codex.SlotNames.GetId("cavity");

            var session = new WorldSession(codex);
            WorldObject boxInstance = Spawn(codex, "small_box");
            WorldObject geodeInstance = Spawn(codex, "geode");
            Assert.That(geodeInstance.MoveToSlot(boxInstance, shelfSlotId, session.Codex.WellKnown, out _), Is.True);

            boxInstance.Tick(session);

            geodeInstance.TryGetSlot(cavitySlotId, out Slot cavitySlot);
            boxInstance.TryGetSlot(shelfSlotId, out Slot shelfSlot);

            Assert.That(cavitySlot.Contents.Count, Is.EqualTo(0), "boulderはgeode自身のcavityにcapacity超過で入らない");
            Assert.That(shelfSlot.Contents.Count, Is.EqualTo(2), "geode自身とboulderの両方がbox.shelfに並ぶ（親への強制伝播）");
            Assert.That(shelfSlot.Contents.Any(c => c.Def.Name == "boulder"), Is.True);
        }

        [Test]
        public void Tick_SpawnEscalatesToParentWhenPrimaryRejectsDueToAcceptsRestriction()
        {
            const string yaml = @"
object_defs:
  cave:
    slots:
      floor: {}
  pebble: {}
  gold_nugget: {}
  vein:
    slots:
      ore_pocket:
        accepts:
          - {object: gold_nugget, max: 10, consume: false}
    props:
      yield:
        value: 0
        range: {min: 0, max: 2147483647}
        on_min:
          spawn:
            object: pebble
            into: self
";
            var codex = Load(yaml);
            int floorSlotId = codex.SlotNames.GetId("floor");
            int orePocketSlotId = codex.SlotNames.GetId("ore_pocket");

            var session = new WorldSession(codex);
            WorldObject caveInstance = Spawn(codex, "cave");
            WorldObject veinInstance = Spawn(codex, "vein");
            Assert.That(veinInstance.MoveToSlot(caveInstance, floorSlotId, session.Codex.WellKnown, out _), Is.True);

            caveInstance.Tick(session);

            veinInstance.TryGetSlot(orePocketSlotId, out Slot orePocketSlot);
            caveInstance.TryGetSlot(floorSlotId, out Slot floorSlot);

            Assert.That(orePocketSlot.Contents.Count, Is.EqualTo(0), "pebbleはore_pocketのaccepts制約(gold_nuggetのみ)で入らない");
            Assert.That(floorSlot.Contents.Count, Is.EqualTo(2), "vein自身とpebbleの両方がcave.floorに並ぶ（親への強制伝播）");
            Assert.That(floorSlot.Contents.Any(c => c.Def.Name == "pebble"), Is.True);
        }

        [Test]
        public void Tick_SpawnDoesNothingWhenPrimaryFailsAndNoParentToEscalateTo()
        {
            const string yaml = @"
object_defs:
  pebble2:
    props:
      size:
        value: 10
  vein2:
    slots:
      contents:
        capacity: 1
    props:
      yield:
        value: 0
        range: {min: 0, max: 2147483647}
        on_min:
          spawn:
            object: pebble2
            into: self
";
            var codex = Load(yaml);
            int contentsSlotId = codex.SlotNames.GetId("contents");

            var session = new WorldSession(codex);
            WorldObject veinInstance = Spawn(codex, "vein2"); // 親を持たない(どこにも格納されていない)

            veinInstance.Tick(session);

            veinInstance.TryGetSlot(contentsSlotId, out Slot slot);
            Assert.That(slot.Contents.Count, Is.EqualTo(0),
                "pebble2はcapacity超過で入れず、vein2には親が無いため伝播先も無く、どこにも配置されない");
        }

        [Test]
        public void Tick_SpawnWithActorRootDoesNothingBecauseOnMinHasNoActor()
        {
            const string yaml = @"
object_defs:
  clearing3:
    slots:
      ground: {}
  berry: {}
  bush:
    props:
      ripeness:
        value: 0
        range: {min: 0, max: 2147483647}
        on_min:
          destroy: self
          spawn:
            object: berry
            into: actor
";
            var codex = Load(yaml);
            int groundSlotId = codex.SlotNames.GetId("ground");

            var session = new WorldSession(codex);
            WorldObject locationInstance = Spawn(codex, "clearing3");
            WorldObject bushInstance = Spawn(codex, "bush");
            Assert.That(bushInstance.MoveToSlot(locationInstance, groundSlotId, session.Codex.WellKnown, out _), Is.True);

            locationInstance.Tick(session);

            Assert.That(bushInstance.Parent, Is.Null, "bush自身は破棄される");
            locationInstance.TryGetSlot(groundSlotId, out Slot slot);
            Assert.That(slot.Contents.Count, Is.EqualTo(0), "actorルートはon_min文脈では解決できないため、berryはどこにも配置されない");
        }

        [Test]
        public void Tick_SurvivesMultipleChildrenDestroyingThemselvesInSamePass()
        {
            const string yaml = @"
object_defs:
  trashcan:
    slots:
      contents: {}
  junk:
    props:
      integrity:
        value: 0
        range: {min: 0, max: 2147483647}
        on_min:
          destroy: self
";
            var codex = Load(yaml);
            int contentsSlotId = codex.SlotNames.GetId("contents");

            var session = new WorldSession(codex);
            WorldObject containerInstance = Spawn(codex, "trashcan");
            WorldObject junk1 = Spawn(codex, "junk");
            WorldObject junk2 = Spawn(codex, "junk");
            WorldObject junk3 = Spawn(codex, "junk");

            Assert.That(junk1.MoveToSlot(containerInstance, contentsSlotId, session.Codex.WellKnown, out _), Is.True);
            Assert.That(junk2.MoveToSlot(containerInstance, contentsSlotId, session.Codex.WellKnown, out _), Is.True);
            Assert.That(junk3.MoveToSlot(containerInstance, contentsSlotId, session.Codex.WellKnown, out _), Is.True);

            containerInstance.Tick(session); // 例外を投げればテスト自体が失敗する

            containerInstance.TryGetSlot(contentsSlotId, out Slot slot);
            Assert.That(slot.Contents.Count, Is.EqualTo(0));
            Assert.That(junk1.Parent, Is.Null);
            Assert.That(junk2.Parent, Is.Null);
            Assert.That(junk3.Parent, Is.Null);
        }

        [Test]
        public void Destroy_IsIdempotent()
        {
            const string yaml = @"
object_defs:
  box:
    slots:
      contents: {}
  trinket: {}
";
            var codex = Load(yaml);
            int contentsSlotId = codex.SlotNames.GetId("contents");

            WorldObject boxInstance = Spawn(codex, "box");
            WorldObject itemInstance = Spawn(codex, "trinket");
            Assert.That(itemInstance.MoveToSlot(boxInstance, contentsSlotId, codex.WellKnown, out _), Is.True);

            itemInstance.Destroy(codex.WellKnown);
            Assert.That(itemInstance.Parent, Is.Null);

            itemInstance.Destroy(codex.WellKnown); // 例外を投げればテスト自体が失敗する
            Assert.That(itemInstance.Parent, Is.Null);
        }

        [Test]
        public void Tick_StillTicksChildrenOfAnObjectThatDestroysItselfInTheSamePass()
        {
            // innerBoxは自分自身のon_minによって、outerBox.Tick()の実行中に破棄される。それでも
            // innerBoxがまだ持っている子(battery)は、同じTickの中で問題なくaccumulateされることを確認する
            // （WorldObjectはTick内で自分や子がdestroyされる可能性に備える必要がある、という要件）。
            const string yaml = @"
object_defs:
  outer_box:
    slots:
      items: {}
  inner_box:
    slots:
      items: {}
    props:
      integrity:
        value: 0
        range: {min: 0, max: 2147483647}
        on_min:
          destroy: self
  cell:
    props:
      charge:
        value: 10
    passives:
      - accumulate:
          self:
            charge: -1
";
            var codex = Load(yaml);
            int itemsSlotId = codex.SlotNames.GetId("items");
            int chargeId = codex.PropertyNames.GetId("charge");

            var session = new WorldSession(codex);
            WorldObject outerInstance = Spawn(codex, "outer_box");
            WorldObject innerInstance = Spawn(codex, "inner_box");
            WorldObject batteryInstance = Spawn(codex, "cell");

            Assert.That(innerInstance.MoveToSlot(outerInstance, itemsSlotId, session.Codex.WellKnown, out _), Is.True);
            Assert.That(batteryInstance.MoveToSlot(innerInstance, itemsSlotId, session.Codex.WellKnown, out _), Is.True);

            outerInstance.Tick(session);

            Assert.That(innerInstance.Parent, Is.Null, "inner_boxは自分自身のon_minにより破棄される");
            Assert.That(batteryInstance.GetEffectiveValue(chargeId), Is.EqualTo(9),
                "親(inner_box)が同じTick内で破棄されても、子(battery)は問題なくTickされる");
        }
    }
}
