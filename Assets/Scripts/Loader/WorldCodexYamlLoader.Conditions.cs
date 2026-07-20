using System.Collections.Generic;
using System.Linq;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Domain.Runtime;
using YamlDotNet.RepresentationModel;

namespace UnmappedIsland.Loader
{
    public sealed partial class WorldCodexYamlLoader
    {
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
        private ConditionNode ParseConditionsField(
            string context, YamlSequenceNode conditionsNode, IReadOnlyCollection<ReferenceRoot> allowedRoots)
        {
            if (conditionsNode == null) return null;

            var children = new List<ConditionNode>();
            foreach (YamlNode node in conditionsNode)
                children.Add(ParseConditionNode($"{context}.conditions[{children.Count}]", node, allowedRoots));

            return ConditionNode.All(children);
        }

        /// <summary>条件木の1ノードを読む。all/any/notのいずれかのキーを持てば複合ノード、それ以外は
        /// 葉（プロパティ比較・スロット位置判定・スロット中身判定のいずれか）として読む。</summary>
        private ConditionNode ParseConditionNode(
            string context, YamlNode node, IReadOnlyCollection<ReferenceRoot> allowedRoots)
        {
            var map = (YamlMappingNode)node;

            YamlSequenceNode allNode = map.TryGetSequence("all", context);
            YamlSequenceNode anyNode = map.TryGetSequence("any", context);
            YamlNode notNode = map.TryGet("not");

            int combinatorCount = (allNode != null ? 1 : 0) + (anyNode != null ? 1 : 0) + (notNode != null ? 1 : 0);
            if (combinatorCount > 1)
                throw new YamlLoadException($"{context}: all/any/notは同時に指定できません。");

            if (allNode != null) return ConditionNode.All(ParseCombinatorChildren(context, "all", allNode, allowedRoots));
            if (anyNode != null) return ConditionNode.Any(ParseCombinatorChildren(context, "any", anyNode, allowedRoots));

            if (notNode != null)
            {
                var unknown = map.EntriesInOrder().Select(e => e.Key).Where(k => k != "not").ToList();
                if (unknown.Count > 0)
                    throw new YamlLoadException($"{context}: 'not'は他のキーと同居できません（値: '{string.Join(", ", unknown)}'）。");

                return ConditionNode.Not(ParseConditionNode($"{context}.not", notNode, allowedRoots));
            }

            return ParseConditionLeaf(context, map, allowedRoots);
        }

        private List<ConditionNode> ParseCombinatorChildren(
            string context, string key, YamlSequenceNode seq, IReadOnlyCollection<ReferenceRoot> allowedRoots)
        {
            var children = new List<ConditionNode>();
            foreach (YamlNode node in seq)
                children.Add(ParseConditionNode($"{context}.{key}[{children.Count}]", node, allowedRoots));
            return children;
        }

        /// <summary>
        /// 条件木の葉。objectは省略時self。{object, prop, op(省略時eq), value}のプロパティ比較、
        /// {object, in_slot}のスロット位置判定（常に等価判定。opは持たない）、{object, slot, tag}の
        /// スロット中身判定（objectの自分のslotの中に、tagを持つ子がいるかの存在判定）のいずれかで、
        /// 同時には指定できない。in_slot（外から見た位置）とslot（内側の中身）はキー名自体を分けており、
        /// 混同の余地はない。プロパティ比較のvalueは、リテラル（整数・真偽値・シンボル名）か、
        /// {object, prop}参照（weightのpath参照、10.2節と同じ二択）のいずれか。参照はlt/lte/gt/gte/eq/neqの
        /// みで使える（in/not_inは複数値との比較のため、参照とは噛み合わない）。
        /// </summary>
        private ConditionNode ParseConditionLeaf(
            string context, YamlMappingNode map, IReadOnlyCollection<ReferenceRoot> allowedRoots)
        {
            string objectName = map.TryGetScalar("object", context);
            ReferenceRoot root = objectName != null ? ParseConditionObject(context, objectName, allowedRoots) : ReferenceRoot.Self;

            string inSlotName = map.TryGetScalar("in_slot", context);
            string slotName = map.TryGetScalar("slot", context);
            string tagName = map.TryGetScalar("tag", context);
            string propName = map.TryGetScalar("prop", context);

            int leafKeyCount = (inSlotName != null ? 1 : 0) + (slotName != null ? 1 : 0) + (propName != null ? 1 : 0);
            if (leafKeyCount > 1)
                throw new YamlLoadException($"{context}: 'in_slot'/'slot'/'prop'は同時に指定できません。");

            if (inSlotName != null)
            {
                if (root == ReferenceRoot.Ancestor)
                    throw new YamlLoadException(
                        $"{context}: in_slot判定でobject 'ancestor'は未対応です（ancestorはプロパティ名で祖先を探すため、探すプロパティを持たないin_slot判定とは噛み合いません）。");

                var unknownInSlotKeys = map.EntriesInOrder().Select(e => e.Key)
                    .Where(k => k != "object" && k != "in_slot").ToList();
                if (unknownInSlotKeys.Count > 0)
                    throw new YamlLoadException(
                        $"{context}: 未知のキー '{string.Join(", ", unknownInSlotKeys)}' です（in_slot判定はobject/in_slotのみ持てます）。");

                return ConditionNode.SlotPosition(root, SlotNames.Intern(inSlotName));
            }

            if (slotName != null)
            {
                if (tagName == null)
                    throw new YamlLoadException($"{context}: 'slot'を使うスロット中身判定には'tag'が必須です。");

                var unknownSlotKeys = map.EntriesInOrder().Select(e => e.Key)
                    .Where(k => k != "object" && k != "slot" && k != "tag").ToList();
                if (unknownSlotKeys.Count > 0)
                    throw new YamlLoadException(
                        $"{context}: 未知のキー '{string.Join(", ", unknownSlotKeys)}' です（スロット中身判定はobject/slot/tagのみ持てます）。");

                return ConditionNode.SlotContent(root, SlotNames.Intern(slotName), TagNames.Intern(tagName));
            }

            if (tagName != null)
                throw new YamlLoadException($"{context}: 'tag'は'slot'と組み合わせてのみ使えます。");

            if (propName == null)
                throw new YamlLoadException($"{context}: 'prop'・'in_slot'・'slot'のいずれかが必要です。");

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

            if (valueNode is YamlMappingNode valueRefMap)
            {
                if (op == ConditionOp.In || op == ConditionOp.NotIn)
                    throw new YamlLoadException($"{context}: op '{op}' は{{object, prop}}参照のvalueと組み合わせられません（複数値との比較のため）。");

                string refObjectName = valueRefMap.TryGetScalar("object", context);
                ReferenceRoot refRoot = refObjectName != null ? ParseConditionObject(context, refObjectName, allowedRoots) : ReferenceRoot.Self;
                string refPropName = valueRefMap.RequireScalar("prop", context);

                var unknownRefKeys = valueRefMap.EntriesInOrder().Select(e => e.Key)
                    .Where(k => k != "object" && k != "prop").ToList();
                if (unknownRefKeys.Count > 0)
                    throw new YamlLoadException($"{context}.value: 未知のキー '{string.Join(", ", unknownRefKeys)}' です。");

                var valueRef = new PropertyPath(refRoot, PropertyNames.Intern(refPropName));
                return ConditionNode.Property(root, PropertyNames.Intern(propName), op, values: null, valueRef: valueRef);
            }

            List<PropertyValue> values = ParseConditionValues(context, op, valueNode);
            return ConditionNode.Property(root, PropertyNames.Intern(propName), op, values);
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

        private List<PropertyValue> ParseConditionValues(string context, ConditionOp op, YamlNode valueNode)
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

        private PropertyValue ParseConditionScalar(string context, string raw)
        {
            if (raw == "max" || raw == "min")
                throw new YamlLoadException(
                    $"{context}: value '{raw}' は未対応です（参照先プロパティのrangeの{raw}を指す規約がまだ確定していないため）。");

            return PropertyValue.FromNumber(ParseScalarNumber(context, raw));
        }
    }
}
