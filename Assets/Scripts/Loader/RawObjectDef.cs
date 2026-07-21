using System.Collections.Generic;
using System.Linq;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Domain.Runtime;
using YamlDotNet.RepresentationModel;

namespace UnmappedIsland.Loader
{
    /// <summary>
    /// object_defs（GameElementDefinition.md 4節）の1エントリの、まだtrait解決を経ていない生の形。
    /// props/slots/passives/stack_order/actions/combinationsは、フィールド単位の上書きマージ
    /// （props/slots/actions/combinationsの4つ全てが対象。Resolve参照）がまだ起こりうるため、あえて
    /// 意味解釈済みの型にせずYamlMappingNode/YamlSequenceNodeのまま持つ。
    ///
    /// 自分自身の識別性（GlobalId）はtrait解決に依存しないため、パース時点（Loader.
    /// WorldCodexYamlLoader.ParseObjectDef）で確定する。一方、tags・prop/slot名等は、trait側からも
    /// 追加されうる・shallow-overrideで中身が変わりうるため、Resolveの中で初めて確定する。
    /// </summary>
    public sealed class RawObjectDef
    {
        public string Name;

        /// <summary>このobject_defが最初に（どのファイル／どのLoad呼び出しから）読み込まれたか。重複
        /// エラーメッセージの出所表示にのみ使う。</summary>
        public string Source;

        /// <summary>ObjectNames.Internによるこのobject_def自身のグローバルID。trait解決を待たず、
        /// パース時点で確定する（自分自身の識別性はtrait解決に依存しないため）。</summary>
        public int GlobalId;

        public bool IsSingleton;
        public List<string> TraitNames = new List<string>();
        public List<string> Tags = new List<string>();
        public YamlMappingNode Props;
        public YamlMappingNode Slots;
        public YamlSequenceNode Passives;
        public YamlMappingNode StackOrder;

        /// <summary>represented_by（7.6節）で指定されたスロット名。未指定ならnull。</summary>
        public string RepresentedBy;

        public YamlMappingNode Actions;
        public YamlMappingNode Combinations;

        /// <summary>
        /// このobject_defが参照するtraitを合成し（フェーズ1: YAMLノードレベルのマージ）、そこから最終的な
        /// ObjectDefを組み立てる（フェーズ2: loaderのParseProp/ParseSlot/ParsePassive/ParseActions/
        /// ParseCombinationsによる意味解釈）。
        ///
        /// 合成規則（フェーズ1）:
        /// - props/slots/actions/combinations は識別子をキーとする辞書のため、同名エントリが複数のtraitに
        ///   存在する場合はエラー（5節: 「プロパティ衝突はエラー」）。object_def自身が同名エントリを持つ
        ///   場合は、フィールド単位で上書きする（object_def側で指定した属性だけが上書きされ、残りはtrait側
        ///   の値を引き継ぐ）。
        /// - passives は識別子を持たない（when/modify/accumulateブロックの配列）ため、単純に連結する
        ///   （trait由来→自分自身の順、各traitの配列要素もそのままフラットに展開する）。
        /// - stack_order は単一の値なので、自分自身の指定があればそれを優先し、無ければ参照traitのうち
        ///   ちょうど1つが指定している必要がある（複数のtraitが指定していればエラー）。
        /// 未対応（現時点ではCodex側にビルド先の型が無いため意図的にスキップする）: recipes/covers/layer。
        /// </summary>
        public ObjectDef Resolve(IReadOnlyDictionary<string, RawTrait> traitsByName, WorldCodexYamlLoader loader)
        {
            var traitProps = new List<(string TraitName, YamlMappingNode Map)>();
            var traitSlots = new List<(string TraitName, YamlMappingNode Map)>();
            var traitActions = new List<(string TraitName, YamlMappingNode Map)>();
            var traitCombinations = new List<(string TraitName, YamlMappingNode Map)>();
            var passiveNodes = new List<YamlMappingNode>();
            var stackOrderCandidates = new List<(string TraitName, YamlMappingNode Node)>();
            var representedByCandidates = new List<(string TraitName, string SlotName)>();
            var tags = new List<string>();

            foreach (string traitName in TraitNames)
            {
                if (!traitsByName.TryGetValue(traitName, out RawTrait trait))
                    throw new YamlLoadException($"'{Name}' が参照するtrait '{traitName}' が見つかりません。");

                traitProps.Add((traitName, trait.Props));
                traitSlots.Add((traitName, trait.Slots));
                traitActions.Add((traitName, trait.Actions));
                traitCombinations.Add((traitName, trait.Combinations));
                if (trait.Passives != null)
                    foreach (YamlNode passiveNode in trait.Passives)
                        passiveNodes.Add((YamlMappingNode)passiveNode);
                if (trait.StackOrder != null) stackOrderCandidates.Add((traitName, trait.StackOrder));
                if (trait.RepresentedBy != null) representedByCandidates.Add((traitName, trait.RepresentedBy));
                tags.AddRange(trait.Tags);
            }

            YamlMappingNode mergedProps = MergeIdentifierMaps(traitProps, Props, $"'{Name}'のprops");
            YamlMappingNode mergedSlots = MergeIdentifierMaps(traitSlots, Slots, $"'{Name}'のslots");
            YamlMappingNode mergedActions = MergeIdentifierMaps(traitActions, Actions, $"'{Name}'のactions");
            YamlMappingNode mergedCombinations = MergeIdentifierMaps(traitCombinations, Combinations, $"'{Name}'のcombinations");

            if (Passives != null)
                foreach (YamlNode passiveNode in Passives)
                    passiveNodes.Add((YamlMappingNode)passiveNode);

            tags.AddRange(Tags);

            YamlMappingNode stackOrderNode = StackOrder;
            if (stackOrderNode == null)
            {
                if (stackOrderCandidates.Count > 1)
                    throw new YamlLoadException(
                        $"'{Name}': stack_order が複数のtrait（'{stackOrderCandidates[0].TraitName}' と " +
                        $"'{stackOrderCandidates[1].TraitName}'）で重複して宣言されています。");
                if (stackOrderCandidates.Count == 1) stackOrderNode = stackOrderCandidates[0].Node;
            }

            string representedByName = RepresentedBy;
            if (representedByName == null)
            {
                if (representedByCandidates.Count > 1)
                    throw new YamlLoadException(
                        $"'{Name}': represented_by が複数のtrait（'{representedByCandidates[0].TraitName}' と " +
                        $"'{representedByCandidates[1].TraitName}'）で重複して宣言されています。");
                if (representedByCandidates.Count == 1) representedByName = representedByCandidates[0].SlotName;
            }

            // フェーズ2: マージ済みノードから最終的なObjectDefを組み立てる。
            var passives = new List<PassiveEffect>();

            var propertyDefs = new List<PropertyDef>();
            if (mergedProps != null)
                foreach (var (propName, propValueNode) in mergedProps.EntriesInOrder())
                    propertyDefs.Add(loader.ParseProp(Name, propName, (YamlMappingNode)propValueNode, passives));
            var propertyLayout = new LocalIndexMap(loader.PropertyNames.Count, propertyDefs.Select(p => p.GlobalId).ToList());

            var slotDefs = new List<SlotDef>();
            if (mergedSlots != null)
                foreach (var (slotName, slotValueNode) in mergedSlots.EntriesInOrder())
                    slotDefs.Add(loader.ParseSlot(Name, slotName, (YamlMappingNode)slotValueNode));
            var slotLayout = new LocalIndexMap(loader.SlotNames.Count, slotDefs.Select(s => s.GlobalId).ToList());

            foreach (YamlMappingNode passiveNode in passiveNodes)
                loader.ParsePassive(passives, Name, passiveNode, forcedStageProperty: null, forcedStageName: null);

            StackOrderDef stackOrder = null;
            if (stackOrderNode != null)
            {
                string context = $"'{Name}'.stack_order";
                stackOrder = new StackOrderDef(
                    loader.PropertyNames.Intern(stackOrderNode.RequireScalar("property", context)),
                    stackOrderNode.TryGetBool("ascending", context, fallback: false));
            }

            var actions = loader.ParseActions(Name, mergedActions);
            var combinations = loader.ParseCombinations(Name, mergedCombinations);
            var tagIds = tags.Select(loader.TagNames.Intern).Distinct().ToList();
            int? representedBySlotGlobalId = representedByName != null ? loader.SlotNames.Intern(representedByName) : (int?)null;

            return new ObjectDef(
                GlobalId, Name, IsSingleton, propertyLayout, propertyDefs, slotLayout, slotDefs,
                passives, stackOrder, tagIds, actions, combinations, representedBySlotGlobalId);
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
