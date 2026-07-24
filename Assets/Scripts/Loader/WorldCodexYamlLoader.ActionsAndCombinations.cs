using System.Collections.Generic;
using System.Linq;
using UnmappedIsland.Domain.Defs;
using YamlDotNet.RepresentationModel;

namespace UnmappedIsland.Loader
{
    public sealed partial class WorldCodexYamlLoader
    {
        private WeightSpec ParseWeight(string context, YamlNode node, bool allowDragged, string fieldName = "weight")
        {
            if (node is YamlScalarNode scalar)
            {
                if (!double.TryParse(scalar.Value, out double literal))
                    throw new YamlLoadException($"{context}: {fieldName}は数値である必要があります（値: '{scalar.Value}'）。");
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

            throw new YamlLoadException($"{context}: {fieldName}はリテラル数値か{{object, prop}}のいずれかである必要があります。");
        }

        /// <summary>pick候補が持つ、weight/pick以外の兄弟キー（set/add/destroy/spawn）。</summary>
        private static readonly string[] PickCandidateReservedKeys = { "weight", "pick" };

        private List<PickCandidateDef> ParsePickList(string context, YamlSequenceNode pickNode, bool allowDragged, bool selfOnly = false)
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

                // activeとpickは排他。この候補が選ばれたときに適用する効果を、単一のActiveEffect
                // （合成ActiveEffects、またはネストしたpickのPickEffect）として持たせる。selfOnly
                // （on_min等のrangeイベント内のpick）は、ネストした候補の効果対象にもそのまま引き継ぐ。
                ActiveEffect effect = hasActive
                    ? ParseActiveEffectBody(candidateContext, map, allowDragged, selfOnly, PickCandidateReservedKeys)
                    : new PickEffect(ParsePickList(candidateContext, nestedPick, allowDragged, selfOnly));

                result.Add(new PickCandidateDef(weight, effect));
            }

            return result;
        }

        /// <summary>set/add/destroy/spawn（active）とpickは排他。条件成立時に適用する効果を、単一の
        /// ActiveEffect（合成ActiveEffects、またはpickのPickEffect）として返す。両方あればエラー、どちらも
        /// 無ければnull（条件成立時に何も起きない）。action/combination共通の解釈（pick候補は必ず
        /// いずれかを要求するため、この共通ヘルパーは使わずParsePickList側で個別に検証する）。</summary>
        private ActiveEffect ParseEffect(string context, YamlMappingNode map, bool allowDragged, string[] reservedKeys)
        {
            bool hasActive = HasActiveContent(map);
            YamlSequenceNode pickList = map.TryGetSequence("pick", context);
            if (hasActive && pickList != null)
                throw new YamlLoadException($"{context}: set/add/destroy/spawnとpickは同時に指定できません。");

            if (hasActive) return ParseActiveEffectBody(context, map, allowDragged, selfOnly: false, reservedKeys);
            if (pickList != null) return new PickEffect(ParsePickList(context, pickList, allowDragged));
            return null;
        }

        /// <summary>actionエントリが持つ、showMenu/conditions/duration/pick以外の兄弟キー（set/add/destroy/spawn）。</summary>
        private static readonly string[] ActionReservedKeys = { "showMenu", "conditions", "duration", "pick" };

        /// <summary>combinationエントリが持つ、with/conditions/pick以外の兄弟キー（set/add/destroy/spawn）。</summary>
        private static readonly string[] CombinationReservedKeys = { "with", "conditions", "pick" };

        /// <summary>actions_map（11節）を読む。dragged対象はメニュー型操作では意味を持たないため不可。
        /// RawObjectDef.Resolveから、trait合成済みのノードに対して呼ばれる。</summary>
        public List<ActionDef> ParseActions(string objectDefName, YamlMappingNode actionsNode)
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
                ActiveEffect effect = ParseEffect(context, map, allowDragged: false, ActionReservedKeys);

                // duration（実行にかかるゲーム内時間・分）。weightと同じ「リテラルか{object, prop}参照か」の
                // 二択（WeightSpecを流用）。省略時は時間を消費しない。
                YamlNode durationNode = map.TryGet("duration");
                WeightSpec? duration = durationNode != null
                    ? ParseWeight($"{context}.duration", durationNode, allowDragged: false, fieldName: "duration")
                    : (WeightSpec?)null;

                result.Add(new ActionDef(name, ShowMenuMode.Always, conditions, effect, duration));
            }

            return result;
        }

        /// <summary>combinations_map（12節）を読む。dragged対象を使える。RawObjectDef.Resolveから、
        /// trait合成済みのノードに対して呼ばれる。</summary>
        public List<CombinationDef> ParseCombinations(string objectDefName, YamlMappingNode combinationsNode)
        {
            var result = new List<CombinationDef>();
            if (combinationsNode == null) return result;

            foreach (var (name, node) in combinationsNode.EntriesInOrder())
            {
                string context = $"'{objectDefName}'.combinations.'{name}'";
                var map = (YamlMappingNode)node;

                int with = TagNames.Intern(map.RequireScalar("with", context));
                ConditionNode conditions = ParseConditionsField(context, map.TryGetSequence("conditions", context), CombinationConditionRoots);
                ActiveEffect effect = ParseEffect(context, map, allowDragged: true, CombinationReservedKeys);

                result.Add(new CombinationDef(name, with, conditions, effect));
            }

            return result;
        }
    }
}
