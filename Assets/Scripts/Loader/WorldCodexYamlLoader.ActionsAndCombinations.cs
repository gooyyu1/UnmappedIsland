using System.Collections.Generic;
using System.Linq;
using UnmappedIsland.Codex;
using YamlDotNet.RepresentationModel;

namespace UnmappedIsland.Loader
{
    public sealed partial class WorldCodexYamlLoader
    {
        private WeightSpec ParseWeight(string context, YamlNode node, bool allowDragged)
        {
            if (node is YamlScalarNode scalar)
            {
                if (!double.TryParse(scalar.Value, out double literal))
                    throw new YamlLoadException($"{context}: weightは数値である必要があります（値: '{scalar.Value}'）。");
                return WeightSpec.FromLiteral(literal);
            }

            if (node is YamlMappingNode map)
            {
                var allowedRoots = allowDragged ? CombinationConditionRoots : ActionConditionRoots;
                string objectName = map.TryGetScalar("object", context);
                ReferenceRoot root = objectName != null ? ParseConditionObject(context, objectName, allowedRoots) : ReferenceRoot.Self;
                string propName = map.RequireScalar("prop", context);

                var unknownKeys = map.EntriesInOrder().Select(e => e.Key)
                    .Where(k => k != "object" && k != "prop").ToList();
                if (unknownKeys.Count > 0)
                    throw new YamlLoadException($"{context}: 未知のキー '{string.Join(", ", unknownKeys)}' です。");

                return WeightSpec.FromPath(new PropertyPath(root, PropertyNames.Intern(propName)));
            }

            throw new YamlLoadException($"{context}: weightはリテラル数値か{{object, prop}}のいずれかである必要があります。");
        }

        /// <summary>pick候補が持つ、weight/pick以外の兄弟キー（set/add/destroy/spawn）。</summary>
        private static readonly string[] PickCandidateReservedKeys = { "weight", "pick" };

        private List<PickCandidateDef> ParsePickList(string context, YamlSequenceNode pickNode, bool allowDragged)
        {
            var result = new List<PickCandidateDef>();

            foreach (YamlNode node in pickNode)
            {
                var map = (YamlMappingNode)node;
                string candidateContext = $"{context}.pick[{result.Count}]";

                YamlNode weightNode = map.TryGet("weight");
                if (weightNode == null) throw new YamlLoadException($"{candidateContext}: 'weight'は必須です。");

                WeightSpec weight = ParseWeight(candidateContext, weightNode, allowDragged);

                bool hasActive = HasActiveContent(map);
                YamlSequenceNode nestedPick = map.TryGetSequence("pick", candidateContext);

                if (hasActive && nestedPick != null)
                    throw new YamlLoadException($"{candidateContext}: set/add/destroy/spawnとpickは同時に指定できません。");
                if (!hasActive && nestedPick == null)
                    throw new YamlLoadException($"{candidateContext}: set/add/destroy/spawnのいずれか、またはpickが必要です。");

                ActiveEffect active = hasActive
                    ? ParseActiveEffectBody(candidateContext, map, allowDragged, selfOnly: false, PickCandidateReservedKeys)
                    : null;
                List<PickCandidateDef> pick = nestedPick != null
                    ? ParsePickList(candidateContext, nestedPick, allowDragged)
                    : null;

                result.Add(new PickCandidateDef(weight, active, pick));
            }

            return result;
        }

        /// <summary>actionエントリが持つ、showMenu/conditions/pick以外の兄弟キー（set/add/destroy/spawn）。</summary>
        private static readonly string[] ActionReservedKeys = { "showMenu", "conditions", "pick" };

        /// <summary>combinationエントリが持つ、with/conditions/pick以外の兄弟キー（set/add/destroy/spawn）。</summary>
        private static readonly string[] CombinationReservedKeys = { "with", "conditions", "pick" };

        /// <summary>actions_map（11節）を読む。dragged対象はメニュー型操作では意味を持たないため不可。
        /// RawObjectDef.Resolveから、trait合成済みのノードに対して呼ばれるため internal。</summary>
        internal List<ActionDef> ParseActions(string objectDefName, YamlMappingNode actionsNode)
        {
            var result = new List<ActionDef>();
            if (actionsNode == null) return result;

            foreach (var (name, node) in actionsNode.EntriesInOrder())
            {
                string context = $"'{objectDefName}'.actions.'{name}'";
                var map = (YamlMappingNode)node;

                string showMenuRaw = map.TryGetScalar("showMenu", context);
                if (showMenuRaw != null && showMenuRaw != "always")
                    throw new YamlLoadException($"{context}: showMenuは現時点で'always'のみ対応しています（値: '{showMenuRaw}'）。");

                ConditionNode conditions = ParseConditionsField(context, map.TryGetSequence("conditions", context), ActionConditionRoots);

                bool hasActive = HasActiveContent(map);
                YamlSequenceNode pickList = map.TryGetSequence("pick", context);
                if (hasActive && pickList != null)
                    throw new YamlLoadException($"{context}: set/add/destroy/spawnとpickは同時に指定できません。");

                ActiveEffect active = hasActive ? ParseActiveEffectBody(context, map, allowDragged: false, selfOnly: false, ActionReservedKeys) : null;
                List<PickCandidateDef> pick = pickList != null ? ParsePickList(context, pickList, allowDragged: false) : null;

                result.Add(new ActionDef(name, ShowMenuMode.Always, conditions, active, pick));
            }

            return result;
        }

        /// <summary>combinations_map（12節）を読む。dragged対象を使える。RawObjectDef.Resolveから、
        /// trait合成済みのノードに対して呼ばれるため internal。</summary>
        internal List<CombinationDef> ParseCombinations(string objectDefName, YamlMappingNode combinationsNode)
        {
            var result = new List<CombinationDef>();
            if (combinationsNode == null) return result;

            foreach (var (name, node) in combinationsNode.EntriesInOrder())
            {
                string context = $"'{objectDefName}'.combinations.'{name}'";
                var map = (YamlMappingNode)node;

                int with = TagNames.Intern(map.RequireScalar("with", context));
                ConditionNode conditions = ParseConditionsField(context, map.TryGetSequence("conditions", context), CombinationConditionRoots);

                bool hasActive = HasActiveContent(map);
                YamlSequenceNode pickList = map.TryGetSequence("pick", context);
                if (hasActive && pickList != null)
                    throw new YamlLoadException($"{context}: set/add/destroy/spawnとpickは同時に指定できません。");

                ActiveEffect active = hasActive ? ParseActiveEffectBody(context, map, allowDragged: true, selfOnly: false, CombinationReservedKeys) : null;
                List<PickCandidateDef> pick = pickList != null ? ParsePickList(context, pickList, allowDragged: true) : null;

                result.Add(new CombinationDef(name, with, conditions, active, pick));
            }

            return result;
        }
    }
}
