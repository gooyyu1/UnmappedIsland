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
            IReadOnlyList<string> traitNames,
            YamlMappingNode propsNode,
            YamlMappingNode slotsNode,
            IReadOnlyList<YamlMappingNode> passiveNodes,
            YamlMappingNode stackOrderNode,
            YamlMappingNode actionsNode,
            YamlMappingNode combinationsNode,
            NameRegistry symbols)
        {
            var bp = new ObjectDefBlueprint { Name = name, IsSingleton = isSingleton };
            bp.TraitNames.AddRange(traitNames);

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

            bp.Actions.AddRange(ParseActions(name, actionsNode, symbols));
            bp.Combinations.AddRange(ParseCombinations(name, combinationsNode, symbols));

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

            YamlMappingNode onOverflowNode = node.TryGetMapping("on_overflow", context);
            if (onOverflowNode != null)
            {
                if (bp.Range == null)
                    throw new YamlLoadException($"{context}: on_overflowを使うには'range'が必須です。");

                bp.OnOverflow = ParseActiveEffectBody($"{context}.on_overflow", onOverflowNode, allowDragged: false, selfOnly: true);
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
                bp.OnZero = ParseActiveEffectBody($"{context}.on_zero", onZero, allowDragged: false, selfOnly: true);

            return bp;
        }

        private static PropertyValue ParseScalarPropertyValue(string raw, NameRegistry symbols)
        {
            if (int.TryParse(raw, out int number)) return PropertyValue.FromNumber(number);
            if (bool.TryParse(raw, out bool boolValue)) return PropertyValue.FromNumber(boolValue ? 1 : 0);
            return PropertyValue.FromSymbol(symbols.Intern(raw));
        }

        /// <summary>
        /// active内容（9節: set/add/destroy/spawn）を読む。文法は「操作(set/add)が上位、対象
        /// (self/parent/actor/dragged)が下位」（例: `add: {self: {hour: 1}}`）。on_zero・on_overflow
        /// （6節、selfOnly: true）、actions/combinations/pickのactive（selfOnly: false）のすべてから
        /// 共通で使う。
        ///
        /// destroyは削除対象を直接指す（`destroy: self`、または複数対象なら`destroy: [self, dragged]`）。
        /// spawnは常にselfが実行するものとみなすため対象キーを持たない（対象別のラップを挟まない）。
        /// </summary>
        private static ActiveEffectBlueprint ParseActiveEffectBody(
            string context, YamlMappingNode bodyNode, bool allowDragged, bool selfOnly)
        {
            var bp = new ActiveEffectBlueprint();

            YamlMappingNode setMap = bodyNode.TryGetMapping("set", context);
            if (setMap != null)
                foreach (var (targetName, targetBody) in setMap.EntriesInOrder())
                {
                    ReferenceRoot target = ParseActiveTargetKey($"{context}.set", targetName, allowDragged, selfOnly);
                    var assigns = new List<AssignBlueprint>();
                    foreach (var (propName, valueNode) in ((YamlMappingNode)targetBody).EntriesInOrder())
                        assigns.Add(new AssignBlueprint { PropertyName = propName, Value = int.Parse(((YamlScalarNode)valueNode).Value) });
                    bp.Sets[target] = assigns;
                }

            YamlMappingNode addMap = bodyNode.TryGetMapping("add", context);
            if (addMap != null)
                foreach (var (targetName, targetBody) in addMap.EntriesInOrder())
                {
                    ReferenceRoot target = ParseActiveTargetKey($"{context}.add", targetName, allowDragged, selfOnly);
                    var adds = new List<AddBlueprint>();
                    foreach (var (propName, amountNode) in ((YamlMappingNode)targetBody).EntriesInOrder())
                        adds.Add(new AddBlueprint { PropertyName = propName, Amount = int.Parse(((YamlScalarNode)amountNode).Value) });
                    bp.Adds[target] = adds;
                }

            YamlNode destroyNode = bodyNode.TryGet("destroy");
            if (destroyNode != null)
                bp.Destroy.AddRange(ParseDestroyTargets($"{context}.destroy", destroyNode, allowDragged, selfOnly));

            YamlMappingNode spawn = bodyNode.TryGetMapping("spawn", context);
            if (spawn != null)
            {
                string into = spawn.TryGetScalar("into", context);
                bp.Spawn = new SpawnBlueprint
                {
                    ObjectName = spawn.RequireScalar("object", context),
                    Into = ParseSpawnTargetRoot(context, into),
                };
            }

            var unknownKeys = bodyNode.EntriesInOrder().Select(e => e.Key)
                .Where(k => k != "set" && k != "add" && k != "destroy" && k != "spawn").ToList();
            if (unknownKeys.Count > 0)
                throw new YamlLoadException($"{context}: 未知のキー '{string.Join(", ", unknownKeys)}' です。");

            return bp;
        }

        /// <summary>
        /// set/add/destroyの対象キー（self/parent/actor、combinations内はdraggedも）を解決する。childは、
        /// 一度きりの命令に対して「どの子か」の意味がまだ確定していないため未対応（passiveのchild寄与とは
        /// 異なり、activeのchildには関係とゲートに基づく登録の仕組みが無いため、対象を一意に絞る規約が無い）。
        /// selfOnlyの場合（on_zero・on_overflow）はself以外を一律エラーにする。
        /// </summary>
        private static ReferenceRoot ParseActiveTargetKey(string context, string key, bool allowDragged, bool selfOnly)
        {
            if (selfOnly && key != "self")
                throw new YamlLoadException($"{context}: 現時点でselfのみ対応しています（未対応: '{key}'）。");

            switch (key)
            {
                case "self": return ReferenceRoot.Self;
                case "parent": return ReferenceRoot.Parent;
                case "actor": return ReferenceRoot.Actor;
                case "dragged":
                    if (!allowDragged)
                        throw new YamlLoadException($"{context}: 'dragged'はcombinationsの中でのみ使えます。");
                    return ReferenceRoot.Dragged;
                case "child":
                    throw new YamlLoadException(
                        $"{context}: activeの対象'child'は未対応です（一度きりの命令に対して『どの子か』の意味が確定していないため）。");
                default:
                    throw new YamlLoadException($"{context}: 未知の対象キー '{key}' です。");
            }
        }

        /// <summary>destroy（削除対象の直接指定）を読む。単一の対象名(`destroy: self`)か、
        /// 対象名のリスト(`destroy: [self, dragged]`)のいずれかを許容する。</summary>
        private static List<ReferenceRoot> ParseDestroyTargets(string context, YamlNode node, bool allowDragged, bool selfOnly)
        {
            if (node is YamlScalarNode scalar)
                return new List<ReferenceRoot> { ParseActiveTargetKey(context, scalar.Value, allowDragged, selfOnly) };

            if (node is YamlSequenceNode seq)
                return seq.Select(n => ParseActiveTargetKey(context, ((YamlScalarNode)n).Value, allowDragged, selfOnly)).ToList();

            throw new YamlLoadException($"{context}: destroyは対象名か、対象名のリストのいずれかである必要があります。");
        }

        /// <summary>pathを"root.property"の1階層に限定して解釈する（14.1節・10.2節）。worldは唯一の
        /// シングルトンインスタンスを実行時に追跡する仕組みがまだ無いため未対応。</summary>
        private static (ReferenceRoot Root, string PropertyName) ParsePath(string context, string path)
        {
            string[] parts = path.Split('.');
            if (parts.Length != 2)
                throw new YamlLoadException($"{context}: path '{path}' は '<root>.<property>' の1階層のみ対応しています。");

            ReferenceRoot root;
            switch (parts[0])
            {
                case "self": root = ReferenceRoot.Self; break;
                case "parent": root = ReferenceRoot.Parent; break;
                case "actor": root = ReferenceRoot.Actor; break;
                case "dragged": root = ReferenceRoot.Dragged; break;
                case "world":
                    throw new YamlLoadException(
                        $"{context}: path root 'world' は未対応です（worldシングルトンインスタンスの実行時追跡が未実装のため）。");
                default:
                    throw new YamlLoadException($"{context}: 未知のpath root '{parts[0]}' です。");
            }

            return (root, parts[1]);
        }

        private static List<ConditionBlueprint> ParseConditions(string context, YamlSequenceNode conditionsNode, NameRegistry symbols)
        {
            var result = new List<ConditionBlueprint>();
            if (conditionsNode == null) return result;

            foreach (YamlNode node in conditionsNode)
            {
                var map = (YamlMappingNode)node;
                string conditionContext = $"{context}.conditions[{result.Count}]";

                string path = map.RequireScalar("path", conditionContext);
                ConditionOp op = ParseConditionOp(conditionContext, map.RequireScalar("op", conditionContext));

                YamlNode valueNode = map.TryGet("value");
                if (valueNode == null)
                    throw new YamlLoadException($"{conditionContext}: 必須フィールド 'value' がありません。");

                var (root, propertyName) = ParsePath(conditionContext, path);

                var condition = new ConditionBlueprint { Root = root, PropertyName = propertyName, Op = op };
                condition.Values.AddRange(ParseConditionValues(conditionContext, op, valueNode, symbols));
                result.Add(condition);
            }

            return result;
        }

        private static ConditionOp ParseConditionOp(string context, string raw)
        {
            switch (raw)
            {
                case "lt": return ConditionOp.Lt;
                case "lte": return ConditionOp.Lte;
                case "gt": return ConditionOp.Gt;
                case "gte": return ConditionOp.Gte;
                case "eq": return ConditionOp.Eq;
                case "neq": return ConditionOp.Neq;
                case "in": return ConditionOp.In;
                case "not_in": return ConditionOp.NotIn;
                default: throw new YamlLoadException($"{context}: 未知のop '{raw}' です。");
            }
        }

        private static List<PropertyValue> ParseConditionValues(string context, ConditionOp op, YamlNode valueNode, NameRegistry symbols)
        {
            bool isList = op == ConditionOp.In || op == ConditionOp.NotIn;

            if (isList)
            {
                if (!(valueNode is YamlSequenceNode seq))
                    throw new YamlLoadException($"{context}: op '{op}' のvalueは配列である必要があります。");
                return seq.Select(n => ParseConditionScalar(context, ((YamlScalarNode)n).Value, symbols)).ToList();
            }

            if (!(valueNode is YamlScalarNode scalar))
                throw new YamlLoadException($"{context}: valueはスカラー値である必要があります。");

            return new List<PropertyValue> { ParseConditionScalar(context, scalar.Value, symbols) };
        }

        private static PropertyValue ParseConditionScalar(string context, string raw, NameRegistry symbols)
        {
            if (raw == "max" || raw == "min")
                throw new YamlLoadException(
                    $"{context}: value '{raw}' は未対応です（参照先プロパティのrangeの{raw}を指す規約がまだ確定していないため）。");

            return ParseScalarPropertyValue(raw, symbols);
        }

        private static WeightBlueprint ParseWeight(string context, YamlNode node)
        {
            if (node is YamlScalarNode scalar)
            {
                if (!double.TryParse(scalar.Value, out double literal))
                    throw new YamlLoadException($"{context}: weightは数値である必要があります（値: '{scalar.Value}'）。");
                return new WeightBlueprint { IsPathRef = false, Literal = literal };
            }

            if (node is YamlMappingNode map)
            {
                string path = map.RequireScalar("path", context);
                var (root, propertyName) = ParsePath(context, path);
                return new WeightBlueprint { IsPathRef = true, PathRoot = root, PathPropertyName = propertyName };
            }

            throw new YamlLoadException($"{context}: weightはリテラル数値か{{path: ...}}のいずれかである必要があります。");
        }

        private static List<PickCandidateBlueprint> ParsePickList(
            string context, YamlSequenceNode pickNode, bool allowDragged, NameRegistry symbols)
        {
            var result = new List<PickCandidateBlueprint>();

            foreach (YamlNode node in pickNode)
            {
                var map = (YamlMappingNode)node;
                string candidateContext = $"{context}.pick[{result.Count}]";

                YamlNode weightNode = map.TryGet("weight");
                if (weightNode == null) throw new YamlLoadException($"{candidateContext}: 'weight'は必須です。");

                var candidate = new PickCandidateBlueprint { Weight = ParseWeight(candidateContext, weightNode) };

                YamlMappingNode activeMap = map.TryGetMapping("active", candidateContext);
                YamlSequenceNode nestedPick = map.TryGetSequence("pick", candidateContext);

                if (activeMap != null && nestedPick != null)
                    throw new YamlLoadException($"{candidateContext}: 'active'と'pick'は同時に指定できません。");
                if (activeMap == null && nestedPick == null)
                    throw new YamlLoadException($"{candidateContext}: 'active'または'pick'のいずれかが必要です。");

                if (activeMap != null) candidate.Active = ParseActiveEffectBody(candidateContext, activeMap, allowDragged, selfOnly: false);
                if (nestedPick != null) candidate.Pick = ParsePickList(candidateContext, nestedPick, allowDragged, symbols);

                result.Add(candidate);
            }

            return result;
        }

        /// <summary>actions_map（11節）を読む。dragged対象はメニュー型操作では意味を持たないため不可。</summary>
        public static List<ActionBlueprint> ParseActions(string objectDefName, YamlMappingNode actionsNode, NameRegistry symbols)
        {
            var result = new List<ActionBlueprint>();
            if (actionsNode == null) return result;

            foreach (var (name, node) in actionsNode.EntriesInOrder())
            {
                string context = $"'{objectDefName}'.actions.'{name}'";
                var map = (YamlMappingNode)node;

                var action = new ActionBlueprint { Name = name };

                string showMenu = map.TryGetScalar("showMenu", context);
                if (showMenu != null && showMenu != "always")
                    throw new YamlLoadException($"{context}: showMenuは現時点で'always'のみ対応しています（値: '{showMenu}'）。");

                action.Conditions.AddRange(ParseConditions(context, map.TryGetSequence("conditions", context), symbols));

                YamlMappingNode activeMap = map.TryGetMapping("active", context);
                YamlSequenceNode pickList = map.TryGetSequence("pick", context);
                if (activeMap != null && pickList != null)
                    throw new YamlLoadException($"{context}: 'active'と'pick'は同時に指定できません。");

                if (activeMap != null) action.Active = ParseActiveEffectBody(context, activeMap, allowDragged: false, selfOnly: false);
                if (pickList != null) action.Pick = ParsePickList(context, pickList, allowDragged: false, symbols);

                result.Add(action);
            }

            return result;
        }

        /// <summary>combinations_map（12節）を読む。dragged対象を使える。</summary>
        public static List<CombinationBlueprint> ParseCombinations(
            string objectDefName, YamlMappingNode combinationsNode, NameRegistry symbols)
        {
            var result = new List<CombinationBlueprint>();
            if (combinationsNode == null) return result;

            foreach (var (name, node) in combinationsNode.EntriesInOrder())
            {
                string context = $"'{objectDefName}'.combinations.'{name}'";
                var map = (YamlMappingNode)node;

                var combination = new CombinationBlueprint { Name = name, With = map.RequireScalar("with", context) };

                combination.Conditions.AddRange(ParseConditions(context, map.TryGetSequence("conditions", context), symbols));

                YamlMappingNode activeMap = map.TryGetMapping("active", context);
                YamlSequenceNode pickList = map.TryGetSequence("pick", context);
                if (activeMap != null && pickList != null)
                    throw new YamlLoadException($"{context}: 'active'と'pick'は同時に指定できません。");

                if (activeMap != null) combination.Active = ParseActiveEffectBody(context, activeMap, allowDragged: true, selfOnly: false);
                if (pickList != null) combination.Pick = ParsePickList(context, pickList, allowDragged: true, symbols);

                result.Add(combination);
            }

            return result;
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

            var whenByTarget = new Dictionary<string, string>();
            YamlMappingNode whenMap = passiveMap.TryGetMapping("when", context);
            if (whenMap != null)
                foreach (var (targetName, slotNode) in whenMap.EntriesInOrder())
                    whenByTarget[targetName] = ((YamlScalarNode)slotNode).Value;

            ParsePassiveOperationInto(
                output, context, passiveMap, "modify", ContributionKind.Modify,
                whenByTarget, forcedGate, forcedStageProperty, forcedStageName);
            ParsePassiveOperationInto(
                output, context, passiveMap, "accumulate", ContributionKind.Accumulate,
                whenByTarget, forcedGate, forcedStageProperty, forcedStageName);

            var unknownKeys = passiveMap.EntriesInOrder().Select(e => e.Key)
                .Where(k => k != "when" && k != "modify" && k != "accumulate").ToList();
            if (unknownKeys.Count > 0)
                throw new YamlLoadException($"{context}: 未知のキー '{string.Join(", ", unknownKeys)}' です。");
        }

        /// <summary>
        /// passiveの1操作(modify/accumulate)を読み、対象(self/parent/child、actorは未対応のため
        /// スキップ)ごとにContributionBlueprintへ変換してoutputへ追加する。ゲートは、同じpassiveブロック内
        /// の"when"（対象ごとの辞書）から対応する対象のスロット名を引く。forcedGateがWhenOwnStageの場合、
        /// "when"は無視し（1つのContributionは単一のゲート種別しか表現できないため）、常にそのステージの
        /// ゲートを使う。
        /// </summary>
        private static void ParsePassiveOperationInto(
            List<ContributionBlueprint> output, string context, YamlMappingNode passiveMap,
            string operationKey, ContributionKind kind, Dictionary<string, string> whenByTarget,
            ContributionGateKind? forcedGate, string forcedStageProperty, string forcedStageName)
        {
            YamlMappingNode operationMap = passiveMap.TryGetMapping(operationKey, context);
            if (operationMap == null) return;

            foreach (var (targetName, bodyNode) in operationMap.EntriesInOrder())
            {
                if (targetName == "actor") continue; // 未対応（ContributionTargetにActorが無いため）

                ContributionTarget target;
                switch (targetName)
                {
                    case "self": target = ContributionTarget.Self; break;
                    case "parent": target = ContributionTarget.Parent; break;
                    case "child": target = ContributionTarget.Child; break;
                    default:
                        throw new YamlLoadException($"{context}.{operationKey}: 未知の対象キー '{targetName}' です。");
                }

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
                else if (whenByTarget.TryGetValue(targetName, out string slotName))
                {
                    gateKind = ContributionGateKind.WhenSlot;
                    gateSlotName = slotName;
                }
                else
                {
                    gateKind = ContributionGateKind.Always;
                }

                var body = (YamlMappingNode)bodyNode;
                foreach (var (propName, amountNode) in body.EntriesInOrder())
                    output.Add(new ContributionBlueprint
                    {
                        Target = target,
                        Kind = kind,
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
