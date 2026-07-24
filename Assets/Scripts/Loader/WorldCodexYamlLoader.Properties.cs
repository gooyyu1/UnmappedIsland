using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Domain.Runtime;
using YamlDotNet.RepresentationModel;

namespace UnmappedIsland.Loader
{
    public sealed partial class WorldCodexYamlLoader
    {
        /// <summary>props.'propName'エントリを1つ読む（GameElementDefinition.md 6節）。
        /// trait合成済みのノードを渡すこと。</summary>
        public PropertyDef ParseProp(string objectDefName, string propName, YamlMappingNode node, List<PassiveEffect> passives)
        {
            string context = $"'{objectDefName}'.props.'{propName}'";
            int propertyGlobalId = PropertyNames.Intern(propName);

            YamlNode valueNode = node.TryGet("value");
            if (valueNode == null)
                throw new YamlLoadException($"{context}: 必須フィールド 'value' がありません（traitの継承先で指定してください）。");

            PropertyRange? initialValueRange = null;
            int initialValue;
            bool isSymbolProperty;
            if (valueNode is YamlMappingNode rangeValueNode)
            {
                var initRange = new PropertyRange(rangeValueNode.RequireInt("min", context), rangeValueNode.RequireInt("max", context));
                initialValueRange = initRange;
                // 初期値はspawn時に[min,max]の一様乱数で決まる（PropertyDef.CreateValue）。
                // sessionを渡さない直接生成では決定的にminを使う。
                initialValue = initRange.Min;
                isSymbolProperty = false;
            }
            else
            {
                initialValue = ParseScalarNumber(context, ((YamlScalarNode)valueNode).Value, out isSymbolProperty);
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
                onOverflow = ParseRangeEventEffect($"{context}.on_overflow", onOverflowNode);
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
                onShortfall = ParseRangeEventEffect($"{context}.on_shortfall", onShortfallNode);
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
                onMin = ParseRangeEventEffect($"{context}.on_min", onMinNode);
            }

            ActiveEffect onMax = null;
            YamlMappingNode onMaxNode = node.TryGetMapping("on_max", context);
            if (onMaxNode != null)
            {
                if (range == null)
                    throw new YamlLoadException($"{context}: on_maxを使うには'range'が必須です。");
                onMax = ParseRangeEventEffect($"{context}.on_max", onMaxNode);
            }

            bool inherit = node.TryGetBool("inherit", context, fallback: false);

            return new PropertyDef(propertyGlobalId, propName, initialValue, initialValueRange, range, onOverflow, stages, onMin, onShortfall, onMax, inherit);
        }

        /// <summary>
        /// rangeイベント（on_min・on_max・on_overflow・on_shortfall、6節）の中身を読む。activeとpickは
        /// 排他（9.7節・10節）。対象はselfのみ（6.5節）で、pick候補の中の効果にも引き継ぐ。
        /// 空のmapping（`on_shortfall: {}`）は「宣言だけして何もしない」（既定のクランプを打ち消す）を
        /// 意味し、空のActiveEffectsになる。
        /// </summary>
        private ActiveEffect ParseRangeEventEffect(string context, YamlMappingNode node)
        {
            bool hasActive = HasActiveContent(node);
            YamlSequenceNode pickList = node.TryGetSequence("pick", context);
            if (hasActive && pickList != null)
                throw new YamlLoadException($"{context}: set/add/destroy/spawnとpickは同時に指定できません。");

            if (pickList != null)
            {
                var unknownKeys = node.EntriesInOrder().Select(e => e.Key).Where(k => k != "pick").ToList();
                if (unknownKeys.Count > 0)
                    throw new YamlLoadException($"{context}: 未知のキー '{string.Join(", ", unknownKeys)}' です。");
                return new PickEffect(ParsePickList(context, pickList, allowDragged: false, selfOnly: true));
            }

            return ParseActiveEffectBody(context, node, allowDragged: false, selfOnly: true, new[] { "pick" });
        }

        /// <summary>1つのstagesエントリを解釈する（6.4節）。数値型はmin（半開区間）、シンボル型はeq
        /// （nameが比較対象そのもの）を使う。stage内のpassivesも併せて解釈しpassivesへ追記する。</summary>
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

            // stage内のpassivesは常に配列（条件違いの複数ブロックを書けるようにするため）。
            YamlSequenceNode stagePassives = stageMap.TryGetSequence("passives", context);
            if (stagePassives != null)
                foreach (YamlNode passiveNode in stagePassives)
                    ParsePassive(passives, objectDefName, (YamlMappingNode)passiveNode,
                        forcedStageProperty: propName, forcedStageName: stageName);

            return stage;
        }

        /// <summary>シンボル型の値として許容する識別子の形（3.2節の命名規則と同じ）。</summary>
        private static readonly Regex SymbolPattern = new Regex(@"^[a-z][a-z0-9_]*$");

        /// <summary>
        /// 整数・真偽値・シンボル名（識別子）のいずれかとして値を解釈する。識別子形の文字列は
        /// SymbolNamesへ登録してグローバルIDを返す（シンボル型のprops、6節。専用の宣言は不要で
        /// `value`の形だけで判別する）。"true"/"false"がシンボルとして解釈されないよう、判定順は
        /// 整数→真偽値→シンボルで固定する。
        /// </summary>
        private int ParseScalarNumber(string context, string raw) => ParseScalarNumber(context, raw, out _);

        /// <summary>isSymbolは、rawがシンボル名として登録された場合にtrueになる（stagesの解釈分岐、6.4節）。</summary>
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
        /// on_overflow/on_shortfall未指定時の既定動作として、「自分自身をrangeの境界（isMax指定側）へ
        /// setする」ActiveEffectを合成する。著者は`range`を書くだけでクランプが得られ、特別な挙動が
        /// 要る場合だけon_overflow/on_shortfallを明示すればよい。
        /// </summary>
        private static ActiveEffects BuildDefaultOverflowEffect(PropertyRange range, int propertyGlobalId, bool isMax)
        {
            var operations = new List<ActiveEffect>
            {
                new SetEffect(ReferenceRoot.Self, propertyGlobalId, isMax ? range.Max : range.Min),
            };
            return new ActiveEffects(operations);
        }
    }
}
