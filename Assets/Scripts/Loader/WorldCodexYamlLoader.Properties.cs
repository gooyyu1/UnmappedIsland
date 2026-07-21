using System.Collections.Generic;
using System.Text.RegularExpressions;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Domain.Runtime;
using YamlDotNet.RepresentationModel;

namespace UnmappedIsland.Loader
{
    public sealed partial class WorldCodexYamlLoader
    {
        /// <summary>1つのprops.'propName'エントリを解釈し、PropertyDefを組み立てる（GameElementDefinition.md
        /// 6節）。RawObjectDef.Resolveから、trait合成済みのノードに対して呼ばれる。</summary>
        public PropertyDef ParseProp(string objectDefName, string propName, YamlMappingNode node, List<PassiveEffect> passives)
        {
            string context = $"'{objectDefName}'.props.'{propName}'";
            int propertyGlobalId = PropertyNames.Intern(propName);

            YamlNode valueNode = node.TryGet("value");
            if (valueNode == null)
                throw new YamlLoadException($"{context}: 必須フィールド 'value' がありません（traitの継承先で指定してください）。");

            PropertyRange? initialValueRange = null;
            int defaultNumber;
            bool isSymbolProperty;
            if (valueNode is YamlMappingNode rangeValueNode)
            {
                var initial = new PropertyRange(rangeValueNode.RequireInt("min", context), rangeValueNode.RequireInt("max", context));
                initialValueRange = initial;
                // 初期値はspawn時（RNGあり）に[min,max]の一様乱数で決まる（PropertyDef.CreateValue）。
                // RNGを渡さない直接生成では決定的にminをフォールバックとして使う。
                defaultNumber = initial.Min;
                isSymbolProperty = false;
            }
            else
            {
                defaultNumber = ParseScalarNumber(context, ((YamlScalarNode)valueNode).Value, out isSymbolProperty);
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
                onOverflow = ParseActiveEffectBody($"{context}.on_overflow", onOverflowNode, allowDragged: false, selfOnly: true);
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
                onShortfall = ParseActiveEffectBody($"{context}.on_shortfall", onShortfallNode, allowDragged: false, selfOnly: true);
            }
            else
            {
                onShortfall = range.HasValue ? BuildDefaultOverflowEffect(range.Value, propertyGlobalId, isMax: false) : null;
            }

            var stages = new List<PropertyStage>();
            YamlSequenceNode stagesNode = node.TryGetSequence("stages", context);
            if (stagesNode != null)
                foreach (YamlNode stageNode in stagesNode)
                    stages.Add(ParseStage(objectDefName, propName, context, isSymbolProperty, passives, (YamlMappingNode)stageNode));

            YamlSequenceNode propPassives = node.TryGetSequence("passives", context);
            if (propPassives != null)
                foreach (YamlNode passiveNode in propPassives)
                    ParsePassive(passives, objectDefName, (YamlMappingNode)passiveNode,
                        forcedStageProperty: null, forcedStageName: null);

            ActiveEffect onMin = null;
            YamlMappingNode onMinNode = node.TryGetMapping("on_min", context);
            if (onMinNode != null)
            {
                if (range == null)
                    throw new YamlLoadException($"{context}: on_minを使うには'range'が必須です。");
                onMin = ParseActiveEffectBody($"{context}.on_min", onMinNode, allowDragged: false, selfOnly: true);
            }

            ActiveEffect onMax = null;
            YamlMappingNode onMaxNode = node.TryGetMapping("on_max", context);
            if (onMaxNode != null)
            {
                if (range == null)
                    throw new YamlLoadException($"{context}: on_maxを使うには'range'が必須です。");
                onMax = ParseActiveEffectBody($"{context}.on_max", onMaxNode, allowDragged: false, selfOnly: true);
            }

            bool inherit = node.TryGetBool("inherit", context, fallback: false);

            return new PropertyDef(propertyGlobalId, propName, defaultNumber, initialValueRange, range, onOverflow, stages, onMin, onShortfall, onMax, inherit);
        }

        /// <summary>1つのstagesエントリを解釈する（GameElementDefinition.md 6.4節）。プロパティ自身が
        /// シンボル型かどうかで、min（数値型、半開区間）とeq（シンボル型、nameが比較対象そのもの）の
        /// どちらを使うかが変わる。stage内のpassivesもここで併せて解釈し、passivesへ追記する。</summary>
        private PropertyStage ParseStage(
            string objectDefName, string propName, string context, bool isSymbolProperty,
            List<PassiveEffect> passives, YamlMappingNode stageMap)
        {
            string stageName = stageMap.RequireScalar("name", context);
            PropertyStage stage;

            if (isSymbolProperty)
            {
                if (stageMap.TryGet("min") != null)
                    throw new YamlLoadException(
                        $"{context}: シンボル型プロパティのstageに'min'は使えません（'name'自体がそのまま比較対象になります）。");
                stage = new PropertyStage(stageName, min: null, eq: SymbolNames.Intern(stageName));
            }
            else
            {
                int? min = stageMap.TryGetInt("min", context);
                stage = new PropertyStage(stageName, min);
            }

            // stage自身がname/minという固有の属性を持つため配列にできず、passivesは専用の
            // ネストしたキーのまま持つ（when違いの複数ブロックを書けるようにするため常に配列）。
            YamlSequenceNode stagePassives = stageMap.TryGetSequence("passives", context);
            if (stagePassives != null)
                foreach (YamlNode passiveNode in stagePassives)
                    ParsePassive(passives, objectDefName, (YamlMappingNode)passiveNode,
                        forcedStageProperty: propName, forcedStageName: stageName);

            return stage;
        }

        /// <summary>シンボル型の値（整数・真偽値のいずれにもならない識別子）を許容する識別子の形。
        /// 3.2節の命名規則と同じ。</summary>
        private static readonly Regex SymbolPattern = new Regex(@"^[a-z][a-z0-9_]*$");

        /// <summary>
        /// 整数・真偽値・シンボル名（識別子）のいずれかとして値を解釈する。整数・真偽値としてパースできない
        /// 識別子形の文字列は、SymbolNamesへ登録してそのグローバルIDを返す（シンボル型のprops、6節）。
        /// これにより、シンボル型のpropsは専用の宣言（`symbol: true`等）を必要とせず、`value`の形だけで
        /// 自動的に判別できる。boolより先にsymbolを試すと"true"/"false"もシンボルとして解釈されてしまう
        /// ため、判定順は整数→真偽値→シンボルで固定する。
        /// </summary>
        private int ParseScalarNumber(string context, string raw) => ParseScalarNumber(context, raw, out _);

        /// <summary>isSymbolは、rawが整数・真偽値としてパースできず、シンボル名として登録された場合にtrue
        /// になる（propsのstages、6.4節が、プロパティ自身がシンボル型かどうかで解釈を変えるために使う）。</summary>
        private int ParseScalarNumber(string context, string raw, out bool isSymbol)
        {
            isSymbol = false;
            if (int.TryParse(raw, out int number)) return number;
            if (bool.TryParse(raw, out bool boolValue)) return boolValue ? 1 : 0;
            if (SymbolPattern.IsMatch(raw))
            {
                isSymbol = true;
                return SymbolNames.Intern(raw);
            }
            throw new YamlLoadException($"{context}: 値 '{raw}' は整数・真偽値・シンボル名(識別子)のいずれかである必要があります。");
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
            return new ActiveEffect(
                sets,
                adds,
                System.Array.Empty<ReferenceRoot>(),
                System.Array.Empty<SpawnEffect>(),
                System.Array.Empty<TransferEffect>());
        }
    }
}
