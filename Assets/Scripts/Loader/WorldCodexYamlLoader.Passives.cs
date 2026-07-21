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
        /// passivesの1ブロック（self/parent/child/ancestor、actorは未対応のためスキップ）を読み、
        /// PassiveEffectへ変換してoutputへ追加する。forcedStageProperty（非nullならstage内、nullなら
        /// オブジェクト/プロパティレベル）と、このブロックの"conditions"は独立に併用できる（例:「装備している
        /// 間、かつ耐久値がintactステージの間だけ」）。ゲートはグローバルIDのまま持つため（BuildGate参照）、
        /// このobject_def自身のPropertyDefが出来上がっているかどうかに関わらず、その場でPassiveEffectを
        /// 組み上げられる。
        ///
        /// オブジェクトレベル・プロパティレベル・stage内のいずれも、"passives:"は常に配列であり、
        /// この関数はその配列の1要素（conditions/modify/accumulateのみを持つ、他のキーとは同居しない
        /// 独立したマッピング）に対して呼ばれる。conditionsはブロック全体で1つ（対象ごとには持たない。
        /// self対象・parent対象は常に同じSlotBearerを指すため、対象ごとに持たせても意味が重複するだけ。
        /// Runtime.RegisteredPassiveEffect参照）。
        ///
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
        /// ゲートを組み立てる。stagePropertyName（forcedStageProperty）が非nullならWhenOwnStage
        /// （プロパティのグローバルIDとstage名をそのまま持つ。Runtime.WorldObject.IsInStageが評価時に
        /// ローカルIDへ変換する）。conditionsと両方指定されていれば、両方を満たす間だけ有効になる
        /// （例:「装備している間、かつ耐久値がintactステージの間だけ」。PassiveEffect.ActiveAmount参照）。
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
        /// スキップ)ごとにPassiveEffectへ変換してoutputへ追加する。どの具象型（ModifyEffect/AccumulateEffect）
        /// を作るかはmakeEffectファクトリで受け取る（判別enumは持たない）。同じpassiveブロック内のgateを
        /// そのまま共有する（対象・プロパティが違っても、ゲートの意味は同じであるため）。
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
