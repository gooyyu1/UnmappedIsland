using System;
using System.IO;
using NUnit.Framework;
using UnmappedIsland.Loader;

namespace UnmappedIsland.Codex.Tests
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
            codex = WorldCodexYamlLoader.LoadFromGroups(new[]
            {
                new WorldCodexYamlLoader.SourceGroup("core", new[]
                {
                    new WorldCodexYamlLoader.SourceFile(coreYamlPath, File.ReadAllText(coreYamlPath)),
                    new WorldCodexYamlLoader.SourceFile(charactersYamlPath, File.ReadAllText(charactersYamlPath)),
                }),
            });
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

            Assert.That(PropOf(character, "satiety").DefaultNumber, Is.EqualTo(100));
            Assert.That(PropOf(character, "hydration").DefaultNumber, Is.EqualTo(100));
            Assert.That(PropOf(character, "wakefulness").DefaultNumber, Is.EqualTo(100));
            Assert.That(PropOf(character, "stamina").DefaultNumber, Is.EqualTo(100));
        }

        [Test]
        public void Character_Properties_AreClampedToZeroToOneHundred()
        {
            ObjectDef character = codex.Objects.Get(codex.ObjectNames.GetId("character"));
            foreach (var name in new[] { "satiety", "hydration", "wakefulness", "stamina" })
            {
                PropertyDef prop = PropOf(character, name);
                Assert.That(prop.Range.HasValue, Is.True, $"{name}にはrangeが必要");
                Assert.That(prop.Range.Value.Min, Is.EqualTo(0));
                Assert.That(prop.Range.Value.Max, Is.EqualTo(100));
            }
        }

        private PropertyDef PropOf(ObjectDef def, string propertyName)
        {
            int local = def.PropertyLayout.ToLocal(codex.PropertyNames.GetId(propertyName));
            return def.PropertyDefs[local];
        }
    }
}
