import type { YAMLMap } from 'yaml';
import { isMap } from 'yaml';
import {
  asMap,
  asScalarText,
  oneOf,
  requireKnownKeys,
  requireNumber,
  requireScalar,
  tryGetMap,
  tryGetNode,
  tryGetNumber,
  tryGetScalar,
  tryGetSeq,
} from './yamlMapping';
import type { YamlNode } from './yamlMapping';
import { YamlLoadError } from './YamlLoadError';
import { withYamlContext, parseNumberOrSymbol } from './parseCommon';
import { parseActiveEffectBody } from './parseActiveEffects';
import { parseConditionList, parseSubjectRoot } from './parseConditions';
import { parsePassiveInto } from './parsePassives';
import type { WorldCodexYamlLoader } from './WorldCodexYamlLoader';
import { ALERT_LEVELS } from '../domain/AlertLevel';
import type { RangeEventDef } from '../domain/PropertyDef';
import { GAUGE_ENDS, GaugeDef, PropertyDef, PropertyRange, PropertyStage } from '../domain/PropertyDef';
import type { PassiveEffect } from '../domain/PassiveEffect';
import { PropertyPath, ReferenceScope } from '../domain/ReferenceRoot';

/** props（6節）の1エントリが持てるキー。これ以外はロードエラー（綴り間違いをその場で捕まえる）。
 * unitは単位表記などの注記用で、ローダーは解釈しない（WorldCodex.schema.json参照）。 */
const KNOWN_PROP_KEYS = new Set<string>([
  'value',
  'unit',
  'range',
  'on_max',
  'on_min',
  'stages',
  'passives',
  'base',
  'tags',
  'gauge',
]);

/** props.'propName'エントリを1つ読む（GameElementDefinition.md 6節）。
 * trait合成済みのノードを渡すこと。 */
export function parsePropAppendingPassives(
  loader: WorldCodexYamlLoader,
  objectDefName: string,
  propName: string,
  node: YAMLMap,
  passives: PassiveEffect[],
): PropertyDef {
  const context = `'${objectDefName}'.props.'${propName}'`;
  const propertyGlobalId = loader.propertyNames.intern(propName);

  requireKnownKeys(node, KNOWN_PROP_KEYS, context);

  const valueNode = tryGetNode(node, 'value');
  if (valueNode === undefined)
    throw new YamlLoadError(
      `${context}: 必須フィールド 'value' がありません（traitの継承先で指定してください）。`,
    );

  let initialValueRange: PropertyRange | undefined;
  let initialValue: number;
  let isSymbolProperty: boolean;
  let isObjectProperty = false;
  if (isMap(valueNode) && tryGetNode(valueNode, 'object') !== undefined) {
    // 型を指す値（6.9節）。持つのはobject_defのグローバルIDで、ロードした時点で決まる定数。
    // singletonであることの検査は、行き先を型で名指した宣言と同じ経路へ乗せる。
    requireKnownKeys(valueNode, ['object'], `${context}.value`);
    initialValue = loader.objectNames.intern(requireScalar(valueNode, 'object', context));
    loader.noteObjectDefDestination(initialValue, `${context}.value.object`);
    isSymbolProperty = false;
    isObjectProperty = true;
  } else if (isMap(valueNode)) {
    const initRange = new PropertyRange(
      requireNumber(valueNode, 'min', context),
      requireNumber(valueNode, 'max', context),
    );
    initialValueRange = initRange;
    // 初期値はspawn時に[min,max]の一様乱数で決まる（PropertyDef.rollInitialValue）。
    // sessionを渡さない直接生成では決定的にminを使う。
    initialValue = initRange.min;
    isSymbolProperty = false;
  } else {
    [initialValue, isSymbolProperty] = parseNumberOrSymbol(loader, context, asScalarText(valueNode, context));
  }

  let range: PropertyRange | undefined;
  const rangeSpec = tryGetMap(node, 'range', context);
  if (rangeSpec !== undefined)
    range = new PropertyRange(
      requireNumber(rangeSpec, 'min', context),
      requireNumber(rangeSpec, 'max', context),
    );

  // 未指定のときは渡さない。rangeを持つプロパティの既定のクランプはPropertyDef自身が組み立てる。
  const onMax = parseOptionalRangeEvent(loader, context, node, 'on_max');
  const onMin = parseOptionalRangeEvent(loader, context, node, 'on_min');

  const stages: PropertyStage[] = [];
  const stagesNode = tryGetSeq(node, 'stages', context);
  if (stagesNode !== undefined)
    for (const stageNode of stagesNode.items as YamlNode[])
      stages.push(
        parseStageAppendingPassives(
          loader,
          objectDefName,
          propName,
          context,
          isSymbolProperty,
          passives,
          asMap(stageNode, context),
        ),
      );

  const propPassives = tryGetSeq(node, 'passives', context);
  if (propPassives !== undefined)
    for (const passiveNode of propPassives.items as YamlNode[])
      parsePassiveInto(loader, passives, objectDefName, asMap(passiveNode, context), undefined, undefined);

  const base = parseBase(loader, context, node, propertyGlobalId);
  const tags = parsePropertyTags(loader, context, node);
  const gauge = parseGauge(context, node);

  return withYamlContext(
    context,
    () =>
      new PropertyDef(
        propertyGlobalId,
        propName,
        initialValue,
        initialValueRange,
        range,
        onMax,
        stages,
        onMin,
        base,
        tags,
        isSymbolProperty,
        gauge,
        isObjectProperty,
      ),
  );
}

/**
 * props.'name'.base（6.5節）を読む。土台は`{subject, prop}`の1階層のプロパティ参照（PropertyPath）で、
 * `subject`の既定は`self`。`prop`を省くと同名のプロパティを指す（祖先の同じ値を土台にする、
 * いちばん多い形）。
 *
 * `subject: self`で`prop`を省くと自分自身が土台になってしまうので、そこだけ`prop`を必須にする。
 */
function parseBase(
  loader: WorldCodexYamlLoader,
  context: string,
  node: YAMLMap,
  propertyGlobalId: number,
): PropertyPath | undefined {
  const baseNode = tryGetMap(node, 'base', context);
  if (baseNode === undefined) return undefined;

  const baseContext = `${context}.base`;
  requireKnownKeys(baseNode, ['subject', 'prop'], baseContext);

  const subjectName = tryGetScalar(baseNode, 'subject', baseContext);
  const root =
    subjectName === undefined
      ? 'self'
      : parseSubjectRoot(baseContext, subjectName, ReferenceScope.declaration);

  const basePropName = tryGetScalar(baseNode, 'prop', baseContext);
  if (basePropName === undefined) {
    if (root === 'self')
      throw new YamlLoadError(
        `${baseContext}: subject 'self' のときは 'prop' が必要です（省略すると自分自身が土台になります）。`,
      );
    return new PropertyPath(root, propertyGlobalId);
  }

  return new PropertyPath(root, loader.propertyNames.intern(basePropName));
}

/**
 * props.'name'.gauge（6.8節）を読む。カードにバーとして出すかと、両端の見せ方を宣言する。
 *
 * rangeを必須にするのは、割合が定義できなければバーとして描きようがないため（同6.4節のratioOf）。
 */
function parseGauge(context: string, node: YAMLMap): GaugeDef | undefined {
  const gaugeNode = tryGetMap(node, 'gauge', context);
  if (gaugeNode === undefined) return undefined;

  requireKnownKeys(gaugeNode, ['min', 'max'], `${context}.gauge`);

  const gaugeContext = `${context}.gauge`;
  return new GaugeDef(
    oneOf(gaugeNode, 'min', gaugeContext, GAUGE_ENDS),
    oneOf(gaugeNode, 'max', gaugeContext, GAUGE_ENDS),
  );
}

/**
 * props.'name'.tags（6.7節）を読む。未宣言のタグ名はエラーにする（object_defのtagsと違い、
 * property_tagsという宣言の場があるため、綴り間違いをロード時に捕まえられる）。
 */
function parsePropertyTags(loader: WorldCodexYamlLoader, context: string, node: YAMLMap): readonly number[] {
  const tagsNode = tryGetSeq(node, 'tags', context);
  if (tagsNode === undefined) return [];

  const tagIds = new Set<number>();
  for (const item of tagsNode.items as YamlNode[]) {
    const tagName = asScalarText(item, context);
    const tagId = loader.propertyTagNames.tryGetId(tagName);
    if (tagId === undefined)
      throw new YamlLoadError(
        `${context}: プロパティタグ '${tagName}' が property_tags（6.7節）で宣言されていません。`,
      );
    tagIds.add(tagId);
  }
  return [...tagIds];
}

/** 1つのstagesエントリを解釈する（6.4節）。数値型はmin（半開区間）、シンボル型はeq
 * （nameが比較対象そのもの）を使う。stage内のpassivesも併せて解釈しpassivesへ追記する。 */
function parseStageAppendingPassives(
  loader: WorldCodexYamlLoader,
  objectDefName: string,
  propName: string,
  context: string,
  isSymbolProperty: boolean,
  passives: PassiveEffect[],
  stageMap: YAMLMap,
): PropertyStage {
  const stageName = requireScalar(stageMap, 'name', context);
  const alert = oneOf(stageMap, 'alert', context, ALERT_LEVELS, 'safe');
  // 段が宣言するart接尾辞（6.4節）。art_by_stageが指すプロパティの段だけがこれを持てるが、
  // その検証は object_def 全体を見渡せる RawObjectDef.resolve が行う（ここでは持たない）。
  const art = tryGetScalar(stageMap, 'art', context);
  // 段が名乗る状況アイコンの識別子（6.4節）。artと違い名乗れるプロパティを絞らない——画面は
  // プロパティの意味を知らずに並べるので、どれが名乗ってもよい（docs/ui/ScreenLayout.md 4.1.1節）。
  const situation = tryGetScalar(stageMap, 'situation', context);

  // minはシンボル型でも読み取っておく。書いてはいけないことは PropertyDef が型と段の両方を見て言う。
  const min = tryGetNumber(stageMap, 'min', context);
  const stage = isSymbolProperty
    ? new PropertyStage(stageName, min, loader.symbolNames.intern(stageName), alert, art, situation)
    : new PropertyStage(stageName, min, undefined, alert, art, situation);

  // stage内のpassivesは常に配列（条件違いの複数ブロックを書けるようにするため）。
  const stagePassives = tryGetSeq(stageMap, 'passives', context);
  if (stagePassives !== undefined)
    for (const passiveNode of stagePassives.items as YamlNode[])
      parsePassiveInto(loader, passives, objectDefName, asMap(passiveNode, context), propName, stageName);

  return stage;
}

/** rangeイベントが持てる、効果以外の兄弟キー。 */
const RANGE_EVENT_RESERVED_KEYS = ['conditions'] as const;

/**
 * labelのrangeイベント（on_max・on_min、6.3節）が書かれていればその中身。書かれていなければundefined。
 *
 * 誰かが操作しているとは限らないので、この場に居るのは宣言元の個体だけ（`ReferenceScope.declaration`）
 * で、pick候補の中の効果にも引き継ぐ。空のmapping（`on_min: {}`）は「宣言だけして
 * 何もしない」（既定のクランプを打ち消す）を意味し、空のActiveEffectSequenceになる。`conditions`
 * （14節）を書くと、満たす回だけがこの中身へ、満たさない回は既定のクランプへ倒れる（RangeEventDef）。
 */
function parseOptionalRangeEvent(
  loader: WorldCodexYamlLoader,
  context: string,
  node: YAMLMap,
  label: 'on_max' | 'on_min',
): RangeEventDef | undefined {
  const eventNode = tryGetMap(node, label, context);
  if (eventNode === undefined) return undefined;

  const eventContext = `${context}.${label}`;
  return {
    condition: parseConditionList(
      loader,
      `${eventContext}.conditions`,
      tryGetSeq(eventNode, 'conditions', eventContext),
      ReferenceScope.declaration,
    ),
    effect: parseActiveEffectBody(
      loader,
      eventContext,
      eventNode,
      ReferenceScope.declaration,
      RANGE_EVENT_RESERVED_KEYS,
    ),
  };
}
