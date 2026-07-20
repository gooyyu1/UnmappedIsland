using System.Collections.Generic;
using System.Linq;
using UnmappedIsland.Codex;
using UnmappedIsland.Runtime;
using YamlDotNet.RepresentationModel;

namespace UnmappedIsland.Loader
{
    public sealed partial class WorldCodexYamlLoader
    {
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
        private ActiveEffect ParseActiveEffectBody(
            string context, YamlMappingNode bodyNode, bool allowDragged, bool selfOnly,
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
                        assigns.Add(ParsePropertyAssignment(
                            $"{context}.set.'{targetName}'.'{propName}'", PropertyNames.Intern(propName), valueNode,
                            allowDragged, selfOnly));
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
                        deltas.Add(new PropertyDelta(PropertyNames.Intern(propName), int.Parse(((YamlScalarNode)amountNode).Value)));
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
                    ObjectNames.Intern(spawnMap.RequireScalar("object", context)),
                    ParseSpawnTargetRoot(context, into));
            }

            TransferEffect transfer = null;
            YamlMappingNode transferMap = bodyNode.TryGetMapping("transfer", context);
            if (transferMap != null)
                transfer = ParseTransfer($"{context}.transfer", transferMap, allowDragged, selfOnly);

            var knownKeys = new HashSet<string>(ActiveVerbKeys);
            if (reservedKeys != null) knownKeys.UnionWith(reservedKeys);

            var unknownKeys = bodyNode.EntriesInOrder().Select(e => e.Key)
                .Where(k => !knownKeys.Contains(k)).ToList();
            if (unknownKeys.Count > 0)
                throw new YamlLoadException($"{context}: 未知のキー '{string.Join(", ", unknownKeys)}' です。");

            return new ActiveEffect(sets, adds, destroy, spawn, transfer);
        }

        /// <summary>
        /// setの1エントリの値。YAMLスカラーならリテラル（整数・真偽値・シンボル名、ParseScalarNumber）、
        /// YAMLマッピングなら{object, prop}参照（他のプロパティの現在値をそのままコピーする、9.2節）の
        /// いずれか。参照先のobjectは、set自身の対象キー（self/parent/ancestor/actor/[dragged]）と全く同じ
        /// 制約（selfOnly・allowDragged）を共有するため、ParseActiveTargetKeyをそのまま使う。
        /// </summary>
        private PropertyAssignment ParsePropertyAssignment(
            string context, int propertyGlobalId, YamlNode valueNode, bool allowDragged, bool selfOnly)
        {
            if (valueNode is YamlMappingNode refMap)
            {
                string objectName = refMap.TryGetScalar("object", context);
                ReferenceRoot root = objectName != null
                    ? ParseActiveTargetKey(context, objectName, allowDragged, selfOnly)
                    : ReferenceRoot.Self;
                string propName = refMap.RequireScalar("prop", context);

                var unknownKeys = refMap.EntriesInOrder().Select(e => e.Key)
                    .Where(k => k != "object" && k != "prop").ToList();
                if (unknownKeys.Count > 0)
                    throw new YamlLoadException($"{context}: 未知のキー '{string.Join(", ", unknownKeys)}' です。");

                return new PropertyAssignment(propertyGlobalId, new PropertyPath(root, PropertyNames.Intern(propName)));
            }

            return new PropertyAssignment(propertyGlobalId, ParseScalarNumber(context, ((YamlScalarNode)valueNode).Value));
        }

        /// <summary>
        /// transfer（9.5節）。conditions（14節）と同じくfrom/toの参照をフラットな2フィールド
        /// （from_object/from_prop, to_object/to_prop）で表す。from_object/to_objectは省略時self
        /// （conditionsのobject省略時と同じ規約）。対象ルートの妥当性判定は、set/add/destroyと全く同じ
        /// 制約（selfOnly・allowDragged）を共有するため、ParseActiveTargetKeyをそのまま使う。
        /// </summary>
        private TransferEffect ParseTransfer(string context, YamlMappingNode map, bool allowDragged, bool selfOnly)
        {
            string fromObjectRaw = map.TryGetScalar("from_object", context);
            ReferenceRoot fromObject = fromObjectRaw != null
                ? ParseActiveTargetKey(context, fromObjectRaw, allowDragged, selfOnly)
                : ReferenceRoot.Self;
            int fromProp = PropertyNames.Intern(map.RequireScalar("from_prop", context));

            string toObjectRaw = map.TryGetScalar("to_object", context);
            ReferenceRoot toObject = toObjectRaw != null
                ? ParseActiveTargetKey(context, toObjectRaw, allowDragged, selfOnly)
                : ReferenceRoot.Self;
            int toProp = PropertyNames.Intern(map.RequireScalar("to_prop", context));

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
    }
}
