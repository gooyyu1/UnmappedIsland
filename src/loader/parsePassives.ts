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
import { parseNumberLiteral } from './parseCommon';
import { parseConditionsField, parseSubjectRoot } from './parseConditions';
import { parsePassiveTransfers } from './parseActiveEffects';
import type { WorldCodexYamlLoader } from './WorldCodexYamlLoader';
import { PropertyPath, ReferenceScope } from '../domain/ReferenceRoot';
import type { PassiveAmount } from '../domain/PassiveAmount';
import { FixedAmount } from '../domain/PassiveAmount';
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
export function parsePassiveInto(
  loader: WorldCodexYamlLoader,
  passives: PassiveEffect[],
  objectDefName: string,
  passiveMap: YAMLMap,
  forcedStageProperty: string | undefined,
  forcedStageName: string | undefined,
): void {
  const context = `'${objectDefName}'.passives`;

  const conditionsNode = tryGetSeq(passiveMap, 'conditions', context);
  const conditions = parseConditionsField(loader, context, conditionsNode, ReferenceScope.declaration);
  const gate = buildGate(loader, conditions, forcedStageProperty, forcedStageName);

  parsePassiveOperationInto(
    loader,
    passives,
    context,
    passiveMap,
    'modify',
    (target, amount, g) => new ModifyEffect(target, amount, g),
    gate,
  );
  parsePassiveOperationInto(
    loader,
    passives,
    context,
    passiveMap,
    'add',
    (target, amount, g) => new AccumulateEffect(target, amount, g),
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
  // プロパティと段の名前は組で1つ（どちらか片方だけでは段を指せない）。
  const stage =
    stagePropertyName === undefined || stageName === undefined
      ? undefined
      : { propertyGlobalId: loader.propertyNames.intern(stagePropertyName), name: stageName };

  return new PassiveEffectGate(conditions, stage);
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
  makeEffect: (target: PropertyPath, amount: PassiveAmount, gate: PassiveEffectGate) => PassiveEffect,
  gate: PassiveEffectGate,
): void {
  const operationMap = tryGetMap(passiveMap, operationKey, context);
  if (operationMap === undefined) return;

  // 対象は付いている子ごとに登録を配れるので、childを指せる唯一の場所（8.1節）。
  const scope = ReferenceScope.declaration.withBroadcast;

  for (const [targetName, bodyNode] of entriesInOrder(operationMap)) {
    const target = parseSubjectRoot(`${context}.${operationKey}`, targetName, scope);

    const body = asMap(bodyNode, context);
    for (const [propName, amountNode] of entriesInOrder(body))
      passives.push(
        makeEffect(
          new PropertyPath(target, loader.propertyNames.intern(propName)),
          new FixedAmount(parseNumberLiteral(context, asScalarText(amountNode, context))),
          gate,
        ),
      );
  }
}
