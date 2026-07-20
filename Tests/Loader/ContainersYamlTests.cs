using System;
using System.IO;
using System.Linq;
using NUnit.Framework;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Loader;
using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.Loader
{
    /// <summary>
    /// Assets/StreamingAssets/WorldCodex/containers.yaml が、represented_by で中身オブジェクトへ委譲する
    /// 新しい液体容器モデルを正しく表現できているかを確認する自動テスト。
    /// </summary>
    [TestFixture]
    public class ContainersYamlTests
    {
        private WorldCodex codex;
        private int nextInstanceId;
        private int hydrationId;
        private int wakefulnessId;
        private int weatherId;
        private int locationsSlotId;
        private int contentSlotId;
        private int liquidAmountId;

        [OneTimeSetUp]
        public void LoadWorldCodex()
        {
            string coreYamlPath = FindRepoFile("Assets/StreamingAssets/WorldCodex/core.yaml");
            string charactersYamlPath = FindRepoFile("Assets/StreamingAssets/WorldCodex/characters.yaml");
            string containersYamlPath = FindRepoFile("Assets/StreamingAssets/WorldCodex/containers.yaml");
            codex = new WorldCodexYamlLoader()
                .LoadFromFile(coreYamlPath)
                .LoadFromFile(charactersYamlPath)
                .LoadFromFile(containersYamlPath)
                .Build();

            hydrationId = codex.PropertyNames.GetId("hydration");
            wakefulnessId = codex.PropertyNames.GetId("wakefulness");
            weatherId = codex.PropertyNames.GetId("weather");
            locationsSlotId = codex.SlotNames.GetId("locations");
            contentSlotId = codex.SlotNames.GetId("content");
            liquidAmountId = codex.PropertyNames.GetId("liquid_amount");
        }

        [SetUp]
        public void SetUp()
        {
            nextInstanceId = 1;
        }

        private static string FindRepoFile(string relativePath)
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null)
            {
                string candidate = Path.Combine(dir.FullName, relativePath);
                if (File.Exists(candidate)) return candidate;
                dir = dir.Parent;
            }
            throw new FileNotFoundException($"'{relativePath}' が祖先ディレクトリの中に見つかりませんでした。");
        }

        private WorldObject Spawn(string objectName) =>
            new WorldObject(nextInstanceId++, codex.Objects.Get(codex.ObjectNames.GetId(objectName)));

        private PropertyDef PropOf(ObjectDef def, string propertyName)
        {
            int local = def.PropertyLayout.ToLocal(codex.PropertyNames.GetId(propertyName));
            return def.PropertyDefs[local];
        }

        private static string LiquidMarkerNameFor(string liquidKind) => $"{liquidKind}_liquid";

        private WorldObject SpawnContainer(string containerName, string liquidKind, int liquidAmount)
        {
            WorldObject container = Spawn(containerName);
            container.SetProperty(liquidAmountId, PropertyValue.FromNumber(liquidAmount));
            WorldObject content = Spawn(LiquidMarkerNameFor(liquidKind));
            content.MoveToSlot(container, contentSlotId, codex.WellKnown, out _);
            return container;
        }

        private WorldObject ContentOf(WorldObject container)
        {
            container.TryGetSlot(contentSlotId, out Slot slot);
            return slot.Contents.Single();
        }

        private WorldObject SpawnWorld(string weather)
        {
            WorldObject world = Spawn("world");
            world.SetProperty(weatherId, PropertyValue.FromNumber(codex.SymbolNames.Intern(weather)));
            return world;
        }

        private WorldObject SpawnContainerUnderWorld(string containerName, string liquidKind, int liquidAmount, WorldObject world, WorldSession session)
        {
            WorldObject container = SpawnContainer(containerName, liquidKind, liquidAmount);
            container.MoveToSlot(world, locationsSlotId, session.Codex.WellKnown, out _, force: true);
            return container;
        }

        private string FindOnlyMatchingCombinationName(WorldObject self, WorldObject dragged)
        {
            var matches = InteractionExecutor.FindMatchingCombinations(self, dragged).ToList();
            Assert.That(matches.Count, Is.EqualTo(1), "この組み合わせでは候補が1つだけであることを前提にしている");
            return matches[0].Name;
        }

        [Test]
        public void Containers_AreWrappersRepresentedByContentWithLiquidAmount()
        {
            ObjectDef canteen = codex.Objects.Get(codex.ObjectNames.GetId("canteen"));

            Assert.That(canteen.RepresentedBySlotGlobalId, Is.EqualTo(contentSlotId));
            Assert.That(canteen.Actions, Is.Empty, "容器本体は中身の行動を持たない");
            Assert.That(canteen.Combinations, Is.Empty, "容器本体は注ぎ処理を持たない");
            Assert.That(canteen.PropertyDefs.Select(p => p.Name), Does.Contain("liquid_amount"), "容器本体はliquid_amountを持つ");
        }

        [TestCase("coconut_bowl", 1200)]
        [TestCase("canteen", 4800)]
        [TestCase("pot", 4800)]
        [TestCase("bottle", 9600)]
        [TestCase("jar", 19200)]
        public void Container_HasExpectedLiquidCapacity(string containerName, int expectedMax)
        {
            ObjectDef container = codex.Objects.Get(codex.ObjectNames.GetId(containerName));
            PropertyDef liquidAmount = PropOf(container, "liquid_amount");

            Assert.That(liquidAmount.Range.HasValue, Is.True);
            Assert.That(liquidAmount.Range.Value.Max, Is.EqualTo(expectedMax));
        }

        [Test]
        public void Drink_WaterDelegatesFromContainerToRepresentedLiquid()
        {
            var session = new WorldSession(codex);
            WorldObject actor = Spawn("character");
            WorldObject canteen = SpawnContainer("canteen", "water", 3000);
            actor.SetProperty(hydrationId, PropertyValue.FromNumber(0));

            bool executed = InteractionExecutor.TryExecuteAction(canteen, actor, "drink", session);

            Assert.That(executed, Is.True);
            Assert.That(canteen.GetNumber(liquidAmountId), Is.EqualTo(1800));
            Assert.That(actor.GetNumber(hydrationId), Is.EqualTo(1200));
        }

        [Test]
        public void Drink_TeaCanApplyAdditionalContentSpecificEffect()
        {
            var session = new WorldSession(codex);
            WorldObject actor = Spawn("character");
            WorldObject canteen = SpawnContainer("canteen", "tea", 3000);
            actor.SetProperty(hydrationId, PropertyValue.FromNumber(0));
            actor.SetProperty(wakefulnessId, PropertyValue.FromNumber(0));

            bool executed = InteractionExecutor.TryExecuteAction(canteen, actor, "drink", session);

            Assert.That(executed, Is.True);
            Assert.That(actor.GetNumber(hydrationId), Is.EqualTo(1200));
            Assert.That(actor.GetNumber(wakefulnessId), Is.EqualTo(200), "お茶だけが持つ追加効果も represented_by 経由で発動する");
        }

        [Test]
        public void Drink_OilHasNoDrinkAction()
        {
            var session = new WorldSession(codex);
            WorldObject actor = Spawn("character");
            WorldObject canteen = SpawnContainer("canteen", "oil", 3000);

            bool executed = InteractionExecutor.TryExecuteAction(canteen, actor, "drink", session);

            Assert.That(executed, Is.False, "飲用不可の液体は自分でdrinkアクションを持たない");
        }

        [TestCase("cloudy", -1)]
        [TestCase("clear", -2)]
        [TestCase("sunny", -3)]
        [TestCase("scorching", -4)]
        public void Evaporation_CoconutBowlRateDependsOnWeather(string weather, int expectedDelta)
        {
            var session = new WorldSession(codex);
            WorldObject world = SpawnWorld(weather);
            WorldObject bowl = SpawnContainerUnderWorld("coconut_bowl", "water", 100, world, session);

            bowl.Tick(session);

            Assert.That(bowl.GetNumber(liquidAmountId), Is.EqualTo(100 + expectedDelta));
        }

        [TestCase("storm")]
        [TestCase("heavy_rain")]
        [TestCase("light_rain")]
        public void Evaporation_CoconutBowlDoesNotEvaporateDuringRain(string weather)
        {
            var session = new WorldSession(codex);
            WorldObject world = SpawnWorld(weather);
            WorldObject bowl = SpawnContainerUnderWorld("coconut_bowl", "water", 100, world, session);

            bowl.Tick(session);

            Assert.That(bowl.GetNumber(liquidAmountId), Is.EqualTo(100));
        }

        [TestCase("cloudy", -2)]
        [TestCase("clear", -4)]
        [TestCase("sunny", -6)]
        [TestCase("scorching", -8)]
        public void Evaporation_JarRateDependsOnWeather(string weather, int expectedDelta)
        {
            var session = new WorldSession(codex);
            WorldObject world = SpawnWorld(weather);
            WorldObject jar = SpawnContainerUnderWorld("jar", "water", 200, world, session);

            jar.Tick(session);

            Assert.That(jar.GetNumber(liquidAmountId), Is.EqualTo(200 + expectedDelta));
        }

        [TestCase("canteen")]
        [TestCase("pot")]
        [TestCase("bottle")]
        public void Evaporation_SealedContainersDoNotEvaporate(string objectName)
        {
            var session = new WorldSession(codex);
            WorldObject world = SpawnWorld("scorching");
            WorldObject container = SpawnContainerUnderWorld(objectName, "water", 100, world, session);

            container.Tick(session);

            Assert.That(container.GetNumber(liquidAmountId), Is.EqualTo(100));
        }

        [Test]
        public void Evaporation_DepletingLiquid_ReducesContainerAmountToZero()
        {
            var session = new WorldSession(codex);
            WorldObject world = SpawnWorld("clear");
            WorldObject bowl = SpawnContainerUnderWorld("coconut_bowl", "water", 2, world, session);

            bowl.Tick(session);

            Assert.That(bowl.GetNumber(liquidAmountId), Is.EqualTo(0));
        }

        [Test]
        public void PourIn_IntoEmptyContainer_ReplacesEmptyMarkerWithDraggedLiquidType()
        {
            var session = new WorldSession(codex);
            WorldObject self = SpawnContainer("canteen", "empty", 0);
            WorldObject dragged = SpawnContainer("canteen", "water", 3000);
            string combinationName = FindOnlyMatchingCombinationName(self, dragged);

            bool executed = InteractionExecutor.TryExecuteCombination(self, dragged, null, combinationName, session);

            Assert.That(executed, Is.True);
            Assert.That(ContentOf(self).Def.Name, Is.EqualTo("water_liquid"));
            Assert.That(self.GetNumber(liquidAmountId), Is.EqualTo(3000));
            Assert.That(dragged.GetNumber(liquidAmountId), Is.EqualTo(0));
        }

        [Test]
        public void PourIn_IntoContainerWithSameContent_TopsUpWithoutChangingLiquidType()
        {
            var session = new WorldSession(codex);
            WorldObject self = SpawnContainer("canteen", "water", 500);
            WorldObject dragged = SpawnContainer("canteen", "water", 3000);

            bool executed = InteractionExecutor.TryExecuteCombination(self, dragged, null, "pour_in", session);

            Assert.That(executed, Is.True);
            Assert.That(ContentOf(self).Def.Name, Is.EqualTo("water_liquid"));
            Assert.That(self.GetNumber(liquidAmountId), Is.EqualTo(3500));
            Assert.That(dragged.GetNumber(liquidAmountId), Is.EqualTo(0));
        }

        [Test]
        public void PourIn_IntoContainerWithDifferentContent_DoesNothingAndReturnsFalse()
        {
            var session = new WorldSession(codex);
            WorldObject self = SpawnContainer("canteen", "oil", 500);
            WorldObject dragged = SpawnContainer("canteen", "water", 3000);

            bool executed = InteractionExecutor.TryExecuteCombination(self, dragged, null, "pour_in", session);

            Assert.That(executed, Is.False);
            Assert.That(ContentOf(self).Def.Name, Is.EqualTo("oil_liquid"));
            Assert.That(self.GetNumber(liquidAmountId), Is.EqualTo(500));
            Assert.That(dragged.GetNumber(liquidAmountId), Is.EqualTo(3000));
        }
    }
}
