using System;
using System.IO;
using NUnit.Framework;
using UnmappedIsland.Loader;
using UnmappedIsland.Runtime;

namespace UnmappedIsland.Codex.Tests
{
    /// <summary>
    /// Assets/StreamingAssets/WorldCodex/containers.yaml（液体容器のサンプル定義。中身の種類をシンボル型
    /// プロパティ(content)で直接表し、conditions/setの値をリテラルの代わりに{object, prop}参照にできる
    /// 仕組み（GameElementDefinition.md 14.1節・9.2節）だけで混ぜ物防止まで表現する設計）が、core.yaml・
    /// characters.yamlと同じディレクトリ内の複数ファイルとして実際に正しくロードでき、drink/pour_inが
    /// 意図通り動くことを確認する自動テスト（CharactersYamlTests/FoodsYamlTests参照、同じ方針）。
    /// </summary>
    [TestFixture]
    public class ContainersYamlTests
    {
        private WorldCodex codex;
        private int nextInstanceId;
        private int contentId;
        private int liquidAmountId;
        private int hydrationId;
        private int emptySymbol;
        private int waterSymbol;
        private int oilSymbol;

        [OneTimeSetUp]
        public void LoadWorldCodex()
        {
            string coreYamlPath = FindRepoFile("Assets/StreamingAssets/WorldCodex/core.yaml");
            string charactersYamlPath = FindRepoFile("Assets/StreamingAssets/WorldCodex/characters.yaml");
            string containersYamlPath = FindRepoFile("Assets/StreamingAssets/WorldCodex/containers.yaml");
            codex = WorldCodexYamlLoader.LoadFromGroups(new[]
            {
                new WorldCodexYamlLoader.SourceGroup("core", new[]
                {
                    new WorldCodexYamlLoader.SourceFile(coreYamlPath, File.ReadAllText(coreYamlPath)),
                    new WorldCodexYamlLoader.SourceFile(charactersYamlPath, File.ReadAllText(charactersYamlPath)),
                    new WorldCodexYamlLoader.SourceFile(containersYamlPath, File.ReadAllText(containersYamlPath)),
                }),
            });

            contentId = codex.PropertyNames.GetId("content");
            liquidAmountId = codex.PropertyNames.GetId("liquid_amount");
            hydrationId = codex.PropertyNames.GetId("hydration");
            emptySymbol = codex.SymbolNames.GetId("empty");
            waterSymbol = codex.SymbolNames.GetId("water");
            oilSymbol = codex.SymbolNames.GetId("oil");
        }

        [SetUp]
        public void SetUp()
        {
            nextInstanceId = 1;
        }

        /// <summary>dotnet testの実行ディレクトリ(bin/配下)から、リポジトリルート基準の相対パスを
        /// たどれるよう、targetを含む祖先ディレクトリを探索する。</summary>
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

        private WorldObject SpawnCanteen(int contentSymbol, int liquidAmount)
        {
            WorldObject canteen = Spawn("canteen");
            canteen.SetProperty(contentId, PropertyValue.FromNumber(contentSymbol));
            canteen.SetProperty(liquidAmountId, PropertyValue.FromNumber(liquidAmount));
            return canteen;
        }

        [Test]
        public void Drink_WithNonEmptyContent_TransfersLiquidAmountToActorHydration()
        {
            var session = new WorldSession(codex);
            WorldObject actor = Spawn("character");
            WorldObject canteen = SpawnCanteen(waterSymbol, 3000);
            actor.SetProperty(hydrationId, PropertyValue.FromNumber(0));

            bool executed = InteractionExecutor.TryExecuteAction(canteen, actor, "drink", session);

            Assert.That(executed, Is.True, "contentがempty以外なのでdrinkが実行される");
            Assert.That(canteen.GetNumber(liquidAmountId), Is.EqualTo(1000));
            Assert.That(actor.GetNumber(hydrationId), Is.EqualTo(2000));
        }

        [Test]
        public void CanteenOfWaterAndOil_HavePrefilledContentAndLiquidAmount()
        {
            ObjectDef canteenOfWater = codex.Objects.Get(codex.ObjectNames.GetId("canteen_of_water"));
            ObjectDef canteenOfOil = codex.Objects.Get(codex.ObjectNames.GetId("canteen_of_oil"));

            Assert.That(PropOf(canteenOfWater, "content").DefaultNumber, Is.EqualTo(waterSymbol));
            Assert.That(PropOf(canteenOfWater, "liquid_amount").DefaultNumber, Is.EqualTo(4800));
            Assert.That(PropOf(canteenOfOil, "content").DefaultNumber, Is.EqualTo(oilSymbol));
            Assert.That(PropOf(canteenOfOil, "liquid_amount").DefaultNumber, Is.EqualTo(4800));
        }

        [Test]
        public void Drink_WithEmptyContent_DoesNothingAndReturnsFalse()
        {
            var session = new WorldSession(codex);
            WorldObject actor = Spawn("character");
            WorldObject canteen = SpawnCanteen(emptySymbol, 0);

            bool executed = InteractionExecutor.TryExecuteAction(canteen, actor, "drink", session);

            Assert.That(executed, Is.False, "contentがemptyなのでdrinkは実行されない");
        }

        [Test]
        public void PourIn_IntoEmptyContainer_CopiesContentAndTransfersAmount()
        {
            var session = new WorldSession(codex);
            WorldObject self = SpawnCanteen(emptySymbol, 0);
            WorldObject dragged = SpawnCanteen(waterSymbol, 3000);

            bool executed = InteractionExecutor.TryExecuteCombination(self, dragged, null, "pour_in", session);

            Assert.That(executed, Is.True, "selfが空なので注げる");
            Assert.That(self.GetNumber(contentId), Is.EqualTo(waterSymbol), "空だった容器の中身がdraggedと同じ種類になる");
            Assert.That(self.GetNumber(liquidAmountId), Is.EqualTo(2000));
            Assert.That(dragged.GetNumber(liquidAmountId), Is.EqualTo(1000));
        }

        [Test]
        public void PourIn_IntoContainerWithSameContent_TopsUpWithoutChangingContent()
        {
            var session = new WorldSession(codex);
            WorldObject self = SpawnCanteen(waterSymbol, 500);
            WorldObject dragged = SpawnCanteen(waterSymbol, 3000);

            bool executed = InteractionExecutor.TryExecuteCombination(self, dragged, null, "pour_in", session);

            Assert.That(executed, Is.True, "selfとdraggedが同じ種類(water)なので継ぎ足せる");
            Assert.That(self.GetNumber(contentId), Is.EqualTo(waterSymbol));
            Assert.That(self.GetNumber(liquidAmountId), Is.EqualTo(2500));
            Assert.That(dragged.GetNumber(liquidAmountId), Is.EqualTo(1000));
        }

        [Test]
        public void PourIn_IntoContainerWithDifferentContent_DoesNothingAndReturnsFalse()
        {
            var session = new WorldSession(codex);
            WorldObject self = SpawnCanteen(oilSymbol, 500);
            WorldObject dragged = SpawnCanteen(waterSymbol, 3000);

            bool executed = InteractionExecutor.TryExecuteCombination(self, dragged, null, "pour_in", session);

            Assert.That(executed, Is.False, "selfに既に違う種類(oil)が入っているため、水を注ぐと混ざってしまうので拒否される");
            Assert.That(self.GetNumber(contentId), Is.EqualTo(oilSymbol), "中身は変化しない");
            Assert.That(self.GetNumber(liquidAmountId), Is.EqualTo(500));
            Assert.That(dragged.GetNumber(liquidAmountId), Is.EqualTo(3000), "実行されないのでdragged側も変化しない");
        }

        [Test]
        public void PourIn_FromEmptyDragged_DoesNothingAndReturnsFalse()
        {
            var session = new WorldSession(codex);
            WorldObject self = SpawnCanteen(emptySymbol, 0);
            WorldObject dragged = SpawnCanteen(emptySymbol, 0);

            bool executed = InteractionExecutor.TryExecuteCombination(self, dragged, null, "pour_in", session);

            Assert.That(executed, Is.False, "draggedが空(注げる中身が無い)なので実行されない");
        }
    }
}
