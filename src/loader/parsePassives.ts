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
import { parseNumberLiteral, parseReferenceRoot } from './parseCommon';
import { parseConditionList } from './parseConditions';
import { parseTransfers } from './parseActiveEffects';
import { YamlLoadError } from './YamlLoadError';
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
 * passivesの1ブロック（"passives:"配列の1要素）を読み、PassiveEffectへ変換して
 * passivesへ追加する。forcedStageProperty（非undefinedならstage内）と
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
  const scope = ReferenceScope.participantProps;
  const gate = buildGate(
    loader,
    parseConditions(loader, context, passiveMap, scope),
    forcedStageProperty,
    forcedStageName,
  );

  parsePassiveBlockInto(loader, passives, context, passiveMap, scope, gate, true);
}

/**
 * 操作が宣言する持続効果（11.7節）の1ブロックを読む。**効くのは`duration`を進めている間だけ**で、
 * 対象に書けるのはその操作の関係が持つ役（11.5節「役を書ける場所」）。
 *
 * **tick毎の輸送（8.4.1節）は書けない。** 輸送は寄与として登録できず、宣言した物のtickで走るので
 * （PassiveEffects.applyTickTransfers）、物ではない操作には走らせる時点が無い。
 */
export function parseInteractionPassiveInto(
  loader: WorldCodexYamlLoader,
  passives: PassiveEffect[],
  context: string,
  passiveMap: YAMLMap,
  scope: ReferenceScope,
): void {
  const gate = buildGate(loader, parseConditions(loader, context, passiveMap, scope), undefined, undefined);

  parsePassiveBlockInto(loader, passives, context, passiveMap, scope, gate, false);
}

function parseConditions(
  loader: WorldCodexYamlLoader,
  context: string,
  passiveMap: YAMLMap,
  scope: ReferenceScope,
): ConditionNode | undefined {
  return parseConditionList(
    loader,
    `${context}.conditions`,
    tryGetSeq(passiveMap, 'conditions', context),
    scope,
  );
}

/**
 * 1ブロックの動詞を読んでpassivesへ積む。**書ける動詞と対象の差は、宣言しているのが物か操作か
 * （declaredByObject）の1点から出る**——物は子を持ちtickが回るが、操作はどちらも持たない。
 *
 * 可逆な寄与（modify）の対象はさらに狭く、複数の操作へ同時に就きうる役へは押せない
 * （8.3節。scopeがその理由を答える）。
 */
function parsePassiveBlockInto(
  loader: WorldCodexYamlLoader,
  passives: PassiveEffect[],
  context: string,
  passiveMap: YAMLMap,
  scope: ReferenceScope,
  gate: PassiveEffectGate,
  declaredByObject: boolean,
): void {
  // 付いている子ごとに登録を配れるのは、子を持つ物の宣言だけ（8.1節。childを指せる唯一の場所）。
  const targets = declaredByObject ? scope.withBroadcast : scope;

  parsePassiveOperationInto(
    loader,
    passives,
    context,
    passiveMap,
    'modify',
    targets.pushingReversibly,
    (target, amount, g) => new ModifyEffect(target, amount, g),
    gate,
  );
  parsePassiveOperationInto(
    loader,
    passives,
    context,
    passiveMap,
    'add',
    targets,
    (target, amount, g) => new AccumulateEffect(target, amount, g),
    gate,
  );

  // 輸送は寄与として登録できない（2つのプロパティを同時に動かすため）ので、宣言元のtickで走る
  // TransferPassiveEffectとして持つ。文法はactiveのtransferと同一（8.4節）。
  const transferNode = tryGetNode(passiveMap, 'transfer');
  if (transferNode !== undefined) {
    if (!declaredByObject)
      throw new YamlLoadError(
        `${context}: tick毎の輸送（transfer）は物のpassivesにしか書けません` +
          '（輸送は宣言した物のtickで走るので、操作には走らせる時点がありません。8.4.1節）。',
      );

    for (const transfer of parseTransfers(loader, `${context}.transfer`, transferNode, scope))
      passives.push(new TransferPassiveEffect(transfer, gate));
  }

  const knownKeys = new Set<string>(['conditions', 'modify', 'add', 'transfer']);

  requireKnownKeys(passiveMap, knownKeys, context);
}

/**
 * ゲートを組み立てる。stagePropertyNameとconditionsの両方が指定されていれば、両方を満たす間
 * だけ有効になる（PassiveEffect.activeAmount参照）。ゲートはグローバルIDのまま持ち、評価時に
 * ローカルIDへ変換する（WorldObject.tryGetProperty参照）。
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
 * passiveの1操作(modify/add)を読み、対象ごとにPassiveEffectへ変換してpassivesへ追加する。**何を対象に
 * 書けるかを答えるのはscope**で、答えられないものはparseReferenceRootが`YamlLoadError`にする——読み飛ばさない。
 * `modify`だけscopeが狭いのは、可逆な寄与を押せる役が限られるため（8.3節、呼び出し元）。具象型は
 * makeEffectファクトリで受け取り、同じpassiveブロック内のgateを全効果で共有する。
 */
function parsePassiveOperationInto(
  loader: WorldCodexYamlLoader,
  passives: PassiveEffect[],
  context: string,
  passiveMap: YAMLMap,
  operationKey: string,
  scope: ReferenceScope,
  makeEffect: (target: PropertyPath, amount: PassiveAmount, gate: PassiveEffectGate) => PassiveEffect,
  gate: PassiveEffectGate,
): void {
  const operationMap = tryGetMap(passiveMap, operationKey, context);
  if (operationMap === undefined) return;

  for (const [targetName, bodyNode] of entriesInOrder(operationMap)) {
    const target = parseReferenceRoot(`${context}.${operationKey}`, targetName, scope);

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
