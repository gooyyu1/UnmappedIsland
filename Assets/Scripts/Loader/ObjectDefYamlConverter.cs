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
        public static ObjectDef Build(
            string name,
            bool isSingleton,
            IReadOnlyList<string> tags,
            YamlMappingNode propsNode,
            YamlMappingNode slotsNode,
            IReadOnlyList<YamlMappingNode> passiveNodes,
            YamlMappingNode stackOrderNode,
            YamlMappingNode actionsNode,
            YamlMappingNode combinationsNode,
            NameRegistry objectNames,
            NameRegistry propertyNames,
            NameRegistry slotNames,
            NameRegistry tagNames)
        {
            int objectGlobalId = objectNames.Intern(name);
            var passives = new List<PassiveEffect>();

            var propertyDefs = new List<PropertyDef>();
            if (propsNode != null)
                foreach (var (propName, propValueNode) in propsNode.EntriesInOrder())
                    propertyDefs.Add(ParseProperty(
                        name, propName, (YamlMappingNode)propValueNode, passives, propertyNames, slotNames, objectNames));
            var propertyLayout = new LocalIndexMap(propertyNames.Count, propertyDefs.Select(p => p.GlobalId).ToList());

            var slotDefs = new List<SlotDef>();
            if (slotsNode != null)
                foreach (var (slotName, slotValueNode) in slotsNode.EntriesInOrder())
                    slotDefs.Add(ParseSlot(name, slotName, (YamlMappingNode)slotValueNode, slotNames, tagNames, objectNames));
            var slotLayout = new LocalIndexMap(slotNames.Count, slotDefs.Select(s => s.GlobalId).ToList());

            foreach (YamlMappingNode passiveNode in passiveNodes)
                ParsePassiveMapInto(
                    passives, name, passiveNode, forcedStageProperty: null, forcedStageName: null,
                    propertyNames, slotNames);

            StackOrderDef stackOrder = null;
            if (stackOrderNode != null)
            {
                string context = $"'{name}'.stack_order";
                stackOrder = new StackOrderDef(
                    propertyNames.Intern(stackOrderNode.RequireScalar("property", context)),
                    stackOrderNode.TryGetBool("ascending", context, fallback: false));
            }

            var actions = ParseActions(name, actionsNode, propertyNames, slotNames, objectNames);
            var combinations = ParseCombinations(name, combinationsNode, propertyNames, slotNames, objectNames, tagNames);
            var tagIds = tags.Select(tagNames.Intern).Distinct().ToList();

            return new ObjectDef(
                objectGlobalId, name, isSingleton, propertyLayout, propertyDefs, slotLayout, slotDefs,
                passives, stackOrder, tagIds, actions, combinations);
        }

        private static PropertyDef ParseProperty(
            string objectDefName, string propName, YamlMappingNode node,
            List<PassiveEffect> passives, NameRegistry propertyNames, NameRegistry slotNames, NameRegistry objectNames)
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
                            ParsePassiveMapInto(passives, objectDefName, (YamlMappingNode)passiveNode,
                                forcedStageProperty: propName, forcedStageName: stageName,
                                propertyNames, slotNames);
                }
            }

            YamlSequenceNode propPassives = node.TryGetSequence("passives", context);
            if (propPassives != null)
                foreach (YamlNode passiveNode in propPassives)
                    ParsePassiveMapInto(passives, objectDefName, (YamlMappingNode)passiveNode,
                        forcedStageProperty: null, forcedStageName: null, propertyNames, slotNames);

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

            bool inherit = node.TryGetBool("inherit", context, fallback: false);

            return new PropertyDef(propertyGlobalId, propName, defaultNumber, rerollRange, range, onOverflow, stages, onMin, onShortfall, onMax, inherit);
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
        private static readonly string[] ActiveVerbKeys = { "set", "add", "destroy", "spawn", "transfer" };

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

            TransferEffect transfer = null;
            YamlMappingNode transferMap = bodyNode.TryGetMapping("transfer", context);
            if (transferMap != null)
                transfer = ParseTransfer($"{context}.transfer", transferMap, allowDragged, selfOnly, propertyNames);

            var knownKeys = new HashSet<string>(ActiveVerbKeys);
            if (reservedKeys != null) knownKeys.UnionWith(reservedKeys);

            var unknownKeys = bodyNode.EntriesInOrder().Select(e => e.Key)
                .Where(k => !knownKeys.Contains(k)).ToList();
            if (unknownKeys.Count > 0)
                throw new YamlLoadException($"{context}: 未知のキー '{string.Join(", ", unknownKeys)}' です。");

            return new ActiveEffect(sets, adds, destroy, spawn, transfer);
        }

        /// <summary>
        /// transfer（9.5節）。conditions（14節）と同じくfrom/toの参照をフラットな2フィールド
        /// （from_object/from_prop, to_object/to_prop）で表す。from_object/to_objectは省略時self
        /// （conditionsのobject省略時と同じ規約）。対象ルートの妥当性判定は、set/add/destroyと全く同じ
        /// 制約（selfOnly・allowDragged）を共有するため、ParseActiveTargetKeyをそのまま使う。
        /// </summary>
        private static TransferEffect ParseTransfer(
            string context, YamlMappingNode map, bool allowDragged, bool selfOnly, NameRegistry propertyNames)
        {
            string fromObjectRaw = map.TryGetScalar("from_object", context);
            ReferenceRoot fromObject = fromObjectRaw != null
                ? ParseActiveTargetKey(context, fromObjectRaw, allowDragged, selfOnly)
                : ReferenceRoot.Self;
            int fromProp = propertyNames.Intern(map.RequireScalar("from_prop", context));

            string toObjectRaw = map.TryGetScalar("to_object", context);
            ReferenceRoot toObject = toObjectRaw != null
                ? ParseActiveTargetKey(context, toObjectRaw, allowDragged, selfOnly)
                : ReferenceRoot.Self;
            int toProp = propertyNames.Intern(map.RequireScalar("to_prop", context));

            int amount = map.RequireInt("amount", context);
            bool allowOverflow = map.TryGetBool("allow_overflow", context, fallback: false);

            var unknownKeys = map.EntriesInOrder().Select(e => e.Key)
                .Where(k => k != "from_object" && k != "from_prop" && k != "to_object" && k != "to_prop"
                         && k != "amount" && k != "allow_overflow")
                .ToList();
            if (unknownKeys.Count > 0)
                throw new YamlLoadException($"{context}: 未知のキー '{string.Join(", ", unknownKeys)}' です。");

            return new TransferEffect(fromObject, fromProp, toObject, toProp, amount, allowOverflow);
        }

        /// <summary>
        /// set/add/destroyの対象キー（self/parent/ancestor/actor、combinations内はdraggedも）を解決する。
        /// childは、一度きりの命令に対して「どの子か」の意味がまだ確定していないため未対応（passiveのchild
        /// 寄与とは異なり、activeのchildには関係とゲートに基づく登録の仕組みが無いため、対象を一意に絞る
        /// 規約が無い）。selfOnlyの場合（on_min・on_max・on_overflow・on_shortfall）はself以外を一律エラーにする。
        /// </summary>
        private static ReferenceRoot ParseActiveTargetKey(string context, string key, bool allowDragged, bool selfOnly)
        {
            if (selfOnly && key != "self")
                throw new YamlLoadException($"{context}: 現時点でselfのみ対応しています（未対応: '{key}'）。");

            switch (key)
            {
                case "self": return ReferenceRoot.Self;
                case "parent": return ReferenceRoot.Parent;
                case "ancestor": return ReferenceRoot.Ancestor;
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
        /// 対象名のリスト(`destroy: [self, dragged]`)のいずれかを許容する。ancestorは「どのプロパティを
        /// 探すか」が無ければ解決しようがなく、destroyはオブジェクトそのものを指すためプロパティを
        /// 持たない。よってdestroyの対象としては未対応。</summary>
        private static List<ReferenceRoot> ParseDestroyTargets(string context, YamlNode node, bool allowDragged, bool selfOnly)
        {
            if (node is YamlScalarNode scalar)
                return new List<ReferenceRoot> { ParseDestroyTargetKey(context, scalar.Value, allowDragged, selfOnly) };

            if (node is YamlSequenceNode seq)
                return seq.Select(n => ParseDestroyTargetKey(context, ((YamlScalarNode)n).Value, allowDragged, selfOnly)).ToList();

            throw new YamlLoadException($"{context}: destroyは対象名か、対象名のリストのいずれかである必要があります。");
        }

        private static ReferenceRoot ParseDestroyTargetKey(string context, string key, bool allowDragged, bool selfOnly)
        {
            ReferenceRoot root = ParseActiveTargetKey(context, key, allowDragged, selfOnly);
            if (root == ReferenceRoot.Ancestor)
                throw new YamlLoadException(
                    $"{context}: destroyの対象'ancestor'は未対応です（destroyはプロパティではなくオブジェクトそのものを指すため）。");
            return root;
        }

        /// <summary>conditions（14節）・passivesのゲート（旧when、8節）が共通で使うobject参照キー。
        /// worldは唯一のシングルトンインスタンスを実行時に追跡する仕組みがまだ無いため未対応
        /// （ancestorが「見つからなければworldまで遡る」ことを自然に含むため、世界固有の概念を
        /// 参照したい場合はancestorで代替できる）。</summary>
        private static ReferenceRoot ParseConditionObject(string context, string raw, IReadOnlyCollection<ReferenceRoot> allowedRoots)
        {
            ReferenceRoot root;
            switch (raw)
            {
                case "self": root = ReferenceRoot.Self; break;
                case "parent": root = ReferenceRoot.Parent; break;
                case "ancestor": root = ReferenceRoot.Ancestor; break;
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
            new HashSet<ReferenceRoot> { ReferenceRoot.Self, ReferenceRoot.Parent, ReferenceRoot.Ancestor, ReferenceRoot.Actor };

        private static readonly HashSet<ReferenceRoot> CombinationConditionRoots =
            new HashSet<ReferenceRoot> { ReferenceRoot.Self, ReferenceRoot.Parent, ReferenceRoot.Ancestor, ReferenceRoot.Actor, ReferenceRoot.Dragged };

        /// <summary>passivesのゲート（旧when）で使えるobject。selfはSlotBearer（8節の効果を宣言した側の
        /// スロット位置）、parentはその1つ上（Runtime.RegisteredPassiveEffect参照）。ancestorはselfの
        /// 直接の親から遡った祖先探索（Runtime.WorldObject.FindAncestorWithProperty参照）。actor/draggedは
        /// 持続的な関係に紐づかないため未対応。</summary>
        private static readonly HashSet<ReferenceRoot> PassiveConditionRoots =
            new HashSet<ReferenceRoot> { ReferenceRoot.Self, ReferenceRoot.Parent, ReferenceRoot.Ancestor };

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
                if (root == ReferenceRoot.Ancestor)
                    throw new YamlLoadException(
                        $"{context}: slot判定でobject 'ancestor'は未対応です（ancestorはプロパティ名で祖先を探すため、探すプロパティを持たないslot判定とは噛み合いません）。");

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
            string objectDefName, YamlMappingNode combinationsNode, NameRegistry propertyNames, NameRegistry slotNames,
            NameRegistry objectNames, NameRegistry tagNames)
        {
            var result = new List<CombinationDef>();
            if (combinationsNode == null) return result;

            foreach (var (name, node) in combinationsNode.EntriesInOrder())
            {
                string context = $"'{objectDefName}'.combinations.'{name}'";
                var map = (YamlMappingNode)node;

                int with = tagNames.Intern(map.RequireScalar("with", context));
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

        private static SlotDef ParseSlot(
            string objectDefName, string slotName, YamlMappingNode node,
            NameRegistry slotNames, NameRegistry tagNames, NameRegistry objectNames)
        {
            string context = $"'{objectDefName}'.slots.'{slotName}'";
            int slotGlobalId = slotNames.Intern(slotName);

            var accepts = new List<SlotAcceptRule>();
            YamlSequenceNode acceptsNode = node.TryGetSequence("accepts", context);
            if (acceptsNode != null)
                foreach (YamlNode acceptNode in acceptsNode)
                {
                    var acceptMap = (YamlMappingNode)acceptNode;
                    string acceptContext = $"{context}.accepts";
                    string tagName = acceptMap.TryGetScalar("tag", acceptContext);
                    string objectName = acceptMap.TryGetScalar("object", acceptContext);

                    if (tagName != null && objectName != null)
                        throw new YamlLoadException($"{acceptContext}: 'tag'と'object'は同時に指定できません。");
                    if (tagName == null && objectName == null)
                        throw new YamlLoadException($"{acceptContext}: 'tag'または'object'のいずれかが必要です。");

                    SlotAcceptTargetKind targetKind = tagName != null ? SlotAcceptTargetKind.Tag : SlotAcceptTargetKind.Object;
                    int with = tagName != null ? tagNames.Intern(tagName) : objectNames.Intern(objectName);

                    accepts.Add(new SlotAcceptRule(
                        targetKind, with,
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
        /// passivesの1ブロック（self/parent/child/ancestor、actorは未対応のためスキップ）を読み、
        /// PassiveEffectへ変換してoutputへ追加する。forcedStageProperty（非nullならstage内、nullなら
        /// オブジェクト/プロパティレベル）と、このブロックの"conditions"は独立に併用できる（例:「装備している
        /// 間、かつ耐久値がintactステージの間だけ」）。ゲートはグローバルIDのまま持つため（BuildGate参照）、
        /// このobject_def自身のPropertyDefが出来上がっているかどうかに関わらず、その場でPassiveEffectを
        /// 組み上げられる。
        ///
        /// オブジェクトレベル・プロパティレベル・stage内のいずれも、"passives:"は常に配列であり、
        /// この関数はその配列の1要素（conditions/modify/accumulateのみを持つ、他のキーとは同居しない
        /// 独立したマッピング）に対して呼ばれる。conditionsはブロック全体で1つ（対象ごとには持たない。
        /// self対象・parent対象は常に同じSlotBearerを指すため、対象ごとに持たせても意味が重複するだけ。
        /// Runtime.RegisteredPassiveEffect参照）。
        /// </summary>
        private static void ParsePassiveMapInto(
            List<PassiveEffect> output, string objectDefName, YamlMappingNode passiveMap,
            string forcedStageProperty, string forcedStageName,
            NameRegistry propertyNames, NameRegistry slotNames)
        {
            string context = $"'{objectDefName}'.passives";

            YamlSequenceNode conditionsNode = passiveMap.TryGetSequence("conditions", context);
            ConditionNode conditions = ParseConditionsField(context, conditionsNode, PassiveConditionRoots, propertyNames, slotNames);
            PassiveEffectGate gate = BuildGate(conditions, forcedStageProperty, forcedStageName, propertyNames);

            ParsePassiveOperationInto(output, context, passiveMap, "modify", PassiveEffectKind.Modify, gate, propertyNames);
            ParsePassiveOperationInto(output, context, passiveMap, "accumulate", PassiveEffectKind.Accumulate, gate, propertyNames);

            var knownKeys = new HashSet<string> { "conditions", "modify", "accumulate" };

            var unknownKeys = passiveMap.EntriesInOrder().Select(e => e.Key)
                .Where(k => !knownKeys.Contains(k)).ToList();
            if (unknownKeys.Count > 0)
                throw new YamlLoadException($"{context}: 未知のキー '{string.Join(", ", unknownKeys)}' です。");
        }

        /// <summary>
        /// ゲートを組み立てる。stagePropertyName（forcedStageProperty）が非nullならWhenOwnStage
        /// （プロパティのグローバルIDとstage名をそのまま持つ。Runtime.WorldObject.IsInStageが評価時に
        /// ローカルIDへ変換する）。conditionsと両方指定されていれば、両方を満たす間だけ有効になる
        /// （例:「装備している間、かつ耐久値がintactステージの間だけ」。RegisteredPassiveEffect.IsActive参照）。
        /// </summary>
        private static PassiveEffectGate BuildGate(
            ConditionNode conditions, string stagePropertyName, string stageName, NameRegistry propertyNames)
        {
            var gate = new PassiveEffectGate { Conditions = conditions };
            if (stagePropertyName != null)
            {
                gate.PropertyGlobalId = propertyNames.Intern(stagePropertyName);
                gate.StageName = stageName;
            }
            return gate;
        }

        /// <summary>
        /// passiveの1操作(modify/accumulate)を読み、対象(self/parent/child/ancestor、actorは未対応のため
        /// スキップ)ごとにPassiveEffectへ変換してoutputへ追加する。同じpassiveブロック内のgateをそのまま
        /// 共有する（対象・プロパティが違っても、ゲートの意味は同じであるため）。
        /// </summary>
        private static void ParsePassiveOperationInto(
            List<PassiveEffect> output, string context, YamlMappingNode passiveMap,
            string operationKey, PassiveEffectKind kind, PassiveEffectGate gate, NameRegistry propertyNames)
        {
            YamlMappingNode operationMap = passiveMap.TryGetMapping(operationKey, context);
            if (operationMap == null) return;

            foreach (var (targetName, bodyNode) in operationMap.EntriesInOrder())
            {
                if (targetName == "actor") continue; // 未対応（PassiveEffectTargetにActorが無いため）

                PassiveEffectTarget target;
                switch (targetName)
                {
                    case "self": target = PassiveEffectTarget.Self; break;
                    case "parent": target = PassiveEffectTarget.Parent; break;
                    case "child": target = PassiveEffectTarget.Child; break;
                    case "ancestor": target = PassiveEffectTarget.Ancestor; break;
                    default:
                        throw new YamlLoadException($"{context}.{operationKey}: 未知の対象キー '{targetName}' です。");
                }

                var body = (YamlMappingNode)bodyNode;
                foreach (var (propName, amountNode) in body.EntriesInOrder())
                    output.Add(new PassiveEffect(
                        target, kind, propertyNames.Intern(propName), int.Parse(((YamlScalarNode)amountNode).Value), gate));
            }
        }
    }
}
