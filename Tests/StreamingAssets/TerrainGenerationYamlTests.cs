using System;
using System.IO;
using System.Linq;
using NUnit.Framework;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Domain.Defs.Generation;
using UnmappedIsland.Loader;

namespace UnmappedIsland.StreamingAssets
{
    /// <summary>
    /// Assets/StreamingAssets/WorldCodex/terrain_generation.yaml（地形生成定義）が、実際のファイルとして
    /// 正しくロードでき、locations.yamlの土地定義と過不足なく対応していることを確認する自動テスト。
    /// </summary>
    [TestFixture]
    public class TerrainGenerationYamlTests
    {
        private WorldCodex codex;

        [OneTimeSetUp]
        public void LoadWorldCodexDirectory()
        {
            string directory = FindRepoDirectory("Assets/StreamingAssets/WorldCodex");
            codex = new WorldCodexYamlLoader().LoadFromDirectory(directory).Build();
        }

        private static string FindRepoDirectory(string relativePath)
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null)
            {
                string candidate = System.IO.Path.Combine(dir.FullName, relativePath);
                if (Directory.Exists(candidate)) return candidate;
                dir = dir.Parent;
            }
            throw new DirectoryNotFoundException($"'{relativePath}' が祖先ディレクトリの中に見つかりませんでした。");
        }

        [Test]
        public void Generation_IsLoadedWithExpectedAxes()
        {
            Assert.That(codex.Generation, Is.Not.Null);
            Assert.That(codex.Generation.Axes.Keys,
                Is.EquivalentTo(new[] { "elevation", "humidity", "coastal_distance", "ruggedness" }));
        }

        [Test]
        public void LocationTypes_CoverAllLandObjectDefs_Bidirectionally()
        {
            // location_types→object_defs: すべての型が実在の土地object_defを指し、locationタグを持つ。
            int locationTag = codex.TagNames.GetId("location");
            foreach (LocationTypeDef type in codex.Generation.LocationTypes)
            {
                ObjectDef def = codex.Objects.Get(type.ObjectDefGlobalId);
                Assert.That(def, Is.Not.Null, $"{type.Name} のobject_defが実在する");
                Assert.That(def.Tags, Does.Contain(locationTag), $"{type.Name} のobject_defはlocationタグを持つ");
            }

            // object_defs→location_types: locationタグを持つ土地object_defはすべて、少なくとも1つの
            // location_typeから参照される（定義したのに絶対に生成されない土地を作らない）。
            var referencedDefIds = codex.Generation.LocationTypes.Select(t => t.ObjectDefGlobalId).ToHashSet();
            for (int id = 0; id < codex.Objects.Count; id++)
            {
                ObjectDef def = codex.Objects.Get(id);
                if (def == null || !def.Tags.Contains(locationTag)) continue;
                Assert.That(referencedDefIds, Does.Contain(id),
                    $"locationタグを持つ '{def.Name}' はいずれかのlocation_typeから参照される");
            }
        }

        [Test]
        public void IslandScope_MatchesRequirements()
        {
            GenerationScopeDef island = codex.Generation.Scopes["island"];

            Assert.That(island.SiteCountMin, Is.EqualTo(10), "生成される土地は10〜20個(要求)");
            Assert.That(island.SiteCountMax, Is.EqualTo(20));
            Assert.That(island.HullCoast, Is.True, "外周のサイトを海岸帯へ寄せ、島が海岸に囲まれることを保証する");
            Assert.That(island.CoastBand, Is.GreaterThan(0));

            GuaranteeDef mountain = island.Guarantees.Single(g => g.LocationType == "mountain_peak");
            Assert.That(mountain.Count, Is.EqualTo(1), "島には必ず山がひとつ(要求)");
            Assert.That(mountain.Axis, Is.EqualTo("elevation"));
            Assert.That(mountain.Pick, Is.EqualTo(GuaranteePick.Max));
        }

        [Test]
        public void CoastalTypes_AreConfinedToCoastBand_AndInlandTypesExcludedFromIt()
        {
            GenerationScopeDef island = codex.Generation.Scopes["island"];
            var coastalTypes = new[] { "sandy_beach", "rocky_coast", "cliff_coast" };

            foreach (LocationTypeDef type in codex.Generation.LocationTypes)
            {
                AxisLimit coastal = type.HardLimits.SingleOrDefault(l => l.Axis == "coastal_distance");
                Assert.That(coastal, Is.Not.Null, $"{type.Name} はcoastal_distanceのhard_limitを持つ");

                if (coastalTypes.Contains(type.Name))
                    Assert.That(coastal.Max, Is.EqualTo(island.CoastBand),
                        $"海岸型 {type.Name} は海岸帯(coast_band以下)にしか出ない");
                else
                    Assert.That(coastal.Min, Is.EqualTo(island.CoastBand + 1),
                        $"内陸型 {type.Name} は海岸帯には出ない(海岸過多の防止)");
            }
        }
    }
}
