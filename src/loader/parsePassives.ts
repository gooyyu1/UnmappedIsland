import type { YAMLMap } from 'yaml';
import {
  asMap,
  asScalarText,
  entriesInOrder,
  requireKnownKeys,
  tryGetMap,
  tryGetNode,
  tryGetSeq,
} from './yamlMapping';
import { YamlLoadError } from './YamlLoadError';
import { parseNumberLiteral } from './parseCommon';
import { parseConditionsField, PASSIVE_CONDITION_ROOTS } from './parseConditions';
import { parsePassiveTransfers } from './parseActiveEffects';
import type { WorldCodexYamlLoader } from './WorldCodexYamlLoader';
import type { ReferenceRoot } from '../domain/ReferenceRoot';
import type { ConditionNode } from '../domain/ConditionNode';
import {
  AccumulateEffect,
  ModifyEffect,
  PassiveEffectGate,
  TransferPassiveEffect,
} from '../domain/PassiveEffect';
import type { PassiveEffect } from '../domain/PassiveEffect';

/**
 * passivesの1ブロック（"passives:"配列の1要素。conditions/modify/add/transferのみを持つ）を読み、
 * PassiveEffectへ変換してpassivesへ追加する。forcedStageProperty（非undefinedならstage内）と
 * "conditions"は独立に併用できる（例:「装備している間、かつ耐久値がintactステージの間だけ」）。
 * conditionsはブロック全体で1つ（対象ごとには持たない。RegisteredPassiveEffect参照）。
 * RawObjectDef.resolveから（object/trait直下・props内・stages内のいずれからも）呼ばれる。
 */
export function parsePassive(
  loader: WorldCodexYamlLoader,
  passives: PassiveEffect[],
  objectDefName: string,
  passiveMap: YAMLMap,
  forcedStageProperty: string | undefined,
  forcedStageName: string | undefined,
): void {
  const context = `'${objectDefName}'.passives`;

  const conditionsNode = tryGetSeq(passiveMap, 'conditions', context);
  const conditions = parseConditionsField(loader, context, conditionsNode, PASSIVE_CONDITION_ROOTS);
  const gate = buildGate(loader, conditions, forcedStageProperty, forcedStageName);

  parsePassiveOperationInto(
    loader,
    passives,
    context,
    passiveMap,
    'modify',
    (target, propId, amount, g) => new ModifyEffect(target, propId, amount, g),
    gate,
  );
  parsePassiveOperationInto(
    loader,
    passives,
    context,
    passiveMap,
    'add',
    (target, propId, amount, g) => new AccumulateEffect(target, propId, amount, g),
    gate,
  );

  // 輸送は寄与として登録できない（2つのプロパティを同時に動かすため）ので、宣言元のtickで走る
  // TransferPassiveEffectとして持つ。文法はactiveのtransferと同一（8.4節）。
  const transferNode = tryGetNode(passiveMap, 'transfer');
  if (transferNode !== undefined)
    for (const transfer of parsePassiveTransfers(loader, `${context}.transfer`, transferNode))
      passives.push(new TransferPassiveEffect(transfer, gate));

  const knownKeys = new Set<string>(['conditions', 'modify', 'add', 'transfer']);

  requireKnownKeys(passiveMap, knownKeys, context);
}

/**
 * ゲートを組み立てる。stagePropertyNameとconditionsの両方が指定されていれば、両方を満たす間
 * だけ有効になる（PassiveEffect.activeAmount参照）。ゲートはグローバルIDのまま持ち、評価時に
 * ローカルIDへ変換する（WorldObject.isInStage参照）。
 */
function buildGate(
  loader: WorldCodexYamlLoader,
  conditions: ConditionNode | undefined,
  stagePropertyName: string | undefined,
  stageName: string | undefined,
): PassiveEffectGate {
  let propertyGlobalId: number | undefined;
  if (stagePropertyName !== undefined) propertyGlobalId = loader.propertyNames.intern(stagePropertyName);

  return new PassiveEffectGate(conditions, propertyGlobalId, stageName);
}

/**
 * passiveの1操作(modify/add)を読み、対象(self/parent/child/ancestor、actorは未対応のため
 * スキップ)ごとにPassiveEffectへ変換してpassivesへ追加する。具象型はmakeEffectファクトリで受け取り、
 * 同じpassiveブロック内のgateを全効果で共有する。
 */
function parsePassiveOperationInto(
  loader: WorldCodexYamlLoader,
  passives: PassiveEffect[],
  context: string,
  passiveMap: YAMLMap,
  operationKey: string,
  makeEffect: (
    target: ReferenceRoot,
    propertyGlobalId: number,
    amount: number,
    gate: PassiveEffectGate,
  ) => PassiveEffect,
  gate: PassiveEffectGate,
): void {
  const operationMap = tryGetMap(passiveMap, operationKey, context);
  if (operationMap === undefined) return;

  for (const [targetName, bodyNode] of entriesInOrder(operationMap)) {
    if (targetName === 'actor') continue; // 未対応（passiveのtargetにactorは無いため）

    let target: ReferenceRoot;
    switch (targetName) {
      case 'self':
        target = 'self';
        break;
      case 'parent':
        target = 'parent';
        break;
      case 'child':
        target = 'child';
        break;
      case 'ancestor':
        target = 'ancestor';
        break;
      default:
        throw new YamlLoadError(`${context}.${operationKey}: 未知の対象キー '${targetName}' です。`);
    }

    const body = asMap(bodyNode, context);
    for (const [propName, amountNode] of entriesInOrder(body))
      passives.push(
        makeEffect(
          target,
          loader.propertyNames.intern(propName),
          parseNumberLiteral(context, asScalarText(amountNode, context)),
          gate,
        ),
      );
  }
}
