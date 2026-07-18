using System.Collections.Generic;
using System.Linq;
using UnmappedIsland.Codex;
using UnmappedIsland.Runtime;
using YamlDotNet.RepresentationModel;

namespace UnmappedIsland.Loader
{
    /// <summary>
    /// 既にtrait解決済み（TraitMerger参照）の props/slots/passives/stack_order ノードから、
    /// ObjectDefBlueprintを組み立てる。GameElementDefinition.md 6〜7節・7.6節に対応する。
    ///
    /// 未対応（現時点ではCodex側にビルド先の型が無いため意図的にスキップする）:
    /// traits/actions/combinations/recipes/covers/layer、passivesのactor対象、on_min/on_max/on_overflow/on_shortfall
    /// のself以外の対象。
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
                ParsePassiveMapInto(bp.Contributions, name, passiveNode, forcedGate: null, forcedStageProperty: null, forcedStageName: null, symbols);

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

            YamlMappingNode onShortfallNode = node.TryGetMapping("on_shortfall", context);
            if (onShortfallNode != null)
            {
                if (bp.Range == null)
                    throw new YamlLoadException($"{context}: on_shortfallを使うには'range'が必須です。");

                bp.OnShortfall = ParseActiveEffectBody($"{context}.on_shortfall", onShortfallNode, allowDragged: false, selfOnly: true);
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

                    // stage自身がname/minという固有の属性を持つため配列にできず、passivesは専用の
                    // ネストしたキーのまま持つ（when違いの複数ブロックを書けるようにするため常に配列）。
                    YamlSequenceNode stagePassives = stageMap.TryGetSequence("passives", context);
                    if (stagePassives != null)
                        foreach (YamlNode passiveNode in stagePassives)
                            ParsePassiveMapInto(owner.Contributions, objectDefName, (YamlMappingNode)passiveNode,
                                forcedGate: ContributionGateKind.WhenOwnStage, forcedStageProperty: propName, forcedStageName: stageName, symbols);
                }
            }

            YamlSequenceNode propPassives = node.TryGetSequence("passives", context);
            if (propPassives != null)
                foreach (YamlNode passiveNode in propPassives)
                    ParsePassiveMapInto(owner.Contributions, objectDefName, (YamlMappingNode)passiveNode,
                        forcedGate: null, forcedStageProperty: null, forcedStageName: null, symbols);

            YamlMappingNode onMin = node.TryGetMapping("on_min", context);
            if (onMin != null)
            {
                if (bp.Range == null)
                    throw new YamlLoadException($"{context}: on_minを使うには'range'が必須です。");

                bp.OnMin = ParseActiveEffectBody($"{context}.on_min", onMin, allowDragged: false, selfOnly: true);
            }

            YamlMappingNode onMax = node.TryGetMapping("on_max", context);
            if (onMax != null)
            {
                if (bp.Range == null)
                    throw new YamlLoadException($"{context}: on_maxを使うには'range'が必須です。");

                bp.OnMax = ParseActiveEffectBody($"{context}.on_max", onMax, allowDragged: false, selfOnly: true);
            }

            return bp;
        }

        private static PropertyValue ParseScalarPropertyValue(string raw, NameRegistry symbols)
        {
            if (int.TryParse(raw, out int number)) return PropertyValue.FromNumber(number);
            if (bool.TryParse(raw, out bool boolValue)) return PropertyValue.FromNumber(boolValue ? 1 : 0);
            return PropertyValue.FromSymbol(symbols.Intern(raw));
        }

        /// <summary>activeの内容(set/add/destroy/spawn)を1つも持たないキー集合。actions/combinations/pickの
        /// 各エントリは、専用の"active"キーを介さずshowMenu/conditions/with/weight/pickと対等な兄弟キーとして
        /// set/add/destroy/spawnを直接持つため、「activeとして何か書かれているか」をこの4キーの有無で判定する。</summary>
        private static readonly string[] ActiveVerbKeys = { "set", "add", "destroy", "spawn" };

        private static bool HasActiveContent(YamlMappingNode map) =>
            ActiveVerbKeys.Any(key => map.TryGet(key) != null);

        /// <summary>
        /// active内容（9節: set/add/destroy/spawn）を読む。文法は「操作(set/add)が上位、対象
        /// (self/parent/actor/dragged)が下位」（例: `add: {self: {hour: 1}}`）。on_min・on_max・on_overflow・
        /// on_shortfall（6節、selfOnly: true）は専用キー配下でこの形をそのまま持つ。actions/combinations/pick
        /// （selfOnly: false）は"active"というラップを挟まず、showMenu/conditions/with/weight/pickと対等な
        /// 兄弟キーとしてこの形を直接持つため、bodyNodeにはそれら他のキーも同居する。reservedKeysには、
        /// そうした「activeとは無関係な、呼び出し側がすでに読み終えている兄弟キー」を渡し、未知キー判定から除外する。
        ///
        /// destroyは削除対象を直接指す（`destroy: self`、または複数対象なら`destroy: [self, dragged]`）。
        /// spawnは常にselfが実行するものとみなすため対象キーを持たない（対象別のラップを挟まない）。
        /// </summary>
        private static ActiveEffectBlueprint ParseActiveEffectBody(
            string context, YamlMappingNode bodyNode, bool allowDragged, bool selfOnly,
            IReadOnlyCollection<string> reservedKeys = null)
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

            var knownKeys = new HashSet<string>(ActiveVerbKeys);
            if (reservedKeys != null) knownKeys.UnionWith(reservedKeys);

            var unknownKeys = bodyNode.EntriesInOrder().Select(e => e.Key)
                .Where(k => !knownKeys.Contains(k)).ToList();
            if (unknownKeys.Count > 0)
                throw new YamlLoadException($"{context}: 未知のキー '{string.Join(", ", unknownKeys)}' です。");

            return bp;
        }

        /// <summary>
        /// set/add/destroyの対象キー（self/parent/actor、combinations内はdraggedも）を解決する。childは、
        /// 一度きりの命令に対して「どの子か」の意味がまだ確定していないため未対応（passiveのchild寄与とは
        /// 異なり、activeのchildには関係とゲートに基づく登録の仕組みが無いため、対象を一意に絞る規約が無い）。
        /// selfOnlyの場合（on_min・on_max・on_overflow・on_shortfall）はself以外を一律エラーにする。
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

        /// <summary>conditions（14節）・passivesのゲート（旧when、8節）が共通で使うobject参照キー。
        /// worldは唯一のシングルトンインスタンスを実行時に追跡する仕組みがまだ無いため未対応。</summary>
        private static ReferenceRoot ParseConditionObject(string context, string raw, IReadOnlyCollection<ReferenceRoot> allowedRoots)
        {
            ReferenceRoot root;
            switch (raw)
            {
                case "self": root = ReferenceRoot.Self; break;
                case "parent": root = ReferenceRoot.Parent; break;
                case "actor": root = ReferenceRoot.Actor; break;
                case "dragged": root = ReferenceRoot.Dragged; break;
                case "world":
                    throw new YamlLoadException(
                        $"{context}: object 'world' は未対応です（worldシングルトンインスタンスの実行時追跡が未実装のため）。");
                default:
                    throw new YamlLoadException($"{context}: 未知のobject '{raw}' です。");
            }

            if (!allowedRoots.Contains(root))
                throw new YamlLoadException($"{context}: この文脈でobject '{raw}' は使えません。");

            return root;
        }

        private static readonly HashSet<ReferenceRoot> ActionConditionRoots =
            new HashSet<ReferenceRoot> { ReferenceRoot.Self, ReferenceRoot.Parent, ReferenceRoot.Actor };

        private static readonly HashSet<ReferenceRoot> CombinationConditionRoots =
            new HashSet<ReferenceRoot> { ReferenceRoot.Self, ReferenceRoot.Parent, ReferenceRoot.Actor, ReferenceRoot.Dragged };

        /// <summary>passivesのゲート（旧when）で使えるobject。selfはSlotBearer（8節の効果を宣言した側の
        /// スロット位置）、parentはその1つ上（Runtime.ActiveContribution参照）。actor/draggedは持続的な
        /// 関係に紐づかないため未対応。</summary>
        private static readonly HashSet<ReferenceRoot> PassiveConditionRoots =
            new HashSet<ReferenceRoot> { ReferenceRoot.Self, ReferenceRoot.Parent };

        /// <summary>
        /// conditions（14節）の値。常にYAML配列（暗黙のall）。要素は葉（{object, prop, op, value}か
        /// {object, slot}）か、入れ子のall/any/notのいずれか。conditionsNodeがnullなら省略（常に真）。
        /// </summary>
        private static ConditionNodeBlueprint ParseConditionsField(
            string context, YamlSequenceNode conditionsNode, IReadOnlyCollection<ReferenceRoot> allowedRoots, NameRegistry symbols)
        {
            if (conditionsNode == null) return null;

            var children = new List<ConditionNodeBlueprint>();
            foreach (YamlNode node in conditionsNode)
                children.Add(ParseConditionNode($"{context}.conditions[{children.Count}]", node, allowedRoots, symbols));

            return new ConditionNodeBlueprint { Kind = ConditionNodeBlueprintKind.All, Children = children };
        }

        /// <summary>条件木の1ノードを読む。all/any/notのいずれかのキーを持てば複合ノード、それ以外は
        /// 葉（プロパティ比較かスロット判定のいずれか）として読む。</summary>
        private static ConditionNodeBlueprint ParseConditionNode(
            string context, YamlNode node, IReadOnlyCollection<ReferenceRoot> allowedRoots, NameRegistry symbols)
        {
            var map = (YamlMappingNode)node;

            YamlSequenceNode allNode = map.TryGetSequence("all", context);
            YamlSequenceNode anyNode = map.TryGetSequence("any", context);
            YamlNode notNode = map.TryGet("not");

            int combinatorCount = (allNode != null ? 1 : 0) + (anyNode != null ? 1 : 0) + (notNode != null ? 1 : 0);
            if (combinatorCount > 1)
                throw new YamlLoadException($"{context}: all/any/notは同時に指定できません。");

            if (allNode != null) return ParseCombinator(context, "all", allNode, ConditionNodeBlueprintKind.All, allowedRoots, symbols);
            if (anyNode != null) return ParseCombinator(context, "any", anyNode, ConditionNodeBlueprintKind.Any, allowedRoots, symbols);

            if (notNode != null)
            {
                var unknown = map.EntriesInOrder().Select(e => e.Key).Where(k => k != "not").ToList();
                if (unknown.Count > 0)
                    throw new YamlLoadException($"{context}: 'not'は他のキーと同居できません（値: '{string.Join(", ", unknown)}'）。");

                var inner = ParseConditionNode($"{context}.not", notNode, allowedRoots, symbols);
                return new ConditionNodeBlueprint
                {
                    Kind = ConditionNodeBlueprintKind.Not,
                    Children = new List<ConditionNodeBlueprint> { inner },
                };
            }

            return ParseConditionLeaf(context, map, allowedRoots, symbols);
        }

        private static ConditionNodeBlueprint ParseCombinator(
            string context, string key, YamlSequenceNode seq, ConditionNodeBlueprintKind kind,
            IReadOnlyCollection<ReferenceRoot> allowedRoots, NameRegistry symbols)
        {
            var children = new List<ConditionNodeBlueprint>();
            foreach (YamlNode node in seq)
                children.Add(ParseConditionNode($"{context}.{key}[{children.Count}]", node, allowedRoots, symbols));
            return new ConditionNodeBlueprint { Kind = kind, Children = children };
        }

        /// <summary>
        /// 条件木の葉。objectは省略時self。{object, prop, op(省略時eq), value}のプロパティ比較か、
        /// {object, slot}のスロット判定（常に等価判定。opは持たない）のいずれかで、同時には指定できない。
        /// </summary>
        private static ConditionNodeBlueprint ParseConditionLeaf(
            string context, YamlMappingNode map, IReadOnlyCollection<ReferenceRoot> allowedRoots, NameRegistry symbols)
        {
            string objectName = map.TryGetScalar("object", context);
            ReferenceRoot root = objectName != null ? ParseConditionObject(context, objectName, allowedRoots) : ReferenceRoot.Self;

            string slotName = map.TryGetScalar("slot", context);
            string propName = map.TryGetScalar("prop", context);

            if (slotName != null && propName != null)
                throw new YamlLoadException($"{context}: 'slot'と'prop'は同時に指定できません。");

            if (slotName != null)
            {
                var unknownSlotKeys = map.EntriesInOrder().Select(e => e.Key)
                    .Where(k => k != "object" && k != "slot").ToList();
                if (unknownSlotKeys.Count > 0)
                    throw new YamlLoadException(
                        $"{context}: 未知のキー '{string.Join(", ", unknownSlotKeys)}' です（slot判定はobject/slotのみ持てます）。");

                return new ConditionNodeBlueprint { Kind = ConditionNodeBlueprintKind.Slot, Root = root, SlotName = slotName };
            }

            if (propName == null)
                throw new YamlLoadException($"{context}: 'prop'または'slot'のいずれかが必要です。");

            ConditionOp op = ConditionOp.Eq;
            string rawOp = map.TryGetScalar("op", context);
            if (rawOp != null) op = ParseConditionOp(context, rawOp);

            YamlNode valueNode = map.TryGet("value");
            if (valueNode == null)
                throw new YamlLoadException($"{context}: 必須フィールド 'value' がありません。");

            var unknownKeys = map.EntriesInOrder().Select(e => e.Key)
                .Where(k => k != "object" && k != "prop" && k != "op" && k != "value").ToList();
            if (unknownKeys.Count > 0)
                throw new YamlLoadException($"{context}: 未知のキー '{string.Join(", ", unknownKeys)}' です。");

            var leaf = new ConditionNodeBlueprint { Kind = ConditionNodeBlueprintKind.Property, Root = root, PropertyName = propName, Op = op };
            leaf.Values.AddRange(ParseConditionValues(context, op, valueNode, symbols));
            return leaf;
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

        private static WeightBlueprint ParseWeight(string context, YamlNode node, bool allowDragged)
        {
            if (node is YamlScalarNode scalar)
            {
                if (!double.TryParse(scalar.Value, out double literal))
                    throw new YamlLoadException($"{context}: weightは数値である必要があります（値: '{scalar.Value}'）。");
                return new WeightBlueprint { IsPathRef = false, Literal = literal };
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

                return new WeightBlueprint { IsPathRef = true, PathRoot = root, PathPropertyName = propName };
            }

            throw new YamlLoadException($"{context}: weightはリテラル数値か{{object, prop}}のいずれかである必要があります。");
        }

        /// <summary>pick候補が持つ、weight/pick以外の兄弟キー（set/add/destroy/spawn）。</summary>
        private static readonly string[] PickCandidateReservedKeys = { "weight", "pick" };

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

                var candidate = new PickCandidateBlueprint { Weight = ParseWeight(candidateContext, weightNode, allowDragged) };

                bool hasActive = HasActiveContent(map);
                YamlSequenceNode nestedPick = map.TryGetSequence("pick", candidateContext);

                if (hasActive && nestedPick != null)
                    throw new YamlLoadException($"{candidateContext}: set/add/destroy/spawnとpickは同時に指定できません。");
                if (!hasActive && nestedPick == null)
                    throw new YamlLoadException($"{candidateContext}: set/add/destroy/spawnのいずれか、またはpickが必要です。");

                if (hasActive)
                    candidate.Active = ParseActiveEffectBody(candidateContext, map, allowDragged, selfOnly: false, PickCandidateReservedKeys);
                if (nestedPick != null) candidate.Pick = ParsePickList(candidateContext, nestedPick, allowDragged, symbols);

                result.Add(candidate);
            }

            return result;
        }

        /// <summary>actionエントリが持つ、showMenu/conditions/pick以外の兄弟キー（set/add/destroy/spawn）。</summary>
        private static readonly string[] ActionReservedKeys = { "showMenu", "conditions", "pick" };

        /// <summary>combinationエントリが持つ、with/conditions/pick以外の兄弟キー（set/add/destroy/spawn）。</summary>
        private static readonly string[] CombinationReservedKeys = { "with", "conditions", "pick" };

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

                action.Conditions = ParseConditionsField(context, map.TryGetSequence("conditions", context), ActionConditionRoots, symbols);

                bool hasActive = HasActiveContent(map);
                YamlSequenceNode pickList = map.TryGetSequence("pick", context);
                if (hasActive && pickList != null)
                    throw new YamlLoadException($"{context}: set/add/destroy/spawnとpickは同時に指定できません。");

                if (hasActive) action.Active = ParseActiveEffectBody(context, map, allowDragged: false, selfOnly: false, ActionReservedKeys);
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

                combination.Conditions = ParseConditionsField(context, map.TryGetSequence("conditions", context), CombinationConditionRoots, symbols);

                bool hasActive = HasActiveContent(map);
                YamlSequenceNode pickList = map.TryGetSequence("pick", context);
                if (hasActive && pickList != null)
                    throw new YamlLoadException($"{context}: set/add/destroy/spawnとpickは同時に指定できません。");

                if (hasActive) combination.Active = ParseActiveEffectBody(context, map, allowDragged: true, selfOnly: false, CombinationReservedKeys);
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
        /// passivesの1ブロック（self/parent/child、actorは未対応のためスキップ）を読み、ContributionBlueprint
        /// へ変換してoutputへ追加する。forcedGateがWhenOwnStageの場合、このブロックの"conditions"は
        /// stage内では併用できない（1つのContributionは単一のゲート種別しか表現できないため。
        /// ステージ自体の条件との組み合わせはGameElementDefinition.md 17節で未解決のまま）。
        ///
        /// オブジェクトレベル・プロパティレベル・stage内のいずれも、"passives:"は常に配列であり、
        /// この関数はその配列の1要素（conditions/modify/accumulateのみを持つ、他のキーとは同居しない
        /// 独立したマッピング）に対して呼ばれる。conditionsはブロック全体で1つ（対象ごとには持たない。
        /// self対象・parent対象は常に同じSlotBearerを指すため、対象ごとに持たせても意味が重複するだけ。
        /// Runtime.ActiveContribution参照）。
        /// </summary>
        private static void ParsePassiveMapInto(
            List<ContributionBlueprint> output, string objectDefName, YamlMappingNode passiveMap,
            ContributionGateKind? forcedGate, string forcedStageProperty, string forcedStageName, NameRegistry symbols)
        {
            string context = $"'{objectDefName}'.passives";
            bool isStageForced = forcedGate == ContributionGateKind.WhenOwnStage;

            YamlSequenceNode conditionsNode = passiveMap.TryGetSequence("conditions", context);
            if (isStageForced && conditionsNode != null)
                throw new YamlLoadException(
                    $"{context}: stage内のpassivesでは'conditions'を併用できません" +
                    "（ステージ自体の条件との組み合わせは未対応。GameElementDefinition.md 17節）。");

            ConditionNodeBlueprint conditions = isStageForced
                ? null
                : ParseConditionsField(context, conditionsNode, PassiveConditionRoots, symbols);

            ParsePassiveOperationInto(
                output, context, passiveMap, "modify", ContributionKind.Modify,
                conditions, forcedGate, forcedStageProperty, forcedStageName);
            ParsePassiveOperationInto(
                output, context, passiveMap, "accumulate", ContributionKind.Accumulate,
                conditions, forcedGate, forcedStageProperty, forcedStageName);

            var knownKeys = new HashSet<string> { "conditions", "modify", "accumulate" };

            var unknownKeys = passiveMap.EntriesInOrder().Select(e => e.Key)
                .Where(k => !knownKeys.Contains(k)).ToList();
            if (unknownKeys.Count > 0)
                throw new YamlLoadException($"{context}: 未知のキー '{string.Join(", ", unknownKeys)}' です。");
        }

        /// <summary>
        /// passiveの1操作(modify/accumulate)を読み、対象(self/parent/child、actorは未対応のため
        /// スキップ)ごとにContributionBlueprintへ変換してoutputへ追加する。ゲートは、同じpassiveブロック内
        /// の"conditions"（ブロック全体で1つ）をそのまま使う。forcedGateがWhenOwnStageの場合、常に
        /// そのステージのゲートを使う（conditionsはnullであることが呼び出し側で保証されている）。
        /// </summary>
        private static void ParsePassiveOperationInto(
            List<ContributionBlueprint> output, string context, YamlMappingNode passiveMap,
            string operationKey, ContributionKind kind, ConditionNodeBlueprint conditions,
            ContributionGateKind? forcedGate, string forcedStageProperty, string forcedStageName)
        {
            YamlMappingNode operationMap = passiveMap.TryGetMapping(operationKey, context);
            if (operationMap == null) return;

            bool isWhenOwnStage = forcedGate == ContributionGateKind.WhenOwnStage;

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

                var body = (YamlMappingNode)bodyNode;
                foreach (var (propName, amountNode) in body.EntriesInOrder())
                    output.Add(new ContributionBlueprint
                    {
                        Target = target,
                        Kind = kind,
                        TargetPropertyName = propName,
                        Amount = int.Parse(((YamlScalarNode)amountNode).Value),
                        Conditions = conditions,
                        IsWhenOwnStage = isWhenOwnStage,
                        GateStagePropertyName = forcedStageProperty,
                        GateStageName = forcedStageName,
                    });
            }
        }
    }
}
