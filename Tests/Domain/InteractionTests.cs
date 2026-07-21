using System.Linq;
using NUnit.Framework;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Loader;
using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Domain
{
    /// <summary>
    /// actions/combinations（GameElementDefinition.md 11節・12節）の実行エンジン（InteractionExecutor）
    /// に対する自動テスト。core.yamlと同じ形のYAMLフィクスチャをWorldCodexYamlLoader経由でパースして
    /// 検証する（YamlLoaderTests.csと同じ方針）。
    /// </summary>
    [TestFixture]
    public class InteractionTests
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

        // ------------------------------------------------------------------
        // actions: conditions / active（self・actor）
        // ------------------------------------------------------------------

        [Test]
        public void TryExecuteAction_AppliesActiveToSelfAndActor_AndDestroysSelf()
        {
            const string yaml = @"
object_defs:
  player:
    props:
      satiety:
        value: 0
  apple:
    actions:
      eat:
        add:
          actor:
            satiety: 10
        destroy: self
";
            var codex = Load(yaml);
            int satietyId = codex.PropertyNames.GetId("satiety");

            var session = new WorldSession(codex);
            WorldObject actor = Spawn(codex, "player");
            WorldObject appleInstance = Spawn(codex, "apple");

            bool executed = InteractionExecutor.TryExecuteAction(appleInstance, actor, "eat", session);

            Assert.That(executed, Is.True);
            Assert.That(actor.GetNumber(satietyId), Is.EqualTo(10));
            Assert.That(appleInstance.Parent, Is.Null, "destroy: trueによりself(apple)は消滅する");
        }

        [Test]
        public void TryExecuteAction_ConditionsNotMet_DoesNothingAndReturnsFalse()
        {
            const string yaml = @"
object_defs:
  player2:
    props:
      satiety:
        value: 100
  apple2:
    actions:
      eat:
        conditions:
          - {object: actor, prop: satiety, op: lt, value: 100}
        add:
          actor:
            satiety: 10
";
            var codex = Load(yaml);
            int satietyId = codex.PropertyNames.GetId("satiety");

            var session = new WorldSession(codex);
            WorldObject actor = Spawn(codex, "player2");
            WorldObject appleInstance = Spawn(codex, "apple2");

            bool executed = InteractionExecutor.TryExecuteAction(appleInstance, actor, "eat", session);

            Assert.That(executed, Is.False, "satietyが既に100(<100を満たさない)のため実行されない");
            Assert.That(actor.GetNumber(satietyId), Is.EqualTo(100), "条件を満たさないため何も変化しない");
        }

        [Test]
        public void TryExecuteAction_UnknownActionName_ReturnsFalse()
        {
            const string yaml = @"
object_defs:
  apple3: {}
";
            var codex = Load(yaml);

            var session = new WorldSession(codex);
            WorldObject appleInstance = Spawn(codex, "apple3");

            Assert.That(InteractionExecutor.TryExecuteAction(appleInstance, null, "does_not_exist", session), Is.False);
        }

        [Test]
        public void TryExecuteAction_ParentTarget_AppliesToCurrentParent()
        {
            const string yaml = @"
object_defs:
  basket:
    slots:
      items: {}
    props:
      weight_budget:
        value: 10
  rock_item:
    actions:
      use:
        add:
          parent:
            weight_budget: -1
";
            var codex = Load(yaml);
            int itemsSlotId = codex.SlotNames.GetId("items");
            int budgetId = codex.PropertyNames.GetId("weight_budget");

            var session = new WorldSession(codex);
            WorldObject basketInstance = Spawn(codex, "basket");
            WorldObject rockInstance = Spawn(codex, "rock_item");
            rockInstance.MoveToSlot(basketInstance, itemsSlotId, session.Codex.WellKnown, out _);

            bool executed = InteractionExecutor.TryExecuteAction(rockInstance, actor: null, "use", session);

            Assert.That(executed, Is.True);
            Assert.That(basketInstance.GetNumber(budgetId), Is.EqualTo(9));
        }

        [Test]
        public void TryExecuteAction_ParentTarget_NoParent_SkipsSilently()
        {
            const string yaml = @"
object_defs:
  rock_item2:
    actions:
      use:
        destroy: parent
";
            var codex = Load(yaml);
            var session = new WorldSession(codex);
            WorldObject rockInstance = Spawn(codex, "rock_item2"); // 親を持たない

            bool executed = InteractionExecutor.TryExecuteAction(rockInstance, actor: null, "use", session);

            Assert.That(executed, Is.True, "アクション自体は実行される(親が無いのでparent対象の適用だけが無視される)");
        }

        [Test]
        public void TryExecuteAction_DelegatesToRepresentedContentWhenPresent()
        {
            const string yaml = @"
object_defs:
  player_repr:
    props:
      satiety:
        value: 0
  snack_container:
    represented_by: content
    slots:
      content:
        accepts: [{tag: edible, max: 1}]
  apple_slice:
    tags: [edible]
    actions:
      eat:
        add:
          actor:
            satiety: 10
";
            var codex = Load(yaml);
            int satietyId = codex.PropertyNames.GetId("satiety");
            int contentSlotId = codex.SlotNames.GetId("content");

            var session = new WorldSession(codex);
            WorldObject actor = Spawn(codex, "player_repr");
            WorldObject container = Spawn(codex, "snack_container");
            WorldObject slice = Spawn(codex, "apple_slice");
            slice.MoveToSlot(container, contentSlotId, codex.WellKnown, out _);

            bool executed = InteractionExecutor.TryExecuteAction(container, actor, "eat", session);

            Assert.That(executed, Is.True);
            Assert.That(actor.GetNumber(satietyId), Is.EqualTo(10));
        }

        // ------------------------------------------------------------------
        // pick: 重み付き確率分岐
        // ------------------------------------------------------------------

        [Test]
        public void TryExecuteAction_PickWithDominantWeight_AlwaysChoosesThatCandidate()
        {
            const string yaml = @"
object_defs:
  player3:
    props:
      hp:
        value: 100
  sword:
    actions:
      attack:
        pick:
          - weight: 100
            add:
              actor:
                hp: -10
          - weight: 0
            add:
              actor:
                hp: -9999
";
            var codex = Load(yaml);
            int hpId = codex.PropertyNames.GetId("hp");

            var session = new WorldSession(codex, new System.Random(1));
            WorldObject actor = Spawn(codex, "player3");
            WorldObject swordInstance = Spawn(codex, "sword");

            for (int i = 0; i < 20; i++)
            {
                InteractionExecutor.TryExecuteAction(swordInstance, actor, "attack", session);
            }

            Assert.That(actor.GetNumber(hpId), Is.EqualTo(100 - 20 * 10),
                "重み100:0なので常に最初の候補(-10)だけが選ばれ続け、2番目(-9999)は一度も選ばれない");
        }

        [Test]
        public void TryExecuteAction_PickWeightByPath_FavorsHigherWeightedCandidate()
        {
            const string yaml = @"
object_defs:
  player4:
    props:
      hp:
        value: 100
      luck:
        value: 0
  bow:
    actions:
      shoot:
        pick:
          - weight: {object: actor, prop: luck}
            add:
              actor:
                hp: 1
          - weight: 0
            add:
              actor:
                hp: -1
";
            var codex = Load(yaml);
            int hpId = codex.PropertyNames.GetId("hp");
            int luckId = codex.PropertyNames.GetId("luck");

            var session = new WorldSession(codex);
            WorldObject actor = Spawn(codex, "player4");
            actor.SetProperty(luckId, PropertyValue.FromNumber(1000)); // 2番目(重み0固定)を圧倒する
            WorldObject bowInstance = Spawn(codex, "bow");

            InteractionExecutor.TryExecuteAction(bowInstance, actor, "shoot", session);

            Assert.That(actor.GetNumber(hpId), Is.EqualTo(101), "luck(1000)がweightのpath参照先なので、ほぼ確実に1番目の候補が選ばれる");
        }

        // ------------------------------------------------------------------
        // combinations: with（タグ）・dragged対象
        // ------------------------------------------------------------------

        [Test]
        public void TryExecuteCombination_WithMatchesTag_AppliesSelfAndDraggedEffects()
        {
            const string yaml = @"
object_defs:
  wood:
    combinations:
      chop:
        with: axe_tool
        add:
          dragged:
            durability: -1
        destroy: self
  axe_tool:
    tags: [axe_tool]
    props:
      durability:
        value: 10
";
            var codex = Load(yaml);
            int durabilityId = codex.PropertyNames.GetId("durability");

            var session = new WorldSession(codex);
            WorldObject woodInstance = Spawn(codex, "wood");
            WorldObject axeInstance = Spawn(codex, "axe_tool");

            bool executed = InteractionExecutor.TryExecuteCombination(woodInstance, axeInstance, actor: null, "chop", session);

            Assert.That(executed, Is.True);
            Assert.That(woodInstance.Parent, Is.Null, "self(wood)はdestroyされる");
            Assert.That(axeInstance.GetNumber(durabilityId), Is.EqualTo(9));
        }

        [Test]
        public void TryExecuteCombination_DelegatesReceiverAndDraggedToRepresentedContents()
        {
            const string yaml = @"
traits:
  liquid_container:
    represented_by: content
    slots:
      content:
        accepts: [{tag: liquid, max: 1}]
object_defs:
  receiver:
    traits: [liquid_container]
  source:
    traits: [liquid_container]
  water_liquid:
    tags: [liquid, water_liquid]
    props:
      amount:
        value: 0
    combinations:
      pour_in:
        with: water_liquid
        add:
          self:
            amount: 2
          dragged:
            amount: -2
";
            var codex = Load(yaml);
            int contentSlotId = codex.SlotNames.GetId("content");
            int amountId = codex.PropertyNames.GetId("amount");

            var session = new WorldSession(codex);
            WorldObject receiver = Spawn(codex, "receiver");
            WorldObject source = Spawn(codex, "source");
            WorldObject receiverLiquid = Spawn(codex, "water_liquid");
            WorldObject sourceLiquid = Spawn(codex, "water_liquid");
            receiverLiquid.SetProperty(amountId, PropertyValue.FromNumber(1));
            sourceLiquid.SetProperty(amountId, PropertyValue.FromNumber(5));
            receiverLiquid.MoveToSlot(receiver, contentSlotId, codex.WellKnown, out _);
            sourceLiquid.MoveToSlot(source, contentSlotId, codex.WellKnown, out _);

            bool executed = InteractionExecutor.TryExecuteCombination(receiver, source, actor: null, "pour_in", session);

            Assert.That(executed, Is.True);
            Assert.That(receiverLiquid.GetNumber(amountId), Is.EqualTo(3));
            Assert.That(sourceLiquid.GetNumber(amountId), Is.EqualTo(3));
        }

        [Test]
        public void FindMatchingCombinations_UsesRepresentedContents()
        {
            const string yaml = @"
traits:
  liquid_container:
    represented_by: content
    slots:
      content:
        accepts: [{tag: liquid, max: 1}]
object_defs:
  receiver2:
    traits: [liquid_container]
  source2:
    traits: [liquid_container]
  water_liquid2:
    tags: [liquid, water_liquid2]
    combinations:
      pour_in:
        with: water_liquid2
        destroy: self
";
            var codex = Load(yaml);
            int contentSlotId = codex.SlotNames.GetId("content");

            WorldObject receiver = Spawn(codex, "receiver2");
            WorldObject source = Spawn(codex, "source2");
            Spawn(codex, "water_liquid2").MoveToSlot(receiver, contentSlotId, codex.WellKnown, out _);
            Spawn(codex, "water_liquid2").MoveToSlot(source, contentSlotId, codex.WellKnown, out _);
            var names = InteractionExecutor.FindMatchingCombinations(receiver, source).Select(c => c.Name).ToList();
            Assert.That(names, Is.EqualTo(new[] { "pour_in" }));
        }

        [Test]
        public void TryExecuteCombination_WithMismatchedTag_ReturnsFalse()
        {
            const string yaml = @"
object_defs:
  wood2:
    combinations:
      chop:
        with: axe_tool2
        destroy: self
  pebble3: {}
";
            var codex = Load(yaml);
            var session = new WorldSession(codex);
            WorldObject woodInstance = Spawn(codex, "wood2");
            WorldObject pebbleInstance = Spawn(codex, "pebble3");

            bool executed = InteractionExecutor.TryExecuteCombination(woodInstance, pebbleInstance, actor: null, "chop", session);

            Assert.That(executed, Is.False, "draggedがwithのタグを持たないため実行されない");
        }

        [Test]
        public void TryExecuteCombination_WithMatchesTagGrantedViaTrait_AppliesEffects()
        {
            const string yaml = @"
traits:
  sharp_tool: {tags: [sharp_tool]}
object_defs:
  wood3:
    combinations:
      chop:
        with: sharp_tool
        destroy: self
  axe_tool3:
    traits: [sharp_tool]
";
            var codex = Load(yaml);
            var session = new WorldSession(codex);
            WorldObject woodInstance = Spawn(codex, "wood3");
            WorldObject axeInstance = Spawn(codex, "axe_tool3");

            bool executed = InteractionExecutor.TryExecuteCombination(woodInstance, axeInstance, actor: null, "chop", session);

            Assert.That(executed, Is.True, "object_def自身のidではなく、参照したtrait経由で得た'sharp_tool'タグでマッチする");
        }

        [Test]
        public void FindMatchingCombinations_ReturnsOnlyCombinationsMatchingDragged()
        {
            const string yaml = @"
object_defs:
  wood4:
    combinations:
      chop:
        with: axe_tool4
      sand:
        with: sandpaper
  axe_tool4:
    tags: [axe_tool4]
";
            var codex = Load(yaml);
            var session = new WorldSession(codex);
            WorldObject woodInstance = Spawn(codex, "wood4");
            WorldObject axeInstance = Spawn(codex, "axe_tool4");

            var matches = InteractionExecutor.FindMatchingCombinations(woodInstance, axeInstance).ToList();

            Assert.That(matches.Select(c => c.Name), Is.EqualTo(new[] { "chop" }));
        }

        [Test]
        public void TryExecuteCombination_ConditionsReferenceDragged()
        {
            const string yaml = @"
object_defs:
  wood5:
    combinations:
      chop:
        with: axe_tool5
        conditions:
          - {object: dragged, prop: durability, op: gt, value: 0}
        destroy: self
  axe_tool5:
    tags: [axe_tool5]
    props:
      durability:
        value: 0
";
            var codex = Load(yaml);
            int durabilityId = codex.PropertyNames.GetId("durability");

            var session = new WorldSession(codex);
            WorldObject woodInstance = Spawn(codex, "wood5");
            WorldObject axeInstance = Spawn(codex, "axe_tool5");

            Assert.That(InteractionExecutor.TryExecuteCombination(woodInstance, axeInstance, null, "chop", session), Is.False,
                "durabilityが0(gt 0を満たさない)なので実行されない");

            axeInstance.SetProperty(durabilityId, PropertyValue.FromNumber(1));
            Assert.That(InteractionExecutor.TryExecuteCombination(woodInstance, axeInstance, null, "chop", session), Is.True);
        }
    }
}
