using System;
using System.IO;
using NUnit.Framework;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Loader;
using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.StreamingAssets
{
    /// <summary>
    /// Assets/StreamingAssets/WorldCodex/foods.yaml（サンプル食料の定義）が、core.yaml・
    /// characters.yamlと同じディレクトリ内の複数ファイルとして実際に正しくロードでき、
    /// eatアクションがactor（プレイヤーキャラ）のsatiety・該当する栄養カテゴリを正しく
    /// 加算することを確認する自動テスト（CoreYamlTests/CharactersYamlTests参照、同じ方針）。
    /// </summary>
    [TestFixture]
    public class FoodsYamlTests
    {
        private WorldCodex codex;

        [OneTimeSetUp]
        public void LoadWorldCodex()
        {
            string coreYamlPath = FindRepoFile("Assets/StreamingAssets/WorldCodex/core.yaml");
            string charactersYamlPath = FindRepoFile("Assets/StreamingAssets/WorldCodex/characters.yaml");
            string foodsYamlPath = FindRepoFile("Assets/StreamingAssets/WorldCodex/foods.yaml");
            codex = new WorldCodexYamlLoader()
                .LoadFromFile(coreYamlPath)
                .LoadFromFile(charactersYamlPath)
                .LoadFromFile(foodsYamlPath)
                .Build();
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

        private WorldObject Spawn(string objectName, int instanceId) =>
            new WorldObject(instanceId, codex.Objects.Get(codex.ObjectNames.GetId(objectName)), new WorldSession(codex));

        [TestCase("water_spinach", "vegetable_nutrition", 8)]
        [TestCase("coconut_crab", "meat_nutrition", 15)]
        [TestCase("taro", "grain_tuber_nutrition", 20)]
        public void Eat_RestoresSatietyAndOwnNutritionCategory_AndDestroysFood(
            string foodObjectName, string nutritionPropertyName, int expectedSatietyGain)
        {
            var session = new WorldSession(codex);
            WorldObject character = Spawn("character", 1);
            WorldObject food = Spawn(foodObjectName, 2);

            int satietyId = codex.PropertyNames.GetId("satiety");
            int nutritionId = codex.PropertyNames.GetId(nutritionPropertyName);

            // 栄養カテゴリはtickごとに減衰する（characters.yaml参照）ため、加算量だけを検証したい。
            // 一旦0まで下げてから食べさせ、増分だけを見る。
            character.SetProperty(satietyId, 0);
            character.SetProperty(nutritionId, 0);

            Assert.That(food.TryExecuteAction("eat", character, session), Is.True);

            Assert.That(character.GetNumber(satietyId), Is.EqualTo(expectedSatietyGain));
            Assert.That(character.GetNumber(nutritionId), Is.EqualTo(20000));
        }

        [Test]
        public void Character_HasThreeNutritionCategories_FullByDefaultWithWeekLongDecay()
        {
            ObjectDef character = codex.Objects.Get(codex.ObjectNames.GetId("character"));
            var instance = new WorldObject(1, character, new WorldSession(codex));
            foreach (var name in new[] { "vegetable_nutrition", "meat_nutrition", "grain_tuber_nutrition" })
            {
                int id = codex.PropertyNames.GetId(name);
                // 初期値は実行時インスタンスの現在値として観測する（DefaultNumberは非公開）。
                Assert.That(instance.GetNumber(id), Is.EqualTo(67200), $"{name}の初期値");
                PropertyDef prop = character.GetPropertyDef(id);
                Assert.That(prop.Range.Value.Min, Is.EqualTo(0));
                Assert.That(prop.Range.Value.Max, Is.EqualTo(67200));
            }
        }
    }
}
