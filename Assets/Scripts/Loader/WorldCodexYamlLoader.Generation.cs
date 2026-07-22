using System.Collections.Generic;
using System.Linq;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Domain.Defs.Generation;
using YamlDotNet.RepresentationModel;

namespace UnmappedIsland.Loader
{
    public sealed partial class WorldCodexYamlLoader
    {
        /// <summary>Load系メソッドで蓄積した地形生成定義（terrain_generation.yamlのaxes/location_types/
        /// generation_scopes）。object_defs/traitsと違いtrait合成が無いためパース済みのDefで持ち、
        /// 他ファイルとの相互参照（location_types→object_defs、preferences→axes）の検証だけを
        /// Buildまで遅延する。</summary>
        private readonly Dictionary<string, AxisDef> generationAxes = new Dictionary<string, AxisDef>();
        private readonly List<LocationTypeDef> generationLocationTypes = new List<LocationTypeDef>();
        private readonly Dictionary<string, GenerationScopeDef> generationScopes = new Dictionary<string, GenerationScopeDef>();

        /// <summary>Loadの中から呼ばれ、地形生成の3ルートキーをこのインスタンスへ追記する。</summary>
        private void LoadGenerationSections(string label, YamlMappingNode root)
        {
            YamlMappingNode axes = root.TryGetMapping("axes", label);
            if (axes != null)
                foreach (var (name, node) in axes.EntriesInOrder())
                {
                    if (generationAxes.ContainsKey(name))
                        throw new YamlLoadException($"axes '{name}' が重複しています。");
                    generationAxes[name] = ParseAxis(name, (YamlMappingNode)node);
                }

            YamlMappingNode locationTypes = root.TryGetMapping("location_types", label);
            if (locationTypes != null)
                foreach (var (name, node) in locationTypes.EntriesInOrder())
                {
                    if (generationLocationTypes.Any(t => t.Name == name))
                        throw new YamlLoadException($"location_types '{name}' が重複しています。");
                    generationLocationTypes.Add(ParseLocationType(name, (YamlMappingNode)node));
                }

            YamlMappingNode scopes = root.TryGetMapping("generation_scopes", label);
            if (scopes != null)
                foreach (var (name, node) in scopes.EntriesInOrder())
                {
                    if (generationScopes.ContainsKey(name))
                        throw new YamlLoadException($"generation_scopes '{name}' が重複しています。");
                    generationScopes[name] = ParseGenerationScope(name, (YamlMappingNode)node);
                }
        }

        private AxisDef ParseAxis(string name, YamlMappingNode node)
        {
            string context = $"axes.'{name}'";

            YamlMappingNode rangeNode = node.TryGetMapping("range", context);
            if (rangeNode == null) throw new YamlLoadException($"{context}: 'range'は必須です。");
            var range = new PropertyRange(rangeNode.RequireInt("min", context), rangeNode.RequireInt("max", context));

            YamlMappingNode generatorNode = node.TryGetMapping("generator", context);
            if (generatorNode == null) throw new YamlLoadException($"{context}: 'generator'は必須です。");
            YamlSequenceNode blendNode = generatorNode.TryGetSequence("blend", context);
            if (blendNode == null || blendNode.Children.Count == 0)
                throw new YamlLoadException($"{context}: generator.blendには1つ以上の層が必要です。");

            var layers = new List<GeneratorLayer>();
            for (int i = 0; i < blendNode.Children.Count; i++)
            {
                string layerContext = $"{context}.generator.blend[{i}]";
                if (!(blendNode.Children[i] is YamlMappingNode layerNode))
                    throw new YamlLoadException($"{layerContext}: 各層はmappingである必要があります。");
                layers.Add(ParseGeneratorLayer(layerContext, layerNode));
            }

            CheckUnknownKeys(context, node, "range", "generator");
            CheckUnknownKeys(context, generatorNode, "blend");
            return new AxisDef(name, range, layers);
        }

        private GeneratorLayer ParseGeneratorLayer(string context, YamlMappingNode node)
        {
            string type = node.RequireScalar("type", context);
            int weight = node.RequireInt("weight", context);

            switch (type)
            {
                case "distance_field":
                    string reference = node.RequireScalar("reference", context);
                    if (reference != "edge")
                        throw new YamlLoadException($"{context}: distance_fieldのreferenceは現時点で'edge'のみ対応しています（値: '{reference}'）。");
                    CheckUnknownKeys(context, node, "type", "weight", "reference");
                    return new GeneratorLayer(GeneratorLayerType.DistanceField, weight);

                case "layered_noise":
                    var layer = new GeneratorLayer(
                        GeneratorLayerType.LayeredNoise, weight,
                        octaves: node.RequireInt("octaves", context),
                        frequency: node.RequireInt("frequency", context),
                        seedOffset: node.RequireInt("seed_offset", context));
                    if (layer.Octaves < 1)
                        throw new YamlLoadException($"{context}: octavesは1以上である必要があります。");
                    if (layer.Frequency < 1)
                        throw new YamlLoadException($"{context}: frequencyは1以上である必要があります。");
                    CheckUnknownKeys(context, node, "type", "weight", "octaves", "frequency", "seed_offset");
                    return layer;

                default:
                    throw new YamlLoadException($"{context}: 未知のジェネレータ 'type: {type}' です（対応: distance_field / layered_noise）。");
            }
        }

        private LocationTypeDef ParseLocationType(string name, YamlMappingNode node)
        {
            string context = $"location_types.'{name}'";

            // object_defの実在検証はBuildまで遅延する（別ファイルで後から定義されうるため）。
            int objectDefGlobalId = ObjectNames.Intern(node.RequireScalar("object_def", context));
            string displayName = node.RequireScalar("display_name", context);

            var scopes = new List<string>();
            YamlSequenceNode scopesNode = node.TryGetSequence("applicable_scopes", context);
            if (scopesNode != null)
                foreach (YamlNode scope in scopesNode)
                    scopes.Add(((YamlScalarNode)scope).Value);

            int moveCost = node.TryGetInt("move_cost", context) ?? 100;
            if (moveCost < 1) throw new YamlLoadException($"{context}: move_costは1以上である必要があります。");
            bool isFallback = node.TryGetBool("is_fallback", context, fallback: false);
            int priority = node.TryGetInt("priority", context) ?? 0;

            var preferences = new List<AxisPreference>();
            YamlMappingNode preferencesNode = node.TryGetMapping("axis_preferences", context);
            if (preferencesNode != null)
                foreach (var (axisName, prefNode) in preferencesNode.EntriesInOrder())
                {
                    string prefContext = $"{context}.axis_preferences.'{axisName}'";
                    var prefMap = (YamlMappingNode)prefNode;
                    int tolerance = prefMap.RequireInt("tolerance", prefContext);
                    if (tolerance < 1)
                        throw new YamlLoadException($"{prefContext}: toleranceは1以上である必要があります。");
                    int weight = prefMap.TryGetInt("weight", prefContext) ?? 100;
                    if (weight < 1)
                        throw new YamlLoadException($"{prefContext}: weightは1以上である必要があります。");
                    CheckUnknownKeys(prefContext, prefMap, "ideal", "tolerance", "weight");
                    preferences.Add(new AxisPreference(
                        axisName, prefMap.RequireInt("ideal", prefContext), tolerance, weight));
                }

            var hardLimits = new List<AxisLimit>();
            YamlMappingNode limitsNode = node.TryGetMapping("hard_limits", context);
            if (limitsNode != null)
                foreach (var (axisName, limitNode) in limitsNode.EntriesInOrder())
                {
                    string limitContext = $"{context}.hard_limits.'{axisName}'";
                    var limitMap = (YamlMappingNode)limitNode;
                    int? min = limitMap.TryGetInt("min", limitContext);
                    int? max = limitMap.TryGetInt("max", limitContext);
                    if (!min.HasValue && !max.HasValue)
                        throw new YamlLoadException($"{limitContext}: 'min'または'max'のいずれかが必要です。");
                    CheckUnknownKeys(limitContext, limitMap, "min", "max");
                    hardLimits.Add(new AxisLimit(axisName, min, max));
                }

            if (preferences.Count == 0 && !isFallback)
                throw new YamlLoadException(
                    $"{context}: axis_preferencesが空の（全軸に無関心な）型はis_fallback: trueにしてください" +
                    "（通常の最近傍マッチングでは距離が定義できないため）。");

            CheckUnknownKeys(context, node,
                "object_def", "display_name", "applicable_scopes", "move_cost",
                "is_fallback", "priority", "axis_preferences", "hard_limits");

            return new LocationTypeDef(
                name, objectDefGlobalId, displayName, scopes, moveCost, isFallback, priority,
                preferences, hardLimits);
        }

        private GenerationScopeDef ParseGenerationScope(string name, YamlMappingNode node)
        {
            string context = $"generation_scopes.'{name}'";

            YamlMappingNode siteCountNode = node.TryGetMapping("site_count", context);
            if (siteCountNode == null) throw new YamlLoadException($"{context}: 'site_count'は必須です。");
            int siteCountMin = siteCountNode.RequireInt("min", context);
            int siteCountMax = siteCountNode.RequireInt("max", context);
            if (siteCountMin < 1 || siteCountMax < siteCountMin)
                throw new YamlLoadException($"{context}: site_countは1 <= min <= maxである必要があります。");

            var guarantees = new List<GuaranteeDef>();
            YamlSequenceNode guaranteesNode = node.TryGetSequence("guarantees", context);
            if (guaranteesNode != null)
                for (int i = 0; i < guaranteesNode.Children.Count; i++)
                {
                    string guaranteeContext = $"{context}.guarantees[{i}]";
                    if (!(guaranteesNode.Children[i] is YamlMappingNode guaranteeNode))
                        throw new YamlLoadException($"{guaranteeContext}: 各要素はmappingである必要があります。");

                    string pickRaw = guaranteeNode.RequireScalar("pick", guaranteeContext);
                    GuaranteePick pick;
                    switch (pickRaw)
                    {
                        case "max": pick = GuaranteePick.Max; break;
                        case "min": pick = GuaranteePick.Min; break;
                        default:
                            throw new YamlLoadException($"{guaranteeContext}: pickは'max'または'min'である必要があります（値: '{pickRaw}'）。");
                    }

                    int count = guaranteeNode.TryGetInt("count", guaranteeContext) ?? 1;
                    if (count < 1)
                        throw new YamlLoadException($"{guaranteeContext}: countは1以上である必要があります。");

                    CheckUnknownKeys(guaranteeContext, guaranteeNode, "location_type", "count", "axis", "pick");
                    guarantees.Add(new GuaranteeDef(
                        guaranteeNode.RequireScalar("location_type", guaranteeContext),
                        count,
                        guaranteeNode.RequireScalar("axis", guaranteeContext),
                        pick));
                }

            var scope = new GenerationScopeDef(
                name, siteCountMin, siteCountMax,
                coastBand: node.TryGetInt("coast_band", context) ?? 0,
                hullCoast: node.TryGetBool("hull_coast", context, fallback: false),
                interiorBias: node.TryGetInt("interior_bias", context) ?? 0,
                extraEdgeDetourFactor: node.TryGetInt("extra_edge_detour_factor", context) ?? 150,
                baseMinutesPerDistance: node.TryGetInt("base_minutes_per_distance", context) ?? 1,
                guarantees: guarantees);

            if (scope.InteriorBias < 0 || scope.InteriorBias > 100)
                throw new YamlLoadException($"{context}: interior_biasは0〜100である必要があります。");

            CheckUnknownKeys(context, node,
                "site_count", "coast_band", "hull_coast", "interior_bias",
                "extra_edge_detour_factor", "base_minutes_per_distance", "guarantees");

            return scope;
        }

        /// <summary>
        /// Buildの中から呼ばれ、蓄積した生成定義の相互参照（location_types→object_defs、
        /// preferences/hard_limits/guarantees→axes、guarantees→location_types）を検証してから
        /// GenerationDefsを組み立てる。生成定義が1つも無ければnull（生成ファイル無しのCodex）。
        /// </summary>
        private GenerationDefs BuildGenerationDefs(IReadOnlyDictionary<int, ObjectDef> objectDefsByGlobalId)
        {
            if (generationAxes.Count == 0 && generationLocationTypes.Count == 0 && generationScopes.Count == 0)
                return null;

            foreach (LocationTypeDef type in generationLocationTypes)
            {
                if (!objectDefsByGlobalId.ContainsKey(type.ObjectDefGlobalId))
                    throw new YamlLoadException(
                        $"location_types '{type.Name}' が参照するobject_def '{ObjectNames.GetName(type.ObjectDefGlobalId)}' が見つかりません。");

                foreach (AxisPreference preference in type.Preferences)
                    if (!generationAxes.ContainsKey(preference.Axis))
                        throw new YamlLoadException(
                            $"location_types '{type.Name}' のaxis_preferencesが参照する軸 '{preference.Axis}' が見つかりません。");

                foreach (AxisLimit limit in type.HardLimits)
                    if (!generationAxes.ContainsKey(limit.Axis))
                        throw new YamlLoadException(
                            $"location_types '{type.Name}' のhard_limitsが参照する軸 '{limit.Axis}' が見つかりません。");
            }

            foreach (GenerationScopeDef scope in generationScopes.Values)
                foreach (GuaranteeDef guarantee in scope.Guarantees)
                {
                    if (!generationAxes.ContainsKey(guarantee.Axis))
                        throw new YamlLoadException(
                            $"generation_scopes '{scope.Name}' のguaranteesが参照する軸 '{guarantee.Axis}' が見つかりません。");
                    if (generationLocationTypes.All(t => t.Name != guarantee.LocationType))
                        throw new YamlLoadException(
                            $"generation_scopes '{scope.Name}' のguaranteesが参照するlocation_type '{guarantee.LocationType}' が見つかりません。");
                }

            return new GenerationDefs(
                new Dictionary<string, AxisDef>(generationAxes),
                generationLocationTypes.ToList(),
                new Dictionary<string, GenerationScopeDef>(generationScopes));
        }

        private void ResetGeneration()
        {
            generationAxes.Clear();
            generationLocationTypes.Clear();
            generationScopes.Clear();
        }

        private static void CheckUnknownKeys(string context, YamlMappingNode node, params string[] knownKeys)
        {
            var unknownKeys = node.EntriesInOrder().Select(e => e.Key)
                .Where(k => !knownKeys.Contains(k)).ToList();
            if (unknownKeys.Count > 0)
                throw new YamlLoadException($"{context}: 未知のキー '{string.Join(", ", unknownKeys)}' です。");
        }
    }
}
