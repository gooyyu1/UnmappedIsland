using System;
using System.Collections.Generic;
using System.Linq;
using UnmappedIsland.Domain.Defs;
using UnmappedIsland.Domain.Runtime;
using YamlDotNet.RepresentationModel;

namespace UnmappedIsland.Loader
{
    public sealed partial class WorldCodexYamlLoader
    {
        /// <summary>
        /// passivesの1ブロック（"passives:"配列の1要素。conditions/modify/accumulateのみを持つ）を読み、
        /// PassiveEffectへ変換してoutputへ追加する。forcedStageProperty（非nullならstage内）と
        /// "conditions"は独立に併用できる（例:「装備している間、かつ耐久値がintactステージの間だけ」）。
        /// conditionsはブロック全体で1つ（対象ごとには持たない。Runtime.RegisteredPassiveEffect参照）。
        /// RawObjectDef.Resolveから（object/trait直下・props内・stages内のいずれからも）呼ばれる。
        /// </summary>
        public void ParsePassive(
            List<PassiveEffect> output, string objectDefName, YamlMappingNode passiveMap,
            string forcedStageProperty, string forcedStageName)
        {
            string context = $"'{objectDefName}'.passives";

            YamlSequenceNode conditionsNode = passiveMap.TryGetSequence("conditions", context);
            ConditionNode conditions = ParseConditionsField(context, conditionsNode, PassiveConditionRoots);
            PassiveEffectGate gate = BuildGate(conditions, forcedStageProperty, forcedStageName);

            ParsePassiveOperationInto(output, context, passiveMap, "modify",
                (target, propId, amount, g) => new ModifyEffect(target, propId, amount, g), gate);
            ParsePassiveOperationInto(output, context, passiveMap, "accumulate",
                (target, propId, amount, g) => new AccumulateEffect(target, propId, amount, g), gate);

            var knownKeys = new HashSet<string> { "conditions", "modify", "accumulate" };

            var unknownKeys = passiveMap.EntriesInOrder().Select(e => e.Key)
                .Where(k => !knownKeys.Contains(k)).ToList();
            if (unknownKeys.Count > 0)
                throw new YamlLoadException($"{context}: 未知のキー '{string.Join(", ", unknownKeys)}' です。");
        }

        /// <summary>
        /// ゲートを組み立てる。stagePropertyNameとconditionsの両方が指定されていれば、両方を満たす間
        /// だけ有効になる（PassiveEffect.ActiveAmount参照）。ゲートはグローバルIDのまま持ち、評価時に
        /// ローカルIDへ変換する（Runtime.WorldObject.IsInStage参照）。
        /// </summary>
        private PassiveEffectGate BuildGate(ConditionNode conditions, string stagePropertyName, string stageName)
        {
            int? propertyGlobalId = null;
            if (stagePropertyName != null)
                propertyGlobalId = PropertyNames.Intern(stagePropertyName);

            return new PassiveEffectGate(conditions, propertyGlobalId, stageName);
        }

        /// <summary>
        /// passiveの1操作(modify/accumulate)を読み、対象(self/parent/child/ancestor、actorは未対応のため
        /// スキップ)ごとにPassiveEffectへ変換してoutputへ追加する。具象型はmakeEffectファクトリで受け取り、
        /// 同じpassiveブロック内のgateを全効果で共有する。
        /// </summary>
        private void ParsePassiveOperationInto(
            List<PassiveEffect> output, string context, YamlMappingNode passiveMap,
            string operationKey,
            Func<ReferenceRoot, int, int, PassiveEffectGate, PassiveEffect> makeEffect,
            PassiveEffectGate gate)
        {
            YamlMappingNode operationMap = passiveMap.TryGetMapping(operationKey, context);
            if (operationMap == null) return;

            foreach (var (targetName, bodyNode) in operationMap.EntriesInOrder())
            {
                if (targetName == "actor") continue; // 未対応（passiveのtargetにactorは無いため）

                ReferenceRoot target;
                switch (targetName)
                {
                    case "self": target = ReferenceRoot.Self; break;
                    case "parent": target = ReferenceRoot.Parent; break;
                    case "child": target = ReferenceRoot.Child; break;
                    case "ancestor": target = ReferenceRoot.Ancestor; break;
                    default:
                        throw new YamlLoadException($"{context}.{operationKey}: 未知の対象キー '{targetName}' です。");
                }

                var body = (YamlMappingNode)bodyNode;
                foreach (var (propName, amountNode) in body.EntriesInOrder())
                    output.Add(makeEffect(
                        target, PropertyNames.Intern(propName), int.Parse(((YamlScalarNode)amountNode).Value), gate));
            }
        }
    }
}
