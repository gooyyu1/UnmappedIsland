using System;
using System.IO;
using NUnit.Framework;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Loader;
using UnmappedIsland.Domain.Runtime;

namespace UnmappedIsland.StreamingAssets
{
    /// <summary>
    /// Assets/StreamingAssets/WorldCodex/characters.yaml（プレイヤーキャラクターの定義）が、core.yamlと
    /// 同じディレクトリ内の複数ファイルとして実際に正しくロードできることを確認する自動テスト
    /// （CoreYamlTests参照、同じ方針）。
    /// </summary>
    [TestFixture]
    public class CharactersYamlTests
    {
        private WorldCodex codex;

        [OneTimeSetUp]
        public void LoadWorldCodex()
        {
            string coreYamlPath = FindRepoFile("Assets/StreamingAssets/WorldCodex/core.yaml");
            string charactersYamlPath = FindRepoFile("Assets/StreamingAssets/WorldCodex/characters.yaml");
            codex = new WorldCodexYamlLoader()
                .LoadFromFile(coreYamlPath)
                .LoadFromFile(charactersYamlPath)
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

        [Test]
        public void Character_IsSingletonWithExpectedDefaultProperties()
        {
            ObjectDef character = codex.Objects.Get(codex.ObjectNames.GetId("character"));
            Assert.That(character.IsSingleton, Is.True);

            // 初期値は実行時インスタンスの現在値として観測する（DefaultNumberは非公開）。
            var instance = new WorldObject(1, character, new WorldSession(codex));
            // satiety: 1日(96 tick)分、-100/tickでmax=9600。
            Assert.That(instance.GetNumber(codex.PropertyNames.GetId("satiety")), Is.EqualTo(9600));
            // hydration: 3日(288 tick)分、-100/tickでmax=28800。
            Assert.That(instance.GetNumber(codex.PropertyNames.GetId("hydration")), Is.EqualTo(28800));
            // body_fat: 標準体型を想定した初期値=15日分(1440 tick)、-100/tickで144000。
            Assert.That(instance.GetNumber(codex.PropertyNames.GetId("body_fat")), Is.EqualTo(144000));
            // wakefulness: 強制的に起こされ続けない自然な限界=24時間(96 tick)分、-100/tickでmax=9600。
            Assert.That(instance.GetNumber(codex.PropertyNames.GetId("wakefulness")), Is.EqualTo(9600));
            Assert.That(instance.GetNumber(codex.PropertyNames.GetId("stamina")), Is.EqualTo(100));
        }

        [TestCase("satiety", 0, 9600)]
        [TestCase("hydration", 0, 28800)]
        [TestCase("body_fat", 0, 576000)] // 最大限に肥満した状態=60日分(5760 tick)、-100/tick。
        [TestCase("wakefulness", 0, 9600)]
        [TestCase("stamina", 0, 100)]
        public void Character_Properties_HaveExpectedRange(string name, int expectedMin, int expectedMax)
        {
            ObjectDef character = codex.Objects.Get(codex.ObjectNames.GetId("character"));
            PropertyDef prop = PropOf(character, name);
            Assert.That(prop.Range.HasValue, Is.True, $"{name}にはrangeが必要");
            Assert.That(prop.Range.Value.Min, Is.EqualTo(expectedMin));
            Assert.That(prop.Range.Value.Max, Is.EqualTo(expectedMax));
        }

        [TestCase("satiety")]
        [TestCase("hydration")]
        [TestCase("body_fat")]
        [TestCase("wakefulness")]
        public void Character_DepletingProperties_DecayByOneHundredPerTick(string name)
        {
            var session = new WorldSession(codex);
            ObjectDef character = codex.Objects.Get(codex.ObjectNames.GetId("character"));
            var instance = new WorldObject(1, character, session);
            int propId = codex.PropertyNames.GetId(name);
            int before = instance.GetNumber(propId);

            instance.Tick(session);

            Assert.That(instance.GetNumber(propId), Is.EqualTo(before - 100));
        }

        private PropertyDef PropOf(ObjectDef def, string propertyName)
        {
            return def.GetPropertyDef(codex.PropertyNames.GetId(propertyName));
        }
    }
}
