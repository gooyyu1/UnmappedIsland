using System;
using NUnit.Framework;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Domain.Defs.Generation;

namespace UnmappedIsland.Loader
{
    /// <summary>
    /// 地形生成定義（axes/location_types/generation_scopesの3ルートキー、terrain_generation.yaml相当）の
    /// ローダーに対する自動テスト。object_defs/traitsと同じ厳格モード（重複・未知キー・参照不在はエラー）で
    /// 読めることを確認する。
    /// </summary>
    [TestFixture]
    public class GenerationYamlLoaderTests
    {
        private const string ValidYaml = @"
object_defs:
  meadow: {}
  peak: {}

axes:
  elevation:
    range: {min: 0, max: 100}
    generator:
      blend:
        - {type: distance_field, reference: edge, weight: 70}
        - {type: layered_noise, octaves: 3, frequency: 2, seed_offset: 11, weight: 30}

location_types:
  meadow:
    object_def: meadow
    display_name: 草地
    applicable_scopes: [island]
    axis_preferences:
      elevation: {ideal: 30, tolerance: 25, weight: 100}
    hard_limits:
      elevation: {max: 60}
  peak:
    object_def: peak
    display_name: 頂
    move_cost: 250
    axis_preferences:
      elevation: {ideal: 100, tolerance: 15}

generation_scopes:
  island:
    site_count: {min: 10, max: 20}
    coast_band: 15
    hull_coast: true
    interior_bias: 60
    guarantees:
      - {location_type: peak, count: 1, axis: elevation, pick: max}
";

        private static WorldCodex Load(string yaml) =>
            new WorldCodexYamlLoader().Load("terrain_generation.yaml", yaml).Build();

        [Test]
        public void Load_ValidGenerationSections_BuildsGenerationDefs()
        {
            WorldCodex codex = Load(ValidYaml);
            GenerationDefs generation = codex.Generation;

            Assert.That(generation, Is.Not.Null);

            AxisDef elevation = generation.Axes["elevation"];
            Assert.That(elevation.Range.Min, Is.EqualTo(0));
            Assert.That(elevation.Range.Max, Is.EqualTo(100));
            Assert.That(elevation.Layers, Has.Count.EqualTo(2));
            Assert.That(elevation.Layers[0].Type, Is.EqualTo(GeneratorLayerType.DistanceField));
            Assert.That(elevation.Layers[0].Weight, Is.EqualTo(70));
            Assert.That(elevation.Layers[1].Type, Is.EqualTo(GeneratorLayerType.LayeredNoise));
            Assert.That(elevation.Layers[1].Octaves, Is.EqualTo(3));
            Assert.That(elevation.Layers[1].SeedOffset, Is.EqualTo(11));

            Assert.That(generation.LocationTypes, Has.Count.EqualTo(2));
            LocationTypeDef meadow = generation.LocationTypes[0];
            Assert.That(meadow.Name, Is.EqualTo("meadow"));
            Assert.That(meadow.ObjectDefGlobalId, Is.EqualTo(codex.ObjectNames.GetId("meadow")));
            Assert.That(meadow.DisplayName, Is.EqualTo("草地"));
            Assert.That(meadow.AppliesTo("island"), Is.True);
            Assert.That(meadow.AppliesTo("structure_interior"), Is.False);
            Assert.That(meadow.MoveCost, Is.EqualTo(100), "move_cost省略時は100(等倍)");
            Assert.That(meadow.Preferences[0].Tolerance, Is.EqualTo(25));
            Assert.That(meadow.HardLimits[0].Allows(60), Is.True);
            Assert.That(meadow.HardLimits[0].Allows(61), Is.False);

            LocationTypeDef peak = generation.LocationTypes[1];
            Assert.That(peak.AppliesTo("island"), Is.True, "applicable_scopes省略時は全スコープに適用される");
            Assert.That(peak.Preferences[0].Weight, Is.EqualTo(100), "weight省略時は100(等倍)");

            GenerationScopeDef island = generation.Scopes["island"];
            Assert.That(island.SiteCountMin, Is.EqualTo(10));
            Assert.That(island.SiteCountMax, Is.EqualTo(20));
            Assert.That(island.CoastBand, Is.EqualTo(15));
            Assert.That(island.HullCoast, Is.True);
            Assert.That(island.InteriorBias, Is.EqualTo(60));
            Assert.That(island.Guarantees, Has.Count.EqualTo(1));
            Assert.That(island.Guarantees[0].LocationType, Is.EqualTo("peak"));
            Assert.That(island.Guarantees[0].Pick, Is.EqualTo(GuaranteePick.Max));
        }

        [Test]
        public void Load_WithoutGenerationSections_GenerationIsNull()
        {
            WorldCodex codex = Load(@"
object_defs:
  stone: {}
");
            Assert.That(codex.Generation, Is.Null);
        }

        [Test]
        public void Load_GenerationSections_MergeAcrossFiles()
        {
            // axes/location_types/generation_scopesはobject_defs/traitsと同様、複数ファイルへ分割できる。
            WorldCodex codex = new WorldCodexYamlLoader()
                .Load("a.yaml", @"
object_defs:
  meadow: {}
axes:
  elevation:
    range: {min: 0, max: 100}
    generator:
      blend:
        - {type: distance_field, reference: edge, weight: 100}
")
                .Load("b.yaml", @"
location_types:
  meadow:
    object_def: meadow
    display_name: 草地
    axis_preferences:
      elevation: {ideal: 30, tolerance: 25}
")
                .Build();

            Assert.That(codex.Generation.Axes, Contains.Key("elevation"));
            Assert.That(codex.Generation.LocationTypes, Has.Count.EqualTo(1));
        }

        [Test]
        public void Load_LocationTypeWithMissingObjectDef_Throws()
        {
            Assert.That((Func<WorldCodex>)(() => Load(@"
axes:
  elevation:
    range: {min: 0, max: 100}
    generator:
      blend:
        - {type: distance_field, reference: edge, weight: 100}
location_types:
  meadow:
    object_def: no_such_def
    display_name: 草地
    axis_preferences:
      elevation: {ideal: 30, tolerance: 25}
")), Throws.TypeOf<YamlLoadException>().With.Message.Contain("no_such_def"));
        }

        [Test]
        public void Load_PreferenceReferencingUnknownAxis_Throws()
        {
            Assert.That((Func<WorldCodex>)(() => Load(@"
object_defs:
  meadow: {}
axes:
  elevation:
    range: {min: 0, max: 100}
    generator:
      blend:
        - {type: distance_field, reference: edge, weight: 100}
location_types:
  meadow:
    object_def: meadow
    display_name: 草地
    axis_preferences:
      no_such_axis: {ideal: 30, tolerance: 25}
")), Throws.TypeOf<YamlLoadException>().With.Message.Contain("no_such_axis"));
        }

        [Test]
        public void Load_GuaranteeReferencingUnknownLocationType_Throws()
        {
            Assert.That((Func<WorldCodex>)(() => Load(@"
object_defs:
  meadow: {}
axes:
  elevation:
    range: {min: 0, max: 100}
    generator:
      blend:
        - {type: distance_field, reference: edge, weight: 100}
location_types:
  meadow:
    object_def: meadow
    display_name: 草地
    axis_preferences:
      elevation: {ideal: 30, tolerance: 25}
generation_scopes:
  island:
    site_count: {min: 10, max: 20}
    guarantees:
      - {location_type: no_such_type, axis: elevation, pick: max}
")), Throws.TypeOf<YamlLoadException>().With.Message.Contain("no_such_type"));
        }

        [Test]
        public void Load_DuplicateAxisAcrossFiles_Throws()
        {
            const string axisYaml = @"
axes:
  elevation:
    range: {min: 0, max: 100}
    generator:
      blend:
        - {type: distance_field, reference: edge, weight: 100}
";
            Assert.That((Func<WorldCodexYamlLoader>)(() =>
                    new WorldCodexYamlLoader().Load("a.yaml", axisYaml).Load("b.yaml", axisYaml)),
                Throws.TypeOf<YamlLoadException>().With.Message.Contain("elevation"));
        }

        [Test]
        public void Load_UnknownGeneratorType_Throws()
        {
            Assert.That((Func<WorldCodex>)(() => Load(@"
axes:
  elevation:
    range: {min: 0, max: 100}
    generator:
      blend:
        - {type: blob_scatter, weight: 100}
")), Throws.TypeOf<YamlLoadException>().With.Message.Contain("blob_scatter"));
        }

        [Test]
        public void Load_NonFallbackTypeWithoutPreferences_Throws()
        {
            // 全軸無関心の型は最近傍マッチングの距離が定義できないため、フォールバック専用。
            Assert.That((Func<WorldCodex>)(() => Load(@"
object_defs:
  meadow: {}
location_types:
  meadow:
    object_def: meadow
    display_name: 草地
")), Throws.TypeOf<YamlLoadException>().With.Message.Contain("is_fallback"));
        }
    }
}
