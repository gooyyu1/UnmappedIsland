using System.Collections.Generic;
using System.Linq;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Domain.Runtime;
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
        private ActiveEffects ParseActiveEffectBody(
            string context, YamlMappingNode bodyNode, bool allowDragged, bool selfOnly,
            IReadOnlyCollection<string> reservedKeys = null)
        {
            // 単一命令(ActiveEffect)の宣言順フラットリストを1本組み立てる。適用順はset→add→transfer→
            // destroy→spawn（同一プロパティへのset後add、destroyで空いた位置へのspawn(same_slot)という
            // 依存関係のため。ActiveEffects.Applyはこのリスト順にそのまま適用する）。
            var operations = new List<ActiveEffect>();

            YamlMappingNode setMap = bodyNode.TryGetMapping("set", context);
            if (setMap != null)
                operations.AddRange(ParseSets($"{context}.set", setMap, allowDragged, selfOnly));

            YamlMappingNode addMap = bodyNode.TryGetMapping("add", context);
            if (addMap != null)
                operations.AddRange(ParseAdds($"{context}.add", addMap, allowDragged, selfOnly));

            YamlNode transferNode = bodyNode.TryGet("transfer");
            if (transferNode != null)
                operations.AddRange(ParseTransfers($"{context}.transfer", transferNode, allowDragged, selfOnly));

            YamlNode destroyNode = bodyNode.TryGet("destroy");
            if (destroyNode != null)
                foreach (ReferenceRoot target in ParseDestroyTargets($"{context}.destroy", destroyNode, allowDragged, selfOnly))
                    operations.Add(new DestroyEffect(target));

            YamlNode spawnNode = bodyNode.TryGet("spawn");
            if (spawnNode != null)
                operations.AddRange(ParseSpawns($"{context}.spawn", spawnNode));

            var knownKeys = new HashSet<string>(ActiveVerbKeys);
            if (reservedKeys != null) knownKeys.UnionWith(reservedKeys);

            var unknownKeys = bodyNode.EntriesInOrder().Select(e => e.Key)
                .Where(k => !knownKeys.Contains(k)).ToList();
            if (unknownKeys.Count > 0)
                throw new YamlLoadException($"{context}: 未知のキー '{string.Join(", ", unknownKeys)}' です。");

            return new ActiveEffects(operations);
        }

        /// <summary>
        /// setの1エントリの値。YAMLスカラーならリテラル（整数・真偽値・シンボル名、ParseScalarNumber）、
        /// YAMLマッピングなら{object, prop}参照（他のプロパティの現在値をそのままコピーする、9.2節）の
        /// いずれか。参照先のobjectは、set自身の対象キー（self/parent/ancestor/actor/[dragged]）と全く同じ
        /// 制約（selfOnly・allowDragged）を共有するため、ParseActiveTargetKeyをそのまま使う。
        /// </summary>
        private SetEffect ParseSetEffect(
            string context, ReferenceRoot target, int propertyGlobalId, YamlNode valueNode, bool allowDragged, bool selfOnly)
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

                return new SetEffect(target, propertyGlobalId, new PropertyPath(root, PropertyNames.Intern(propName)));
            }

            return new SetEffect(target, propertyGlobalId, ParseScalarNumber(context, ((YamlScalarNode)valueNode).Value));
        }

        /// <summary>
        /// transfer（9.5節）。conditions（14節）と同じくfrom/toの参照をフラットな2フィールド
        /// （from_object/from_prop, to_object/to_prop）で表す。from_object/to_objectは省略時self
        /// （conditionsのobject省略時と同じ規約）。対象ルートの妥当性判定は、set/add/destroyと全く同じ
        /// 制約（selfOnly・allowDragged）を共有するため、ParseActiveTargetKeyをそのまま使う。
        ///
        /// linked_add（省略可）はaddと同じ構造を持ち、実際の移動量に比例してスケールされる副効果を表す。
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

            YamlMappingNode linkedAddMap = map.TryGetMapping("linked_add", context);
            var linkedAdd = linkedAddMap != null
                ? ParseAdds($"{context}.linked_add", linkedAddMap, allowDragged, selfOnly)
                : new List<AddEffect>();

            var unknownKeys = map.EntriesInOrder().Select(e => e.Key)
                .Where(k => k != "from_object" && k != "from_prop" && k != "to_object" && k != "to_prop"
                         && k != "amount" && k != "allow_overflow" && k != "linked_add")
                .ToList();
            if (unknownKeys.Count > 0)
                throw new YamlLoadException($"{context}: 未知のキー '{string.Join(", ", unknownKeys)}' です。");

            return new TransferEffect(fromObject, fromProp, toObject, toProp, amount, allowOverflow, linkedAdd);
        }

        /// <summary>setを「対象付きの1操作(SetEffect)」の宣言順フラットリストへ読む（対象別の入れ子は
        /// 各SetEffectがTargetとして自分で持つため、辞書グループ化ではなくフラットに展開する。passiveの
        /// ParsePassiveOperationIntoがModifyEffect/AccumulateEffectのリストを作るのと対称）。</summary>
        private List<SetEffect> ParseSets(
            string context, YamlMappingNode map, bool allowDragged, bool selfOnly)
        {
            var sets = new List<SetEffect>();
            foreach (var (targetName, targetBody) in map.EntriesInOrder())
            {
                ReferenceRoot target = ParseActiveTargetKey(context, targetName, allowDragged, selfOnly);
                foreach (var (propName, valueNode) in ((YamlMappingNode)targetBody).EntriesInOrder())
                    sets.Add(ParseSetEffect(
                        $"{context}.'{targetName}'.'{propName}'", target, PropertyNames.Intern(propName), valueNode,
                        allowDragged, selfOnly));
            }

            return sets;
        }

        /// <summary>addを「対象付きの1操作(AddEffect)」の宣言順フラットリストへ読む（ParseSetsと同じく、
        /// 対象は各AddEffectがTargetとして自分で持つ）。</summary>
        private List<AddEffect> ParseAdds(
            string context, YamlMappingNode map, bool allowDragged, bool selfOnly)
        {
            var adds = new List<AddEffect>();
            foreach (var (targetName, targetBody) in map.EntriesInOrder())
            {
                ReferenceRoot target = ParseActiveTargetKey(context, targetName, allowDragged, selfOnly);
                foreach (var (propName, amountNode) in ((YamlMappingNode)targetBody).EntriesInOrder())
                    adds.Add(new AddEffect(
                        target, PropertyNames.Intern(propName), int.Parse(((YamlScalarNode)amountNode).Value)));
            }

            return adds;
        }

        private IEnumerable<SpawnEffect> ParseSpawns(string context, YamlNode node)
        {
            if (node is YamlMappingNode map)
            {
                yield return ParseSpawn(context, map);
                yield break;
            }

            if (node is YamlSequenceNode seq)
            {
                for (int i = 0; i < seq.Children.Count; i++)
                {
                    if (!(seq.Children[i] is YamlMappingNode item))
                        throw new YamlLoadException($"{context}[{i}]: 各要素はmappingである必要があります。");
                    yield return ParseSpawn($"{context}[{i}]", item);
                }
                yield break;
            }

            throw new YamlLoadException($"{context}: mappingかmappingの配列である必要があります。");
        }

        private SpawnEffect ParseSpawn(string context, YamlMappingNode map)
        {
            string into = map.TryGetScalar("into", context);

            var unknownKeys = map.EntriesInOrder().Select(e => e.Key)
                .Where(k => k != "object" && k != "into").ToList();
            if (unknownKeys.Count > 0)
                throw new YamlLoadException($"{context}: 未知のキー '{string.Join(", ", unknownKeys)}' です。");

            return new SpawnEffect(
                ObjectNames.Intern(map.RequireScalar("object", context)),
                ParseSpawnTargetRoot(context, into));
        }

        private IEnumerable<TransferEffect> ParseTransfers(string context, YamlNode node, bool allowDragged, bool selfOnly)
        {
            if (node is YamlMappingNode map)
            {
                yield return ParseTransfer(context, map, allowDragged, selfOnly);
                yield break;
            }

            if (node is YamlSequenceNode seq)
            {
                for (int i = 0; i < seq.Children.Count; i++)
                {
                    if (!(seq.Children[i] is YamlMappingNode item))
                        throw new YamlLoadException($"{context}[{i}]: 各要素はmappingである必要があります。");
                    yield return ParseTransfer($"{context}[{i}]", item, allowDragged, selfOnly);
                }
                yield break;
            }

            throw new YamlLoadException($"{context}: mappingかmappingの配列である必要があります。");
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
                case "dragged_parent":
                    if (!allowDragged)
                        throw new YamlLoadException($"{context}: 'dragged_parent'はcombinationsの中でのみ使えます。");
                    return ReferenceRoot.DraggedParent;
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
