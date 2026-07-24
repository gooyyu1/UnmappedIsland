using System.Collections.Generic;
using System.Linq;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Domain.Runtime;
using YamlDotNet.RepresentationModel;

namespace UnmappedIsland.Loader
{
    /// <summary>
    /// object_defs（GameElementDefinition.md 4節）の1エントリの、まだtrait解決を経ていない生の形。
    /// trait上書きマージ（Resolve参照）がまだ起こりうるフィールドは、意味解釈済みの型にせず
    /// 生YAMLノードのまま持つ。GlobalIdのみパース時点で確定し、tags・prop/slot名等はResolveで
    /// 初めて確定する。
    /// </summary>
    public sealed class RawObjectDef
    {
        public string Name;

        /// <summary>読み込み元。重複エラーメッセージの出所表示にのみ使う。</summary>
        public string Source;

        /// <summary>ObjectNames.InternによるグローバルID。trait解決を待たずパース時点で確定する。</summary>
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
        /// 参照するtraitを合成し（フェーズ1: YAMLノードレベルのマージ）、そこから最終的なObjectDefを
        /// 組み立てる（フェーズ2: loaderの各Parseメソッドによる意味解釈）。
        ///
        /// 合成規則（フェーズ1）:
        /// - props/slots/actions/combinations: 同名エントリが複数のtraitにあればエラー（5節）。
        ///   object_def自身が同名エントリを持つ場合はフィールド単位で上書き（残りはtrait側を引き継ぐ）。
        /// - passives: 識別子を持たないため単純に連結（trait由来→自分自身の順）。
        /// - stack_order/represented_by: 自分自身の指定を優先。無ければちょうど1つのtraitが指定して
        ///   いる必要がある（複数ならエラー）。
        /// 未対応（Codex側にビルド先の型が無いため意図的にスキップ）: recipes/covers/layer。
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

        /// <summary>baseNodeのフィールドを持ちつつ、overlayNodeにあるフィールドで上書き・追加する（5節）。</summary>
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
