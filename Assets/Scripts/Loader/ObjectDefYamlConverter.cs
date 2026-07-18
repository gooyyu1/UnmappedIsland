using System.Collections.Generic;
using System.Linq;
using UnmappedIsland.Codex;
using UnmappedIsland.Runtime;
using YamlDotNet.RepresentationModel;

namespace UnmappedIsland.Loader
{
    /// <summary>
    /// 既にtrait解決済み（TraitMerger参照）の props/slots/passives/stack_order/actions/combinations ノードから、
    /// 最終的な ObjectDef を直接組み立てる（GameElementDefinition.md 6〜7節・7.6節に対応）。
    ///
    /// 名前（プロパティ名・スロット名・object名）は、このパース処理そのものの中で NameRegistry.Intern を
    /// 呼んで都度グローバルIDへ解決する。Internは冪等（同じ名前なら何度呼んでも同じIDを返す）なため、
    /// 「先に全object_defを走査してから初めて名前解決を始める」といった2パス構成は不要（かつては
    /// ObjectDefBlueprintという中間データ経由の2段構成だったが、Internの冪等性を踏まえてこの1段構成に
    /// 統合した）。
    ///
    /// 未対応（現時点ではCodex側にビルド先の型が無いため意図的にスキップする）:
    /// recipes/covers/layer、passivesのactor対象、on_min/on_max/on_overflow/on_shortfallのself以外の対象。
    /// </summary>
    internal static class ObjectDefYamlConverter
    {
        /// <summary>
        /// passives（8節）の1つの寄与を、まだグローバルIDへ解決していない状態で運ぶ、このクラス内だけの
        /// 一時データ。WhenOwnStageゲートの解決（Declarer自身のstages参照）には、このobject_def自身の
        /// PropertyDefがすべて出来上がっている必要があるため、props解析の完了後にまとめて解決する
        /// （BuildPassiveEffect参照）。公開されるBlueprint型とは異なり、この関数呼び出しの外には出ない。
        /// </summary>
        private readonly struct RawPassiveEffect
        {
            public readonly PassiveEffectTarget Target;
            public readonly PassiveEffectKind Kind;
            public readonly string TargetPropertyName;
            public readonly int Amount;
            public readonly ConditionNode Conditions;
            public readonly bool IsWhenOwnStage;
            public readonly string GateStagePropertyName;
            public readonly string GateStageName;

            public RawPassiveEffect(
                PassiveEffectTarget target, PassiveEffectKind kind, string targetPropertyName, int amount,
                ConditionNode conditions, bool isWhenOwnStage, string gateStagePropertyName, string gateStageName)
            {
                Target = target;
                Kind = kind;
                TargetPropertyName = targetPropertyName;
                Amount = amount;
                Conditions = conditions;
                IsWhenOwnStage = isWhenOwnStage;
                GateStagePropertyName = gateStagePropertyName;
                GateStageName = gateStageName;
            }
        }

        public static ObjectDef Build(
            string name,
            bool isSingleton,
            IReadOnlyList<string> traitNames,
            YamlMappingNode propsNode,
            YamlMappingNode slotsNode,
            IReadOnlyList<YamlMappingNode> passiveNodes,
            YamlMappingNode stackOrderNode,
            YamlMappingNode actionsNode,
            YamlMappingNode combinationsNode,
            NameRegistry objectNames,
            NameRegistry propertyNames,
            NameRegistry slotNames)
        {
            int objectGlobalId = objectNames.Intern(name);
            var rawPassiveEffects = new List<RawPassiveEffect>();

            var propertyDefs = new List<PropertyDef>();
            if (propsNode != null)
                foreach (var (propName, propValueNode) in propsNode.EntriesInOrder())
                    propertyDefs.Add(ParseProperty(
                        name, propName, (YamlMappingNode)propValueNode, rawPassiveEffects, propertyNames, slotNames, objectNames));
            var propertyLayout = new LocalIndexMap(propertyNames.Count, propertyDefs.Select(p => p.GlobalId).ToList());

            var slotDefs = new List<SlotDef>();
            if (slotsNode != null)
                foreach (var (slotName, slotValueNode) in slotsNode.EntriesInOrder())
                    slotDefs.Add(ParseSlot(name, slotName, (YamlMappingNode)slotValueNode, slotNames));
            var slotLayout = new LocalIndexMap(slotNames.Count, slotDefs.Select(s => s.GlobalId).ToList());

            foreach (YamlMappingNode passiveNode in passiveNodes)
                ParsePassiveMapInto(
                    rawPassiveEffects, name, passiveNode, forcedGate: null, forcedStageProperty: null, forcedStageName: null,
                    propertyNames, slotNames);

            var passives = rawPassiveEffects
                .Select(c => BuildPassiveEffect(c, propertyLayout, propertyDefs, propertyNames))
                .ToList();

            StackOrderDef stackOrder = null;
            if (stackOrderNode != null)
            {
                string context = $"'{name}'.stack_order";
                stackOrder = new StackOrderDef(
                    propertyNames.Intern(stackOrderNode.RequireScalar("property", context)),
                    stackOrderNode.TryGetBool("ascending", context, fallback: false));
            }

            var actions = ParseActions(name, actionsNode, propertyNames, slotNames, objectNames);
            var combinations = ParseCombinations(name, combinationsNode, propertyNames, slotNames, objectNames);

            return new ObjectDef(
                objectGlobalId, name, isSingleton, propertyLayout, propertyDefs, slotLayout, slotDefs,
                passives, stackOrder, traitNames, actions, combinations);
        }

        private static PropertyDef ParseProperty(
            string objectDefName, string propName, YamlMappingNode node,
            List<RawPassiveEffect> rawPassiveEffects, NameRegistry propertyNames, NameRegistry slotNames, NameRegistry objectNames)
        {
            string context = $"'{objectDefName}'.props.'{propName}'";
            int propertyGlobalId = propertyNames.Intern(propName);

            YamlNode valueNode = node.TryGet("value");
            if (valueNode == null)
                throw new YamlLoadException($"{context}: 必須フィールド 'value' がありません（traitの継承先で指定してください）。");

            PropertyRange? rerollRange = null;
            int defaultNumber;
            if (valueNode is YamlMappingNode rangeValueNode)
            {
                var reroll = new PropertyRange(rangeValueNode.RequireInt("min", context), rangeValueNode.RequireInt("max", context));
                rerollRange = reroll;
                // 再ロール自体は未実装（別途）。デフォルト値は決定的にrange.Minで埋めておく。
                defaultNumber = reroll.Min;
            }
            else
            {
                defaultNumber = ParseScalarNumber(context, ((YamlScalarNode)valueNode).Value);
            }

            PropertyRange? range = null;
            YamlMappingNode rangeSpec = node.TryGetMapping("range", context);
            if (rangeSpec != null)
                range = new PropertyRange(rangeSpec.RequireInt("min", context), rangeSpec.RequireInt("max", context));

            ActiveEffect onOverflow;
            YamlMappingNode onOverflowNode = node.TryGetMapping("on_overflow", context);
            if (onOverflowNode != null)
            {
                if (range == null)
                    throw new YamlLoadException($"{context}: on_overflowを使うには'range'が必須です。");
                onOverflow = ParseActiveEffectBody($"{context}.on_overflow", onOverflowNode, allowDragged: false, selfOnly: true, propertyNames, objectNames);
            }
            else
            {
                onOverflow = range.HasValue ? BuildDefaultOverflowEffect(range.Value, propertyGlobalId, isMax: true) : null;
            }

            ActiveEffect onShortfall;
            YamlMappingNode onShortfallNode = node.TryGetMapping("on_shortfall", context);
            if (onShortfallNode != null)
            {
                if (range == null)
                    throw new YamlLoadException($"{context}: on_shortfallを使うには'range'が必須です。");
                onShortfall = ParseActiveEffectBody($"{context}.on_shortfall", onShortfallNode, allowDragged: false, selfOnly: true, propertyNames, objectNames);
            }
            else
            {
                onShortfall = range.HasValue ? BuildDefaultOverflowEffect(range.Value, propertyGlobalId, isMax: false) : null;
            }

            var stages = new List<PropertyStage>();
            YamlSequenceNode stagesNode = node.TryGetSequence("stages", context);
            if (stagesNode != null)
            {
                foreach (YamlNode stageNode in stagesNode)
                {
                    var stageMap = (YamlMappingNode)stageNode;
                    string stageName = stageMap.RequireScalar("name", context);
                    int? min = stageMap.TryGetInt("min", context);
                    stages.Add(new PropertyStage(stageName, min));

                    // stage自身がname/minという固有の属性を持つため配列にできず、passivesは専用の
                    // ネストしたキーのまま持つ（when違いの複数ブロックを書けるようにするため常に配列）。
                    YamlSequenceNode stagePassives = stageMap.TryGetSequence("passives", context);
                    if (stagePassives != null)
                        foreach (YamlNode passiveNode in stagePassives)
                            ParsePassiveMapInto(rawPassiveEffects, objectDefName, (YamlMappingNode)passiveNode,
                                forcedGate: PassiveEffectGateKind.WhenOwnStage, forcedStageProperty: propName, forcedStageName: stageName,
                                propertyNames, slotNames);
                }
            }

            YamlSequenceNode propPassives = node.TryGetSequence("passives", context);
            if (propPassives != null)
                foreach (YamlNode passiveNode in propPassives)
                    ParsePassiveMapInto(rawPassiveEffects, objectDefName, (YamlMappingNode)passiveNode,
                        forcedGate: null, forcedStageProperty: null, forcedStageName: null, propertyNames, slotNames);

            ActiveEffect onMin = null;
            YamlMappingNode onMinNode = node.TryGetMapping("on_min", context);
            if (onMinNode != null)
            {
                if (range == null)
                    throw new YamlLoadException($"{context}: on_minを使うには'range'が必須です。");
                onMin = ParseActiveEffectBody($"{context}.on_min", onMinNode, allowDragged: false, selfOnly: true, propertyNames, objectNames);
            }

            ActiveEffect onMax = null;
            YamlMappingNode onMaxNode = node.TryGetMapping("on_max", context);
            if (onMaxNode != null)
            {
                if (range == null)
                    throw new YamlLoadException($"{context}: on_maxを使うには'range'が必須です。");
                onMax = ParseActiveEffectBody($"{context}.on_max", onMaxNode, allowDragged: false, selfOnly: true, propertyNames, objectNames);
            }

            return new PropertyDef(propertyGlobalId, propName, defaultNumber, rerollRange, range, onOverflow, stages, onMin, onShortfall, onMax);
        }

        private static int ParseScalarNumber(string context, string raw)
        {
            if (int.TryParse(raw, out int number)) return number;
            if (bool.TryParse(raw, out bool boolValue)) return boolValue ? 1 : 0;
            throw new YamlLoadException($"{context}: 値 '{raw}' は整数または真偽値である必要があります（文字列値のプロパティは未対応です）。");
        }

        /// <summary>
        /// on_overflow/on_shortfallを著者が明示的に書かなかった場合の既定動作。「自分自身をRangeの境界
        /// （isMax指定側）へsetする」というActiveEffectを合成する。これにより、著者はレンジ型プロパティの
        /// クランプを`range`を書くだけで実現でき、繰り上げ等の特別な挙動が要る場合だけon_overflow/
        /// on_shortfallを明示すればよい。
        /// </summary>
        private static ActiveEffect BuildDefaultOverflowEffect(PropertyRange range, int propertyGlobalId, bool isMax)
        {
            var sets = new Dictionary<ReferenceRoot, IReadOnlyList<PropertyAssignment>>
            {
                [ReferenceRoot.Self] = new List<PropertyAssignment>
                {
                    new PropertyAssignment(propertyGlobalId, isMax ? range.Max : range.Min),
                },
            };
            var adds = new Dictionary<ReferenceRoot, IReadOnlyList<PropertyDelta>>();
            return new ActiveEffect(sets, adds, System.Array.Empty<ReferenceRoot>(), spawn: null);
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
        private static ActiveEffect ParseActiveEffectBody(
            string context, YamlMappingNode bodyNode, bool allowDragged, bool selfOnly,
            NameRegistry propertyNames, NameRegistry objectNames,
            IReadOnlyCollection<string> reservedKeys = null)
        {
            var sets = new Dictionary<ReferenceRoot, IReadOnlyList<PropertyAssignment>>();
            YamlMappingNode setMap = bodyNode.TryGetMapping("set", context);
            if (setMap != null)
                foreach (var (targetName, targetBody) in setMap.EntriesInOrder())
                {
                    ReferenceRoot target = ParseActiveTargetKey($"{context}.set", targetName, allowDragged, selfOnly);
                    var assigns = new List<PropertyAssignment>();
                    foreach (var (propName, valueNode) in ((YamlMappingNode)targetBody).EntriesInOrder())
                        assigns.Add(new PropertyAssignment(propertyNames.Intern(propName), int.Parse(((YamlScalarNode)valueNode).Value)));
                    sets[target] = assigns;
                }

            var adds = new Dictionary<ReferenceRoot, IReadOnlyList<PropertyDelta>>();
            YamlMappingNode addMap = bodyNode.TryGetMapping("add", context);
            if (addMap != null)
                foreach (var (targetName, targetBody) in addMap.EntriesInOrder())
                {
                    ReferenceRoot target = ParseActiveTargetKey($"{context}.add", targetName, allowDragged, selfOnly);
                    var deltas = new List<PropertyDelta>();
                    foreach (var (propName, amountNode) in ((YamlMappingNode)targetBody).EntriesInOrder())
                        deltas.Add(new PropertyDelta(propertyNames.Intern(propName), int.Parse(((YamlScalarNode)amountNode).Value)));
                    adds[target] = deltas;
                }

            var destroy = new List<ReferenceRoot>();
            YamlNode destroyNode = bodyNode.TryGet("destroy");
            if (destroyNode != null)
                destroy.AddRange(ParseDestroyTargets($"{context}.destroy", destroyNode, allowDragged, selfOnly));

            SpawnEffect spawn = null;
            YamlMappingNode spawnMap = bodyNode.TryGetMapping("spawn", context);
            if (spawnMap != null)
            {
                string into = spawnMap.TryGetScalar("into", context);
                spawn = new SpawnEffect(
                    objectNames.Intern(spawnMap.RequireScalar("object", context)),
                    ParseSpawnTargetRoot(context, into));
            }

            var knownKeys = new HashSet<string>(ActiveVerbKeys);
            if (reservedKeys != null) knownKeys.UnionWith(reservedKeys);

            var unknownKeys = bodyNode.EntriesInOrder().Select(e => e.Key)
                .Where(k => !knownKeys.Contains(k)).ToList();
            if (unknownKeys.Count > 0)
                throw new YamlLoadException($"{context}: 未知のキー '{string.Join(", ", unknownKeys)}' です。");

            return new ActiveEffect(sets, adds, destroy, spawn);
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
        /// スロット位置）、parentはその1つ上（Runtime.RegisteredPassiveEffect参照）。actor/draggedは持続的な
        /// 関係に紐づかないため未対応。</summary>
        private static readonly HashSet<ReferenceRoot> PassiveConditionRoots =
            new HashSet<ReferenceRoot> { ReferenceRoot.Self, ReferenceRoot.Parent };

        /// <summary>
        /// conditions（14節）の値。常にYAML配列（暗黙のall）。要素は葉（{object, prop, op, value}か
        /// {object, slot}）か、入れ子のall/any/notのいずれか。conditionsNodeがnullなら省略（常に真）。
        /// </summary>
        private static ConditionNode ParseConditionsField(
            string context, YamlSequenceNode conditionsNode, IReadOnlyCollection<ReferenceRoot> allowedRoots,
            NameRegistry propertyNames, NameRegistry slotNames)
        {
            if (conditionsNode == null) return null;

            var children = new List<ConditionNode>();
            foreach (YamlNode node in conditionsNode)
                children.Add(ParseConditionNode($"{context}.conditions[{children.Count}]", node, allowedRoots, propertyNames, slotNames));

            return ConditionNode.All(children);
        }

        /// <summary>条件木の1ノードを読む。all/any/notのいずれかのキーを持てば複合ノード、それ以外は
        /// 葉（プロパティ比較かスロット判定のいずれか）として読む。</summary>
        private static ConditionNode ParseConditionNode(
            string context, YamlNode node, IReadOnlyCollection<ReferenceRoot> allowedRoots,
            NameRegistry propertyNames, NameRegistry slotNames)
        {
            var map = (YamlMappingNode)node;

            YamlSequenceNode allNode = map.TryGetSequence("all", context);
            YamlSequenceNode anyNode = map.TryGetSequence("any", context);
            YamlNode notNode = map.TryGet("not");

            int combinatorCount = (allNode != null ? 1 : 0) + (anyNode != null ? 1 : 0) + (notNode != null ? 1 : 0);
            if (combinatorCount > 1)
                throw new YamlLoadException($"{context}: all/any/notは同時に指定できません。");

            if (allNode != null) return ConditionNode.All(ParseCombinatorChildren(context, "all", allNode, allowedRoots, propertyNames, slotNames));
            if (anyNode != null) return ConditionNode.Any(ParseCombinatorChildren(context, "any", anyNode, allowedRoots, propertyNames, slotNames));

            if (notNode != null)
            {
                var unknown = map.EntriesInOrder().Select(e => e.Key).Where(k => k != "not").ToList();
                if (unknown.Count > 0)
                    throw new YamlLoadException($"{context}: 'not'は他のキーと同居できません（値: '{string.Join(", ", unknown)}'）。");

                return ConditionNode.Not(ParseConditionNode($"{context}.not", notNode, allowedRoots, propertyNames, slotNames));
            }

            return ParseConditionLeaf(context, map, allowedRoots, propertyNames, slotNames);
        }

        private static List<ConditionNode> ParseCombinatorChildren(
            string context, string key, YamlSequenceNode seq, IReadOnlyCollection<ReferenceRoot> allowedRoots,
            NameRegistry propertyNames, NameRegistry slotNames)
        {
            var children = new List<ConditionNode>();
            foreach (YamlNode node in seq)
                children.Add(ParseConditionNode($"{context}.{key}[{children.Count}]", node, allowedRoots, propertyNames, slotNames));
            return children;
        }

        /// <summary>
        /// 条件木の葉。objectは省略時self。{object, prop, op(省略時eq), value}のプロパティ比較か、
        /// {object, slot}のスロット判定（常に等価判定。opは持たない）のいずれかで、同時には指定できない。
        /// </summary>
        private static ConditionNode ParseConditionLeaf(
            string context, YamlMappingNode map, IReadOnlyCollection<ReferenceRoot> allowedRoots,
            NameRegistry propertyNames, NameRegistry slotNames)
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

                return ConditionNode.Slot(root, slotNames.Intern(slotName));
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

            List<PropertyValue> values = ParseConditionValues(context, op, valueNode);
            return ConditionNode.Property(root, propertyNames.Intern(propName), op, values);
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

        private static List<PropertyValue> ParseConditionValues(string context, ConditionOp op, YamlNode valueNode)
        {
            bool isList = op == ConditionOp.In || op == ConditionOp.NotIn;

            if (isList)
            {
                if (!(valueNode is YamlSequenceNode seq))
                    throw new YamlLoadException($"{context}: op '{op}' のvalueは配列である必要があります。");
                return seq.Select(n => ParseConditionScalar(context, ((YamlScalarNode)n).Value)).ToList();
            }

            if (!(valueNode is YamlScalarNode scalar))
                throw new YamlLoadException($"{context}: valueはスカラー値である必要があります。");

            return new List<PropertyValue> { ParseConditionScalar(context, scalar.Value) };
        }

        private static PropertyValue ParseConditionScalar(string context, string raw)
        {
            if (raw == "max" || raw == "min")
                throw new YamlLoadException(
                    $"{context}: value '{raw}' は未対応です（参照先プロパティのrangeの{raw}を指す規約がまだ確定していないため）。");

            return PropertyValue.FromNumber(ParseScalarNumber(context, raw));
        }

        private static WeightSpec ParseWeight(string context, YamlNode node, bool allowDragged, NameRegistry propertyNames)
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

                return WeightSpec.FromPath(new PropertyPath(root, propertyNames.Intern(propName)));
            }

            throw new YamlLoadException($"{context}: weightはリテラル数値か{{object, prop}}のいずれかである必要があります。");
        }

        /// <summary>pick候補が持つ、weight/pick以外の兄弟キー（set/add/destroy/spawn）。</summary>
        private static readonly string[] PickCandidateReservedKeys = { "weight", "pick" };

        private static List<PickCandidateDef> ParsePickList(
            string context, YamlSequenceNode pickNode, bool allowDragged, NameRegistry propertyNames, NameRegistry objectNames)
        {
            var result = new List<PickCandidateDef>();

            foreach (YamlNode node in pickNode)
            {
                var map = (YamlMappingNode)node;
                string candidateContext = $"{context}.pick[{result.Count}]";

                YamlNode weightNode = map.TryGet("weight");
                if (weightNode == null) throw new YamlLoadException($"{candidateContext}: 'weight'は必須です。");

                WeightSpec weight = ParseWeight(candidateContext, weightNode, allowDragged, propertyNames);

                bool hasActive = HasActiveContent(map);
                YamlSequenceNode nestedPick = map.TryGetSequence("pick", candidateContext);

                if (hasActive && nestedPick != null)
                    throw new YamlLoadException($"{candidateContext}: set/add/destroy/spawnとpickは同時に指定できません。");
                if (!hasActive && nestedPick == null)
                    throw new YamlLoadException($"{candidateContext}: set/add/destroy/spawnのいずれか、またはpickが必要です。");

                ActiveEffect active = hasActive
                    ? ParseActiveEffectBody(candidateContext, map, allowDragged, selfOnly: false, propertyNames, objectNames, PickCandidateReservedKeys)
                    : null;
                List<PickCandidateDef> pick = nestedPick != null
                    ? ParsePickList(candidateContext, nestedPick, allowDragged, propertyNames, objectNames)
                    : null;

                result.Add(new PickCandidateDef(weight, active, pick));
            }

            return result;
        }

        /// <summary>actionエントリが持つ、showMenu/conditions/pick以外の兄弟キー（set/add/destroy/spawn）。</summary>
        private static readonly string[] ActionReservedKeys = { "showMenu", "conditions", "pick" };

        /// <summary>combinationエントリが持つ、with/conditions/pick以外の兄弟キー（set/add/destroy/spawn）。</summary>
        private static readonly string[] CombinationReservedKeys = { "with", "conditions", "pick" };

        /// <summary>actions_map（11節）を読む。dragged対象はメニュー型操作では意味を持たないため不可。</summary>
        private static List<ActionDef> ParseActions(
            string objectDefName, YamlMappingNode actionsNode, NameRegistry propertyNames, NameRegistry slotNames, NameRegistry objectNames)
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

                ConditionNode conditions = ParseConditionsField(context, map.TryGetSequence("conditions", context), ActionConditionRoots, propertyNames, slotNames);

                bool hasActive = HasActiveContent(map);
                YamlSequenceNode pickList = map.TryGetSequence("pick", context);
                if (hasActive && pickList != null)
                    throw new YamlLoadException($"{context}: set/add/destroy/spawnとpickは同時に指定できません。");

                ActiveEffect active = hasActive ? ParseActiveEffectBody(context, map, allowDragged: false, selfOnly: false, propertyNames, objectNames, ActionReservedKeys) : null;
                List<PickCandidateDef> pick = pickList != null ? ParsePickList(context, pickList, allowDragged: false, propertyNames, objectNames) : null;

                result.Add(new ActionDef(name, ShowMenuMode.Always, conditions, active, pick));
            }

            return result;
        }

        /// <summary>combinations_map（12節）を読む。dragged対象を使える。</summary>
        private static List<CombinationDef> ParseCombinations(
            string objectDefName, YamlMappingNode combinationsNode, NameRegistry propertyNames, NameRegistry slotNames, NameRegistry objectNames)
        {
            var result = new List<CombinationDef>();
            if (combinationsNode == null) return result;

            foreach (var (name, node) in combinationsNode.EntriesInOrder())
            {
                string context = $"'{objectDefName}'.combinations.'{name}'";
                var map = (YamlMappingNode)node;

                string with = map.RequireScalar("with", context);
                ConditionNode conditions = ParseConditionsField(context, map.TryGetSequence("conditions", context), CombinationConditionRoots, propertyNames, slotNames);

                bool hasActive = HasActiveContent(map);
                YamlSequenceNode pickList = map.TryGetSequence("pick", context);
                if (hasActive && pickList != null)
                    throw new YamlLoadException($"{context}: set/add/destroy/spawnとpickは同時に指定できません。");

                ActiveEffect active = hasActive ? ParseActiveEffectBody(context, map, allowDragged: true, selfOnly: false, propertyNames, objectNames, CombinationReservedKeys) : null;
                List<PickCandidateDef> pick = pickList != null ? ParsePickList(context, pickList, allowDragged: true, propertyNames, objectNames) : null;

                result.Add(new CombinationDef(name, with, conditions, active, pick));
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

        private static SlotDef ParseSlot(string objectDefName, string slotName, YamlMappingNode node, NameRegistry slotNames)
        {
            string context = $"'{objectDefName}'.slots.'{slotName}'";
            int slotGlobalId = slotNames.Intern(slotName);

            var accepts = new List<SlotAcceptRule>();
            YamlSequenceNode acceptsNode = node.TryGetSequence("accepts", context);
            if (acceptsNode != null)
                foreach (YamlNode acceptNode in acceptsNode)
                {
                    var acceptMap = (YamlMappingNode)acceptNode;
                    accepts.Add(new SlotAcceptRule(
                        acceptMap.RequireScalar("object", context),
                        acceptMap.RequireInt("max", context),
                        acceptMap.TryGetBool("consume", context, fallback: false)));
                }

            double? capacity = node.TryGetDouble("capacity", context);
            double weightRate = node.TryGetDouble("weight_rate", context) ?? 1.0;
            bool stackable = node.TryGetBool("stackable", context, fallback: true);
            int? unitCapacity = node.TryGetInt("unit_capacity", context);
            bool fixedPositions = node.TryGetBool("fixed_positions", context, fallback: false);

            return new SlotDef(slotGlobalId, slotName, accepts, capacity, weightRate, stackable, unitCapacity, fixedPositions);
        }

        /// <summary>
        /// passivesの1ブロック（self/parent/child、actorは未対応のためスキップ）を読み、RawPassiveEffect
        /// へ変換してoutputへ追加する。forcedGateがWhenOwnStageの場合、このブロックの"conditions"は
        /// stage内では併用できない（1つのPassiveEffectは単一のゲート種別しか表現できないため。
        /// ステージ自体の条件との組み合わせはGameElementDefinition.md 17節で未解決のまま）。
        ///
        /// オブジェクトレベル・プロパティレベル・stage内のいずれも、"passives:"は常に配列であり、
        /// この関数はその配列の1要素（conditions/modify/accumulateのみを持つ、他のキーとは同居しない
        /// 独立したマッピング）に対して呼ばれる。conditionsはブロック全体で1つ（対象ごとには持たない。
        /// self対象・parent対象は常に同じSlotBearerを指すため、対象ごとに持たせても意味が重複するだけ。
        /// Runtime.RegisteredPassiveEffect参照）。
        /// </summary>
        private static void ParsePassiveMapInto(
            List<RawPassiveEffect> output, string objectDefName, YamlMappingNode passiveMap,
            PassiveEffectGateKind? forcedGate, string forcedStageProperty, string forcedStageName,
            NameRegistry propertyNames, NameRegistry slotNames)
        {
            string context = $"'{objectDefName}'.passives";
            bool isStageForced = forcedGate == PassiveEffectGateKind.WhenOwnStage;

            YamlSequenceNode conditionsNode = passiveMap.TryGetSequence("conditions", context);
            if (isStageForced && conditionsNode != null)
                throw new YamlLoadException(
                    $"{context}: stage内のpassivesでは'conditions'を併用できません" +
                    "（ステージ自体の条件との組み合わせは未対応。GameElementDefinition.md 17節）。");

            ConditionNode conditions = isStageForced
                ? null
                : ParseConditionsField(context, conditionsNode, PassiveConditionRoots, propertyNames, slotNames);

            ParsePassiveOperationInto(
                output, context, passiveMap, "modify", PassiveEffectKind.Modify,
                conditions, forcedGate, forcedStageProperty, forcedStageName);
            ParsePassiveOperationInto(
                output, context, passiveMap, "accumulate", PassiveEffectKind.Accumulate,
                conditions, forcedGate, forcedStageProperty, forcedStageName);

            var knownKeys = new HashSet<string> { "conditions", "modify", "accumulate" };

            var unknownKeys = passiveMap.EntriesInOrder().Select(e => e.Key)
                .Where(k => !knownKeys.Contains(k)).ToList();
            if (unknownKeys.Count > 0)
                throw new YamlLoadException($"{context}: 未知のキー '{string.Join(", ", unknownKeys)}' です。");
        }

        /// <summary>
        /// passiveの1操作(modify/accumulate)を読み、対象(self/parent/child、actorは未対応のため
        /// スキップ)ごとにRawPassiveEffectへ変換してoutputへ追加する。ゲートは、同じpassiveブロック内
        /// の"conditions"（ブロック全体で1つ）をそのまま使う。forcedGateがWhenOwnStageの場合、常に
        /// そのステージのゲートを使う（conditionsはnullであることが呼び出し側で保証されている）。
        /// </summary>
        private static void ParsePassiveOperationInto(
            List<RawPassiveEffect> output, string context, YamlMappingNode passiveMap,
            string operationKey, PassiveEffectKind kind, ConditionNode conditions,
            PassiveEffectGateKind? forcedGate, string forcedStageProperty, string forcedStageName)
        {
            YamlMappingNode operationMap = passiveMap.TryGetMapping(operationKey, context);
            if (operationMap == null) return;

            bool isWhenOwnStage = forcedGate == PassiveEffectGateKind.WhenOwnStage;

            foreach (var (targetName, bodyNode) in operationMap.EntriesInOrder())
            {
                if (targetName == "actor") continue; // 未対応（PassiveEffectTargetにActorが無いため）

                PassiveEffectTarget target;
                switch (targetName)
                {
                    case "self": target = PassiveEffectTarget.Self; break;
                    case "parent": target = PassiveEffectTarget.Parent; break;
                    case "child": target = PassiveEffectTarget.Child; break;
                    default:
                        throw new YamlLoadException($"{context}.{operationKey}: 未知の対象キー '{targetName}' です。");
                }

                var body = (YamlMappingNode)bodyNode;
                foreach (var (propName, amountNode) in body.EntriesInOrder())
                    output.Add(new RawPassiveEffect(
                        target, kind, propName, int.Parse(((YamlScalarNode)amountNode).Value),
                        conditions, isWhenOwnStage, forcedStageProperty, forcedStageName));
            }
        }

        /// <summary>
        /// RawPassiveEffectを最終的なPassiveEffectへ変換する。WhenOwnStageゲートは、Declarer自身（＝この
        /// object_def自身）のPropertyDefからStageを引くため、ownPropertyLayout/ownPropertyDefsという
        /// このobject_def自身の（既に組み上がった）ローカル配列を使う（他のobject_defのstageは参照できない）。
        /// </summary>
        private static PassiveEffect BuildPassiveEffect(
            RawPassiveEffect c, LocalIndexMap ownPropertyLayout, IReadOnlyList<PropertyDef> ownPropertyDefs, NameRegistry propertyNames)
        {
            int targetPropertyGlobalId = propertyNames.Intern(c.TargetPropertyName);

            PassiveEffectGate gate;
            if (c.IsWhenOwnStage)
            {
                int stagePropertyLocalId = ownPropertyLayout.ToLocal(propertyNames.Intern(c.GateStagePropertyName));
                PropertyDef stagePropertyDef = ownPropertyDefs[stagePropertyLocalId];
                PropertyStage stage = stagePropertyDef.Stages.First(s => s.Name == c.GateStageName);
                gate = new PassiveEffectGate
                {
                    Kind = PassiveEffectGateKind.WhenOwnStage,
                    PropertyLocalId = stagePropertyLocalId,
                    Stage = stage,
                };
            }
            else if (c.Conditions != null)
            {
                gate = new PassiveEffectGate
                {
                    Kind = PassiveEffectGateKind.Conditions,
                    Conditions = c.Conditions,
                };
            }
            else
            {
                gate = PassiveEffectGate.Always;
            }

            return new PassiveEffect(c.Target, c.Kind, targetPropertyGlobalId, c.Amount, gate);
        }
    }
}
