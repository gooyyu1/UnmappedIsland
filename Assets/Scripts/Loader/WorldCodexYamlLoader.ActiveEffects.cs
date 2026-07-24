using System.Collections.Generic;
using System.Linq;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Domain.Runtime;
using YamlDotNet.RepresentationModel;

namespace UnmappedIsland.Loader
{
    public sealed partial class WorldCodexYamlLoader
    {
        /// <summary>activeの内容のキー集合。actions/combinations/pickの各エントリはこれらを兄弟キーとして
        /// 直接持つため、「activeとして何か書かれているか」をこのキー群の有無で判定する。</summary>
        private static readonly string[] ActiveVerbKeys = { "set", "add", "destroy", "spawn", "transfer", "move" };

        private static bool HasActiveContent(YamlMappingNode map) =>
            ActiveVerbKeys.Any(key => map.TryGet(key) != null);

        /// <summary>
        /// active内容（9節）を読む。文法は「操作(set/add)が上位、対象(self/parent/actor/dragged)が下位」
        /// （例: `add: {self: {hour: 1}}`）。bodyNodeにはactive以外の兄弟キーも同居しうるため、
        /// reservedKeysに「呼び出し側がすでに読み終えている兄弟キー」を渡して未知キー判定から除外する。
        /// spawnは常にselfが実行するものとみなすため対象キーを持たない。
        /// </summary>
        private ActiveEffects ParseActiveEffectBody(
            string context, YamlMappingNode bodyNode, bool allowDragged, bool selfOnly,
            IReadOnlyCollection<string> reservedKeys = null)
        {
            // 適用順はset→add→transfer→move→destroy→spawnで固定（set後add、destroyで空いた位置への
            // spawn(same_slot)、moveはdestroyで対象が消える前、という依存関係のため。
            // ActiveEffects.Applyはこのリスト順にそのまま適用する）。
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

            YamlMappingNode moveNode = bodyNode.TryGetMapping("move", context);
            if (moveNode != null)
                operations.Add(ParseMove($"{context}.move", moveNode, selfOnly));

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
        /// setの1エントリの値。スカラーならリテラル（整数・真偽値・シンボル名）、マッピングなら
        /// {object, prop}参照（他のプロパティの現在値のコピー、9.2節）。参照先のobjectはset自身の
        /// 対象キーと同じ制約（selfOnly・allowDragged）を共有する。
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
        /// transfer（9.5節）。from/toの参照はフラットな2フィールド（from_object/from_prop,
        /// to_object/to_prop）で表し、from_object/to_objectは省略時self。対象ルートはset/add/destroyと
        /// 同じ制約（selfOnly・allowDragged）を共有する。linked_add（省略可）はaddと同じ構造で、
        /// 実際の移動量に比例してスケールされる副効果。
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

        /// <summary>setを「対象付きの1操作(SetEffect)」の宣言順フラットリストへ読む。</summary>
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

        /// <summary>addを「対象付きの1操作(AddEffect)」の宣言順フラットリストへ読む。</summary>
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
        /// move（対象を、to_propが指すインスタンスIDのオブジェクトの中へ移動する。MoveEffect参照）。
        /// transferと同じフラットフィールド規約（`move: {object: actor, to_prop: destination_id}`）。
        /// objectは現時点でactorのみ対応（それ以外の対象には「どの子か」等の未確定な意味論が伴うため）。
        /// selfOnly文脈（rangeイベント）にはactorが存在しないため使えない。
        /// </summary>
        private MoveEffect ParseMove(string context, YamlMappingNode map, bool selfOnly)
        {
            if (selfOnly)
                throw new YamlLoadException($"{context}: moveはon_min/on_max/on_overflow/on_shortfallでは使えません（actorが存在しないため）。");

            string objectRaw = map.RequireScalar("object", context);
            if (objectRaw != "actor")
                throw new YamlLoadException($"{context}: moveのobjectは現時点で'actor'のみ対応しています（値: '{objectRaw}'）。");

            int toProp = PropertyNames.Intern(map.RequireScalar("to_prop", context));

            var unknownKeys = map.EntriesInOrder().Select(e => e.Key)
                .Where(k => k != "object" && k != "to_prop").ToList();
            if (unknownKeys.Count > 0)
                throw new YamlLoadException($"{context}: 未知のキー '{string.Join(", ", unknownKeys)}' です。");

            return new MoveEffect(ReferenceRoot.Actor, toProp);
        }

        /// <summary>
        /// activeの対象キー（self/parent/ancestor/actor、combinations内はdraggedも）を解決する。
        /// childは「どの子か」を一意に絞る規約が無いため未対応。selfOnly（rangeイベント）は
        /// self以外を一律エラーにする。
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

        /// <summary>destroy（削除対象の直接指定）を読む。単一の対象名か対象名のリストを許容する。
        /// ancestorはプロパティ名が無いと解決できないため、destroyの対象としては未対応。</summary>
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
