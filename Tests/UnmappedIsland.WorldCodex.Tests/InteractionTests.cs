using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnmappedIsland.Codex;
using UnmappedIsland.Runtime;

namespace UnmappedIsland.Codex.Tests
{
    /// <summary>
    /// actions/combinations（GameElementDefinition.md 11節・12節）の実行エンジン（InteractionExecutor）
    /// に対する自動テスト。YAMLパーサは対象外で、ObjectDefBlueprintを直接組み立てて検証する
    /// （ContributionTests.csと同じ方針）。
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

        private WorldObject Spawn(WorldCodex codex, string objectName)
        {
            ObjectDef def = codex.Objects.Get(codex.ObjectNames.GetId(objectName));
            return new WorldObject(nextInstanceId++, def);
        }

        private static PropertyBlueprint Prop(string name, int defaultValue) =>
            new PropertyBlueprint { Name = name, DefaultValue = PropertyValue.FromNumber(defaultValue) };

        private static ConditionNodeBlueprint Condition(ReferenceRoot root, string propertyName, ConditionOp op, int value)
        {
            var c = new ConditionNodeBlueprint { Kind = ConditionNodeBlueprintKind.Property, Root = root, PropertyName = propertyName, Op = op };
            c.Values.Add(PropertyValue.FromNumber(value));
            return c;
        }

        private static ActiveEffectBlueprint ActiveEffect(
            (ReferenceRoot Target, string Property, int Amount)[] adds = null,
            ReferenceRoot[] destroy = null)
        {
            var bp = new ActiveEffectBlueprint();
            if (adds != null)
                foreach (var (target, property, amount) in adds)
                {
                    if (!bp.Adds.TryGetValue(target, out var list))
                        bp.Adds[target] = list = new List<AddBlueprint>();
                    list.Add(new AddBlueprint { PropertyName = property, Amount = amount });
                }
            if (destroy != null) bp.Destroy.AddRange(destroy);
            return bp;
        }

        // ------------------------------------------------------------------
        // actions: conditions / active（self・actor）
        // ------------------------------------------------------------------

        [Test]
        public void TryExecuteAction_AppliesActiveToSelfAndActor_AndDestroysSelf()
        {
            var actorDef = new ObjectDefBlueprint { Name = "player" };
            actorDef.Properties.Add(Prop("satiety", 0));

            var food = new ObjectDefBlueprint { Name = "apple" };
            var eat = new ActionBlueprint { Name = "eat" };
            eat.Active = ActiveEffect(adds: new[] { (ReferenceRoot.Actor, "satiety", 10) }, destroy: new[] { ReferenceRoot.Self });
            food.Actions.Add(eat);

            var codex = WorldCodexBuilder.Build(new[] { actorDef, food });
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
            var actorDef = new ObjectDefBlueprint { Name = "player2" };
            actorDef.Properties.Add(Prop("satiety", 100));

            var food = new ObjectDefBlueprint { Name = "apple2" };
            var eat = new ActionBlueprint { Name = "eat" };
            eat.Conditions = Condition(ReferenceRoot.Actor, "satiety", ConditionOp.Lt, 100);
            eat.Active = ActiveEffect(adds: new[] { (ReferenceRoot.Actor, "satiety", 10) });
            food.Actions.Add(eat);

            var codex = WorldCodexBuilder.Build(new[] { actorDef, food });
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
            var food = new ObjectDefBlueprint { Name = "apple3" };
            var codex = WorldCodexBuilder.Build(new[] { food });

            var session = new WorldSession(codex);
            WorldObject appleInstance = Spawn(codex, "apple3");

            Assert.That(InteractionExecutor.TryExecuteAction(appleInstance, null, "does_not_exist", session), Is.False);
        }

        [Test]
        public void TryExecuteAction_ParentTarget_AppliesToCurrentParent()
        {
            var container = new ObjectDefBlueprint { Name = "basket" };
            container.Slots.Add(new SlotBlueprint { Name = "items" });
            container.Properties.Add(Prop("weight_budget", 10));

            var item = new ObjectDefBlueprint { Name = "rock_item" };
            var use = new ActionBlueprint { Name = "use" };
            use.Active = ActiveEffect(adds: new[] { (ReferenceRoot.Parent, "weight_budget", -1) });
            item.Actions.Add(use);

            var codex = WorldCodexBuilder.Build(new[] { container, item });
            int itemsSlotId = codex.SlotNames.GetId("items");
            int budgetId = codex.PropertyNames.GetId("weight_budget");

            var session = new WorldSession(codex);
            WorldObject basketInstance = Spawn(codex, "basket");
            WorldObject rockInstance = Spawn(codex, "rock_item");
            session.Containment.TryMoveToSlot(rockInstance, basketInstance, itemsSlotId, out _);

            bool executed = InteractionExecutor.TryExecuteAction(rockInstance, actor: null, "use", session);

            Assert.That(executed, Is.True);
            Assert.That(basketInstance.GetNumber(budgetId), Is.EqualTo(9));
        }

        [Test]
        public void TryExecuteAction_ParentTarget_NoParent_SkipsSilently()
        {
            var item = new ObjectDefBlueprint { Name = "rock_item2" };
            var use = new ActionBlueprint { Name = "use" };
            use.Active = ActiveEffect(destroy: new[] { ReferenceRoot.Parent });
            item.Actions.Add(use);

            var codex = WorldCodexBuilder.Build(new[] { item });
            var session = new WorldSession(codex);
            WorldObject rockInstance = Spawn(codex, "rock_item2"); // 親を持たない

            bool executed = InteractionExecutor.TryExecuteAction(rockInstance, actor: null, "use", session);

            Assert.That(executed, Is.True, "アクション自体は実行される(親が無いのでparent対象の適用だけが無視される)");
        }

        // ------------------------------------------------------------------
        // pick: 重み付き確率分岐
        // ------------------------------------------------------------------

        [Test]
        public void TryExecuteAction_PickWithDominantWeight_AlwaysChoosesThatCandidate()
        {
            var actorDef = new ObjectDefBlueprint { Name = "player3" };
            actorDef.Properties.Add(Prop("hp", 100));

            var weapon = new ObjectDefBlueprint { Name = "sword" };
            var attack = new ActionBlueprint { Name = "attack" };
            attack.Pick = new List<PickCandidateBlueprint>
            {
                new PickCandidateBlueprint
                {
                    Weight = new WeightBlueprint { IsPathRef = false, Literal = 100 },
                    Active = ActiveEffect(adds: new[] { (ReferenceRoot.Actor, "hp", -10) }),
                },
                new PickCandidateBlueprint
                {
                    Weight = new WeightBlueprint { IsPathRef = false, Literal = 0 },
                    Active = ActiveEffect(adds: new[] { (ReferenceRoot.Actor, "hp", -9999) }),
                },
            };
            weapon.Actions.Add(attack);

            var codex = WorldCodexBuilder.Build(new[] { actorDef, weapon });
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
            var actorDef = new ObjectDefBlueprint { Name = "player4" };
            actorDef.Properties.Add(Prop("hp", 100));
            actorDef.Properties.Add(Prop("luck", 0));

            var weapon = new ObjectDefBlueprint { Name = "bow" };
            var attack = new ActionBlueprint { Name = "shoot" };
            attack.Pick = new List<PickCandidateBlueprint>
            {
                new PickCandidateBlueprint
                {
                    Weight = new WeightBlueprint { IsPathRef = true, PathRoot = ReferenceRoot.Actor, PathPropertyName = "luck" },
                    Active = ActiveEffect(adds: new[] { (ReferenceRoot.Actor, "hp", 1) }),
                },
                new PickCandidateBlueprint
                {
                    Weight = new WeightBlueprint { IsPathRef = false, Literal = 0 },
                    Active = ActiveEffect(adds: new[] { (ReferenceRoot.Actor, "hp", -1) }),
                },
            };
            weapon.Actions.Add(attack);

            var codex = WorldCodexBuilder.Build(new[] { actorDef, weapon });
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
        // combinations: with（objectのidまたはtrait名）・dragged対象
        // ------------------------------------------------------------------

        [Test]
        public void TryExecuteCombination_WithMatchesObjectId_AppliesSelfAndDraggedEffects()
        {
            var wood = new ObjectDefBlueprint { Name = "wood" };
            var chop = new CombinationBlueprint { Name = "chop", With = "axe_tool" };
            chop.Active = ActiveEffect(adds: new[] { (ReferenceRoot.Dragged, "durability", -1) }, destroy: new[] { ReferenceRoot.Self });
            wood.Combinations.Add(chop);

            var axe = new ObjectDefBlueprint { Name = "axe_tool" };
            axe.Properties.Add(Prop("durability", 10));

            var codex = WorldCodexBuilder.Build(new[] { wood, axe });
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
        public void TryExecuteCombination_WithMismatchedObject_ReturnsFalse()
        {
            var wood = new ObjectDefBlueprint { Name = "wood2" };
            var chop = new CombinationBlueprint { Name = "chop", With = "axe_tool2" };
            chop.Active = ActiveEffect(destroy: new[] { ReferenceRoot.Self });
            wood.Combinations.Add(chop);

            var pebble = new ObjectDefBlueprint { Name = "pebble3" };

            var codex = WorldCodexBuilder.Build(new[] { wood, pebble });
            var session = new WorldSession(codex);
            WorldObject woodInstance = Spawn(codex, "wood2");
            WorldObject pebbleInstance = Spawn(codex, "pebble3");

            bool executed = InteractionExecutor.TryExecuteCombination(woodInstance, pebbleInstance, actor: null, "chop", session);

            Assert.That(executed, Is.False, "draggedがwithにマッチしないため実行されない");
        }

        [Test]
        public void TryExecuteCombination_WithMatchesTraitName_AppliesEffects()
        {
            var wood = new ObjectDefBlueprint { Name = "wood3" };
            var chop = new CombinationBlueprint { Name = "chop", With = "sharp_tool" };
            chop.Active = ActiveEffect(destroy: new[] { ReferenceRoot.Self });
            wood.Combinations.Add(chop);

            var axe = new ObjectDefBlueprint { Name = "axe_tool3" };
            axe.TraitNames.Add("sharp_tool"); // TraitMergerを経由せず、直接メタ情報だけを設定する

            var codex = WorldCodexBuilder.Build(new[] { wood, axe });
            var session = new WorldSession(codex);
            WorldObject woodInstance = Spawn(codex, "wood3");
            WorldObject axeInstance = Spawn(codex, "axe_tool3");

            bool executed = InteractionExecutor.TryExecuteCombination(woodInstance, axeInstance, actor: null, "chop", session);

            Assert.That(executed, Is.True, "object idではなく、参照していたtrait名'sharp_tool'でマッチする");
        }

        [Test]
        public void FindMatchingCombinations_ReturnsOnlyCombinationsMatchingDragged()
        {
            var wood = new ObjectDefBlueprint { Name = "wood4" };
            var chop = new CombinationBlueprint { Name = "chop", With = "axe_tool4" };
            var sand = new CombinationBlueprint { Name = "sand", With = "sandpaper" };
            wood.Combinations.Add(chop);
            wood.Combinations.Add(sand);

            var axe = new ObjectDefBlueprint { Name = "axe_tool4" };

            var codex = WorldCodexBuilder.Build(new[] { wood, axe });
            var session = new WorldSession(codex);
            WorldObject woodInstance = Spawn(codex, "wood4");
            WorldObject axeInstance = Spawn(codex, "axe_tool4");

            var matches = InteractionExecutor.FindMatchingCombinations(woodInstance, axeInstance).ToList();

            Assert.That(matches.Select(c => c.Name), Is.EqualTo(new[] { "chop" }));
        }

        [Test]
        public void TryExecuteCombination_ConditionsReferenceDragged()
        {
            var wood = new ObjectDefBlueprint { Name = "wood5" };
            var chop = new CombinationBlueprint { Name = "chop", With = "axe_tool5" };
            chop.Conditions = Condition(ReferenceRoot.Dragged, "durability", ConditionOp.Gt, 0);
            chop.Active = ActiveEffect(destroy: new[] { ReferenceRoot.Self });
            wood.Combinations.Add(chop);

            var axe = new ObjectDefBlueprint { Name = "axe_tool5" };
            axe.Properties.Add(Prop("durability", 0));

            var codex = WorldCodexBuilder.Build(new[] { wood, axe });
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
