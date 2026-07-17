using System.Collections.Generic;
using YamlDotNet.RepresentationModel;

namespace UnmappedIsland.Loader
{
    /// <summary>
    /// traits（GameElementDefinition.md 5節、mixin）の解決。1つのobject_defが参照する0個以上のtraitを、
    /// 自分自身のprops/slots/passive/stack_orderへ合成する。多重継承は禁止（traitは他のtraitを参照できない）
    /// なので、この合成は常に1階層で完結する。
    ///
    /// 合成規則:
    /// - props/slots は識別子をキーとする辞書のため、同名エントリが複数のtraitに存在する場合はエラー
    ///   （5節: 「プロパティ衝突はエラー」）。object_def自身が同名エントリを持つ場合は、フィールド単位で
    ///   上書きする（object_def側で指定した属性だけが上書きされ、残りはtrait側の値を引き継ぐ）。
    /// - passive は識別子を持たない（対象キーの束）ため、単純に連結する（trait由来→object_def自身の順）。
    /// - stack_order は単一の値なので、object_def自身の指定があればそれを優先し、無ければ参照traitのうち
    ///   ちょうど1つが指定している必要がある（複数のtraitが指定していればエラー）。
    /// 未対応（現時点ではCodex側にビルド先の型が無いため意図的にスキップする）: actions/combinations/recipes。
    /// </summary>
    internal static class TraitMerger
    {
        public sealed class RawObjectDef
        {
            public string Name;
            public bool IsSingleton;
            public List<string> TraitNames = new List<string>();
            public YamlMappingNode Props;
            public YamlMappingNode Slots;
            public YamlMappingNode Passive;
            public YamlMappingNode StackOrder;
            public YamlMappingNode Actions;
            public YamlMappingNode Combinations;
        }

        public sealed class RawTrait
        {
            public string Name;
            public YamlMappingNode Props;
            public YamlMappingNode Slots;
            public YamlMappingNode Passive;
            public YamlMappingNode StackOrder;
            public YamlMappingNode Actions;
            public YamlMappingNode Combinations;
        }

        public static RawObjectDef ParseObjectDefEntry(string name, YamlMappingNode node)
        {
            string context = $"object_defs.'{name}'";

            var raw = new RawObjectDef
            {
                Name = name,
                IsSingleton = node.TryGetBool("singleton", context, fallback: false),
                Props = node.TryGetMapping("props", context),
                Slots = node.TryGetMapping("slots", context),
                Passive = node.TryGetMapping("passive", context),
                StackOrder = node.TryGetMapping("stack_order", context),
                Actions = node.TryGetMapping("actions", context),
                Combinations = node.TryGetMapping("combinations", context),
            };

            YamlSequenceNode traits = node.TryGetSequence("traits", context);
            if (traits != null)
                foreach (YamlNode t in traits)
                    raw.TraitNames.Add(((YamlScalarNode)t).Value);

            return raw;
        }

        public static RawTrait ParseTraitEntry(string name, YamlMappingNode node)
        {
            string context = $"traits.'{name}'";

            return new RawTrait
            {
                Name = name,
                Props = node.TryGetMapping("props", context),
                Slots = node.TryGetMapping("slots", context),
                Passive = node.TryGetMapping("passive", context),
                StackOrder = node.TryGetMapping("stack_order", context),
                Actions = node.TryGetMapping("actions", context),
                Combinations = node.TryGetMapping("combinations", context),
            };
        }

        /// <summary>object_defが参照するtraitを合成し、最終的なprops/slots/passive/stack_order/actions/
        /// combinationsノードを返す。passiveは合成済みの単一ノードではなく、trait分→自分自身の順で並んだ
        /// ノードの列として返す（呼び出し側でParsePassiveMapIntoを順番に適用する。合成に識別子のキー衝突
        /// 検証が不要なため）。</summary>
        public static (
            YamlMappingNode Props, YamlMappingNode Slots, IReadOnlyList<YamlMappingNode> PassiveNodes,
            YamlMappingNode StackOrder, YamlMappingNode Actions, YamlMappingNode Combinations)
            Resolve(RawObjectDef entry, IReadOnlyDictionary<string, RawTrait> traitsByName)
        {
            var traitProps = new List<(string TraitName, YamlMappingNode Map)>();
            var traitSlots = new List<(string TraitName, YamlMappingNode Map)>();
            var traitActions = new List<(string TraitName, YamlMappingNode Map)>();
            var traitCombinations = new List<(string TraitName, YamlMappingNode Map)>();
            var passiveNodes = new List<YamlMappingNode>();
            var stackOrderCandidates = new List<(string TraitName, YamlMappingNode Node)>();

            foreach (string traitName in entry.TraitNames)
            {
                if (!traitsByName.TryGetValue(traitName, out RawTrait trait))
                    throw new YamlLoadException($"'{entry.Name}' が参照するtrait '{traitName}' が見つかりません。");

                traitProps.Add((traitName, trait.Props));
                traitSlots.Add((traitName, trait.Slots));
                traitActions.Add((traitName, trait.Actions));
                traitCombinations.Add((traitName, trait.Combinations));
                if (trait.Passive != null) passiveNodes.Add(trait.Passive);
                if (trait.StackOrder != null) stackOrderCandidates.Add((traitName, trait.StackOrder));
            }

            YamlMappingNode mergedProps = MergeIdentifierMaps(traitProps, entry.Props, $"'{entry.Name}'のprops");
            YamlMappingNode mergedSlots = MergeIdentifierMaps(traitSlots, entry.Slots, $"'{entry.Name}'のslots");
            YamlMappingNode mergedActions = MergeIdentifierMaps(traitActions, entry.Actions, $"'{entry.Name}'のactions");
            YamlMappingNode mergedCombinations =
                MergeIdentifierMaps(traitCombinations, entry.Combinations, $"'{entry.Name}'のcombinations");

            if (entry.Passive != null) passiveNodes.Add(entry.Passive);

            YamlMappingNode stackOrder = entry.StackOrder;
            if (stackOrder == null)
            {
                if (stackOrderCandidates.Count > 1)
                    throw new YamlLoadException(
                        $"'{entry.Name}': stack_order が複数のtrait（'{stackOrderCandidates[0].TraitName}' と " +
                        $"'{stackOrderCandidates[1].TraitName}'）で重複して宣言されています。");
                if (stackOrderCandidates.Count == 1) stackOrder = stackOrderCandidates[0].Node;
            }

            return (mergedProps, mergedSlots, passiveNodes, stackOrder, mergedActions, mergedCombinations);
        }

        private static YamlMappingNode MergeIdentifierMaps(
            IReadOnlyList<(string TraitName, YamlMappingNode Map)> traitMaps, YamlMappingNode ownMap, string fieldLabel)
        {
            var order = new List<string>();
            var byKey = new Dictionary<string, YamlNode>();
            var owningTrait = new Dictionary<string, string>();

            foreach (var (traitName, map) in traitMaps)
            {
                if (map == null) continue;
                foreach (var (key, value) in map.EntriesInOrder())
                {
                    if (owningTrait.ContainsKey(key))
                        throw new YamlLoadException(
                            $"{fieldLabel} '{key}' が複数のtrait（'{owningTrait[key]}' と '{traitName}'）で重複して宣言されています。");
                    owningTrait[key] = traitName;
                    order.Add(key);
                    byKey[key] = value;
                }
            }

            if (ownMap != null)
            {
                foreach (var (key, value) in ownMap.EntriesInOrder())
                {
                    if (byKey.TryGetValue(key, out YamlNode traitValue))
                    {
                        byKey[key] = ShallowMergeFields((YamlMappingNode)traitValue, (YamlMappingNode)value);
                    }
                    else
                    {
                        order.Add(key);
                        byKey[key] = value;
                    }
                }
            }

            if (order.Count == 0) return null;

            var result = new YamlMappingNode();
            foreach (string key in order) result.Add(new YamlScalarNode(key), byKey[key]);
            return result;
        }

        /// <summary>baseNodeのフィールドをそのまま持ちつつ、overlayNodeにあるフィールドで上書き・追加する
        /// （object_def自身がtraitの一部の属性だけを上書きし、残りはtrait側を引き継ぐ、5節）。</summary>
        private static YamlMappingNode ShallowMergeFields(YamlMappingNode baseNode, YamlMappingNode overlayNode)
        {
            var order = new List<string>();
            var byKey = new Dictionary<string, YamlNode>();

            foreach (var (key, value) in baseNode.EntriesInOrder())
            {
                order.Add(key);
                byKey[key] = value;
            }

            foreach (var (key, value) in overlayNode.EntriesInOrder())
            {
                if (!byKey.ContainsKey(key)) order.Add(key);
                byKey[key] = value;
            }

            var result = new YamlMappingNode();
            foreach (string key in order) result.Add(new YamlScalarNode(key), byKey[key]);
            return result;
        }
    }
}
