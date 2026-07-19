using System;
using System.IO;
using NUnit.Framework;
using UnmappedIsland.Loader;
using UnmappedIsland.Runtime;

namespace UnmappedIsland.Codex.Tests
{
    /// <summary>
    /// Assets/StreamingAssets/WorldCodex/containers.yaml（液体容器のサンプル定義、案3「容器がamountを
    /// 持ち、中身の種類はタグ付きマーカーで識別する」設計）が、core.yaml・characters.yamlと同じ
    /// ディレクトリ内の複数ファイルとして実際に正しくロードでき、drinkアクションがスロット中身判定
    /// （GameElementDefinition.md 14.3節）によって中身の種類ごとに正しく出し分けられることを確認する
    /// 自動テスト（CharactersYamlTests/FoodsYamlTests参照、同じ方針）。
    /// </summary>
    [TestFixture]
    public class ContainersYamlTests
    {
        private WorldCodex codex;
        private int nextInstanceId;

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

        [Test]
        public void Drink_WithWaterMarkerInContentSlot_TransfersWaterAmountToActorHydration()
        {
            var session = new WorldSession(codex);
            WorldObject actor = Spawn("character");
            WorldObject canteen = Spawn("canteen");
            WorldObject waterMarker = Spawn("liquid_marker_water");

            int waterId = codex.PropertyNames.GetId("water_amount");
            int hydrationId = codex.PropertyNames.GetId("hydration");
            int contentSlotId = codex.SlotNames.GetId("content");

            waterMarker.MoveToSlot(canteen, contentSlotId, session.Codex.WellKnown, out _);
            canteen.SetProperty(waterId, PropertyValue.FromNumber(3000));
            actor.SetProperty(hydrationId, PropertyValue.FromNumber(0));

            bool executed = InteractionExecutor.TryExecuteAction(canteen, actor, "drink", session);

            Assert.That(executed, Is.True, "中身がliquid_waterタグのマーカーなのでdrinkが実行される");
            Assert.That(canteen.GetNumber(waterId), Is.EqualTo(1000));
            Assert.That(actor.GetNumber(hydrationId), Is.EqualTo(2000));
        }

        [Test]
        public void Drink_WithOilMarkerInContentSlot_DoesNothingAndReturnsFalse()
        {
            var session = new WorldSession(codex);
            WorldObject actor = Spawn("character");
            WorldObject canteen = Spawn("canteen");
            WorldObject oilMarker = Spawn("liquid_marker_oil");

            int waterId = codex.PropertyNames.GetId("water_amount");
            int hydrationId = codex.PropertyNames.GetId("hydration");
            int contentSlotId = codex.SlotNames.GetId("content");

            oilMarker.MoveToSlot(canteen, contentSlotId, session.Codex.WellKnown, out _);
            canteen.SetProperty(waterId, PropertyValue.FromNumber(3000));
            actor.SetProperty(hydrationId, PropertyValue.FromNumber(0));

            bool executed = InteractionExecutor.TryExecuteAction(canteen, actor, "drink", session);

            Assert.That(executed, Is.False, "中身がliquid_oilタグのマーカーなのでdrinkは実行されない");
            Assert.That(canteen.GetNumber(waterId), Is.EqualTo(3000), "実行されないのでwater_amountは変化しない");
            Assert.That(actor.GetNumber(hydrationId), Is.EqualTo(0));
        }

        [Test]
        public void Drink_WithEmptyContentSlot_DoesNothingAndReturnsFalse()
        {
            var session = new WorldSession(codex);
            WorldObject actor = Spawn("character");
            WorldObject canteen = Spawn("canteen");

            int waterId = codex.PropertyNames.GetId("water_amount");
            canteen.SetProperty(waterId, PropertyValue.FromNumber(3000));

            bool executed = InteractionExecutor.TryExecuteAction(canteen, actor, "drink", session);

            Assert.That(executed, Is.False, "contentスロットが空(マーカー無し)なのでdrinkは実行されない");
            Assert.That(canteen.GetNumber(waterId), Is.EqualTo(3000));
        }
    }
}
