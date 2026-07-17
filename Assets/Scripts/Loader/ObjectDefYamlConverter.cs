using System.Collections.Generic;
using System.Linq;
using UnmappedIsland.Codex;
using UnmappedIsland.Runtime;
using YamlDotNet.RepresentationModel;

namespace UnmappedIsland.Loader
{
    /// <summary>
    /// 既にtrait解決済み（TraitMerger参照）の props/slots/passive/stack_order ノードから、
    /// ObjectDefBlueprintを組み立てる。GameElementDefinition.md 6〜7節・7.6節に対応する。
    ///
    /// 未対応（現時点ではCodex側にビルド先の型が無いため意図的にスキップする）:
    /// traits/actions/combinations/recipes/covers/layer、passiveのactor対象、on_zeroのself以外の対象。
    /// </summary>
    internal static class ObjectDefYamlConverter
    {
        public static ObjectDefBlueprint Build(
            string name,
            bool isSingleton,
            YamlMappingNode propsNode,
            YamlMappingNode slotsNode,
            IReadOnlyList<YamlMappingNode> passiveNodes,
            YamlMappingNode stackOrderNode,
            NameRegistry symbols)
        {
            var bp = new ObjectDefBlueprint { Name = name, IsSingleton = isSingleton };

            if (propsNode != null)
                foreach (var (propName, propValueNode) in propsNode.EntriesInOrder())
                    bp.Properties.Add(ParseProperty(name, propName, (YamlMappingNode)propValueNode, symbols, bp));

            if (slotsNode != null)
                foreach (var (slotName, slotValueNode) in slotsNode.EntriesInOrder())
                    bp.Slots.Add(ParseSlot(name, slotName, (YamlMappingNode)slotValueNode));

            foreach (YamlMappingNode passiveNode in passiveNodes)
                ParsePassiveMapInto(bp.Contributions, name, passiveNode, forcedGate: null, forcedStageProperty: null, forcedStageName: null);

            if (stackOrderNode != null)
            {
                string context = $"'{name}'.stack_order";
                bp.StackOrder = new StackOrderBlueprint
                {
                    PropertyName = stackOrderNode.RequireScalar("property", context),
                    Ascending = stackOrderNode.TryGetBool("ascending", context, fallback: false),
                };
            }

            return bp;
        }

        private static PropertyBlueprint ParseProperty(
            string objectDefName, string propName, YamlMappingNode node, NameRegistry symbols, ObjectDefBlueprint owner)
        {
            string context = $"'{objectDefName}'.props.'{propName}'";

            var bp = new PropertyBlueprint { Name = propName };

            YamlNode valueNode = node.TryGet("value");
            if (valueNode == null)
                throw new YamlLoadException($"{context}: 必須フィールド 'value' がありません（traitの継承先で指定してください）。");

            if (valueNode is YamlMappingNode rangeNode)
            {
                var range = new PropertyRange(rangeNode.RequireInt("min", context), rangeNode.RequireInt("max", context));
                bp.RerollRange = range;
                // 再ロール自体は未実装（別途）。テンプレートのデフォルト値は決定的にrange.Minで埋めておく。
                bp.DefaultValue = PropertyValue.FromNumber(range.Min);
            }
            else
            {
                bp.DefaultValue = ParseScalarPropertyValue(((YamlScalarNode)valueNode).Value, symbols);
            }

            YamlMappingNode rangeSpec = node.TryGetMapping("range", context);
            if (rangeSpec != null)
                bp.Range = new PropertyRange(rangeSpec.RequireInt("min", context), rangeSpec.RequireInt("max", context));

            YamlMappingNode overflow = node.TryGetMapping("on_overflow", context);
            if (overflow != null)
            {
                string mode = overflow.RequireScalar("mode", context);
                if (mode == "wrap")
                {
                    bp.OverflowMode = OverflowMode.Wrap;
                    bp.OverflowCarryToName = overflow.RequireScalar("carry_to", context);
                }
                else if (mode != "none")
                {
                    throw new YamlLoadException($"{context}: on_overflow.modeは'wrap'または'none'である必要があります（値: '{mode}'）。");
                }
            }

            YamlSequenceNode stages = node.TryGetSequence("stages", context);
            if (stages != null)
            {
                foreach (YamlNode stageNode in stages)
                {
                    var stageMap = (YamlMappingNode)stageNode;
                    string stageName = stageMap.RequireScalar("name", context);
                    int? min = stageMap.TryGetInt("min", context);
                    bp.Stages.Add(new StageBlueprint { Name = stageName, Min = min });

                    YamlMappingNode stagePassive = stageMap.TryGetMapping("passive", context);
                    if (stagePassive != null)
                        ParsePassiveMapInto(owner.Contributions, objectDefName, stagePassive,
                            forcedGate: ContributionGateKind.WhenOwnStage, forcedStageProperty: propName, forcedStageName: stageName);
                }
            }

            YamlMappingNode propPassive = node.TryGetMapping("passive", context);
            if (propPassive != null)
                ParsePassiveMapInto(owner.Contributions, objectDefName, propPassive, forcedGate: null, forcedStageProperty: null, forcedStageName: null);

            YamlMappingNode onZero = node.TryGetMapping("on_zero", context);
            if (onZero != null)
                bp.OnZero = ParseOnZero(context, onZero);

            return bp;
        }

        private static PropertyValue ParseScalarPropertyValue(string raw, NameRegistry symbols)
        {
            if (int.TryParse(raw, out int number)) return PropertyValue.FromNumber(number);
            if (bool.TryParse(raw, out bool boolValue)) return PropertyValue.FromNumber(boolValue ? 1 : 0);
            return PropertyValue.FromSymbol(symbols.Intern(raw));
        }

        private static ActiveEffectBlueprint ParseOnZero(string context, YamlMappingNode onZeroMap)
        {
            var unsupportedTargets = onZeroMap.EntriesInOrder().Select(e => e.Key).Where(k => k != "self").ToList();
            if (unsupportedTargets.Count > 0)
                throw new YamlLoadException(
                    $"{context}: on_zeroは現時点でselfのみ対応しています（未対応: {string.Join(", ", unsupportedTargets)}）。");

            var selfNode = onZeroMap.TryGetMapping("self", context);
            if (selfNode == null) return null;

            var bp = new ActiveEffectBlueprint();

            YamlMappingNode add = selfNode.TryGetMapping("add", context);
            if (add != null)
                foreach (var (propName, amountNode) in add.EntriesInOrder())
                    bp.Adds.Add(new AddBlueprint { PropertyName = propName, Amount = int.Parse(((YamlScalarNode)amountNode).Value) });

            bp.Destroy = selfNode.TryGetBool("destroy", context, fallback: false);

            YamlMappingNode spawn = selfNode.TryGetMapping("spawn", context);
            if (spawn != null)
            {
                string into = spawn.TryGetScalar("into", context);
                bp.Spawn = new SpawnBlueprint
                {
                    ObjectName = spawn.RequireScalar("object", context),
                    Into = ParseSpawnTargetRoot(context, into),
                };
            }

            return bp;
        }

        private static SpawnTargetRoot ParseSpawnTargetRoot(string context, string raw)
        {
            switch (raw)
            {
                case null:
                case "same_slot": return SpawnTargetRoot.SameSlot;
                case "self": return SpawnTargetRoot.Self;
                case "actor": return SpawnTargetRoot.Actor;
                default:
                    throw new YamlLoadException($"{context}: spawn.intoは 'same_slot'/'self'/'actor' のいずれかである必要があります（値: '{raw}'）。");
            }
        }

        private static SlotBlueprint ParseSlot(string objectDefName, string slotName, YamlMappingNode node)
        {
            string context = $"'{objectDefName}'.slots.'{slotName}'";

            var bp = new SlotBlueprint { Name = slotName };

            YamlSequenceNode accepts = node.TryGetSequence("accepts", context);
            if (accepts != null)
                foreach (YamlNode acceptNode in accepts)
                {
                    var acceptMap = (YamlMappingNode)acceptNode;
                    bp.Accepts.Add(new AcceptBlueprint
                    {
                        ObjectName = acceptMap.RequireScalar("object", context),
                        Max = acceptMap.RequireInt("max", context),
                        Consume = acceptMap.TryGetBool("consume", context, fallback: false),
                    });
                }

            bp.Capacity = node.TryGetDouble("capacity", context);
            bp.WeightRate = node.TryGetDouble("weight_rate", context) ?? 1.0;
            bp.Stackable = node.TryGetBool("stackable", context, fallback: true);
            bp.UnitCapacity = node.TryGetInt("unit_capacity", context);
            bp.FixedPositions = node.TryGetBool("fixed_positions", context, fallback: false);

            return bp;
        }

        /// <summary>
        /// passive_map（self/parent/child、actorは未対応のためスキップ）を読み、ContributionBlueprintへ
        /// 変換してoutputへ追加する。forcedGateがWhenOwnStageの場合、各対象の"when"は無視し
        /// （1つのContributionは単一のゲート種別しか表現できないため）、常にそのステージのゲートを使う。
        /// </summary>
        private static void ParsePassiveMapInto(
            List<ContributionBlueprint> output, string objectDefName, YamlMappingNode passiveMap,
            ContributionGateKind? forcedGate, string forcedStageProperty, string forcedStageName)
        {
            string context = $"'{objectDefName}'.passive";

            foreach (var (targetName, bodyNode) in passiveMap.EntriesInOrder())
            {
                if (targetName == "actor") continue; // 未対応（ContributionTargetにActorが無いため）

                ContributionTarget target;
                switch (targetName)
                {
                    case "self": target = ContributionTarget.Self; break;
                    case "parent": target = ContributionTarget.Parent; break;
                    case "child": target = ContributionTarget.Child; break;
                    default:
                        throw new YamlLoadException($"{context}: 未知の対象キー '{targetName}' です。");
                }

                var body = (YamlMappingNode)bodyNode;

                ContributionGateKind gateKind;
                string gateSlotName = null;
                string gateStageProperty = null;
                string gateStageName = null;

                if (forcedGate == ContributionGateKind.WhenOwnStage)
                {
                    gateKind = ContributionGateKind.WhenOwnStage;
                    gateStageProperty = forcedStageProperty;
                    gateStageName = forcedStageName;
                }
                else
                {
                    string when = body.TryGetScalar("when", context);
                    if (when != null)
                    {
                        gateKind = ContributionGateKind.WhenSlot;
                        gateSlotName = when;
                    }
                    else
                    {
                        gateKind = ContributionGateKind.Always;
                    }
                }

                YamlMappingNode modify = body.TryGetMapping("modify", context);
                if (modify != null)
                    foreach (var (propName, amountNode) in modify.EntriesInOrder())
                        output.Add(new ContributionBlueprint
                        {
                            Target = target,
                            Kind = ContributionKind.Modify,
                            TargetPropertyName = propName,
                            Amount = int.Parse(((YamlScalarNode)amountNode).Value),
                            GateKind = gateKind,
                            GateSlotName = gateSlotName,
                            GateStagePropertyName = gateStageProperty,
                            GateStageName = gateStageName,
                        });

                YamlMappingNode accumulate = body.TryGetMapping("accumulate", context);
                if (accumulate != null)
                    foreach (var (propName, amountNode) in accumulate.EntriesInOrder())
                        output.Add(new ContributionBlueprint
                        {
                            Target = target,
                            Kind = ContributionKind.Accumulate,
                            TargetPropertyName = propName,
                            Amount = int.Parse(((YamlScalarNode)amountNode).Value),
                            GateKind = gateKind,
                            GateSlotName = gateSlotName,
                            GateStagePropertyName = gateStageProperty,
                            GateStageName = gateStageName,
                        });
            }
        }
    }
}
