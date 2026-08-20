import type { YAMLMap } from 'yaml';
import { isMap } from 'yaml';
import {
  asMap,
  asScalarText,
  entriesInOrder,
  requireNumber,
  requireScalar,
  tryGetBool,
  tryGetMap,
  tryGetNumber,
  tryGetScalar,
  tryGetSeq,
} from './yamlMapping';
import type { YamlNode } from './yamlMapping';
import { YamlLoadError } from './YamlLoadError';
import { parseScalarNumber, tryGetNode } from './parseCommon';
import { parseActiveEffectBody } from './parseActiveEffects';
import { parsePassive } from './parsePassives';
import type { WorldCodexYamlLoader } from './WorldCodexYamlLoader';
import { ActiveEffects, SetEffect } from '../domain/ActiveEffect';
import type { AlertLevel } from '../domain/AlertLevel';
import { ALERT_LEVELS } from '../domain/AlertLevel';
import type { ActiveEffect } from '../domain/ActiveEffect';
import { GAUGE_ENDS, GaugeDef, PropertyDef, PropertyRange, PropertyStage } from '../domain/PropertyDef';
import type { GaugeEnd } from '../domain/PropertyDef';
import type { PassiveEffect } from '../domain/PassiveEffect';

/** props（6節）の1エントリが持てるキー。これ以外はロードエラー（綴り間違いをその場で捕まえる）。
 * unitは単位表記などの注記用で、ローダーは解釈しない（WorldCodex.schema.json参照）。 */
const KNOWN_PROP_KEYS = new Set<string>([
  'value',
  'unit',
  'range',
  'on_overflow',
  'on_shortfall',
  'on_exhausted',
  'stages',
  'passives',
  'inherit',
  'tags',
  'gauge',
]);

/** props.'propName'エントリを1つ読む（GameElementDefinition.md 6節）。
 * trait合成済みのノードを渡すこと。 */
export function parseProp(
  loader: WorldCodexYamlLoader,
  objectDefName: string,
  propName: string,
  node: YAMLMap,
  passives: PassiveEffect[],
): PropertyDef {
  const context = `'${objectDefName}'.props.'${propName}'`;
  const propertyGlobalId = loader.propertyNames.intern(propName);

  const unknownKeys = entriesInOrder(node)
    .map(([key]) => key)
    .filter((key) => !KNOWN_PROP_KEYS.has(key));
  if (unknownKeys.length > 0)
    throw new YamlLoadError(`${context}: 未知のキー '${unknownKeys.join(', ')}' です。`);

  const valueNode = tryGetNode(node, 'value');
  if (valueNode === undefined)
    throw new YamlLoadError(
      `${context}: 必須フィールド 'value' がありません（traitの継承先で指定してください）。`,
    );

  let initialValueRange: PropertyRange | undefined;
  let initialValue: number;
  let isSymbolProperty: boolean;
  if (isMap(valueNode)) {
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
    [initialValue, isSymbolProperty] = parseScalarNumber(loader, context, asScalarText(valueNode, context));
  }

  let range: PropertyRange | undefined;
  const rangeSpec = tryGetMap(node, 'range', context);
  if (rangeSpec !== undefined)
    range = new PropertyRange(
      requireNumber(rangeSpec, 'min', context),
      requireNumber(rangeSpec, 'max', context),
    );

  let onOverflow: ActiveEffect | undefined;
  const onOverflowNode = tryGetMap(node, 'on_overflow', context);
  if (onOverflowNode !== undefined) {
    if (range === undefined) throw new YamlLoadError(`${context}: on_overflowを使うには'range'が必須です。`);
    onOverflow = parseRangeEventEffect(loader, `${context}.on_overflow`, onOverflowNode);
  } else {
    onOverflow = range !== undefined ? buildDefaultOverflowEffect(range, propertyGlobalId, true) : undefined;
  }

  let onShortfall: ActiveEffect | undefined;
  const onShortfallNode = tryGetMap(node, 'on_shortfall', context);
  if (onShortfallNode !== undefined) {
    if (range === undefined) throw new YamlLoadError(`${context}: on_shortfallを使うには'range'が必須です。`);
    onShortfall = parseRangeEventEffect(loader, `${context}.on_shortfall`, onShortfallNode);
  } else {
    onShortfall =
      range !== undefined ? buildDefaultOverflowEffect(range, propertyGlobalId, false) : undefined;
  }

  // 「尽きた」に反応する口（6.3節）。既定は無く、宣言した型だけが反応する。
  let onExhausted: ActiveEffect | undefined;
  const onExhaustedNode = tryGetMap(node, 'on_exhausted', context);
  if (onExhaustedNode !== undefined) {
    if (range === undefined) throw new YamlLoadError(`${context}: on_exhaustedを使うには'range'が必須です。`);
    onExhausted = parseRangeEventEffect(loader, `${context}.on_exhausted`, onExhaustedNode);
  }

  const stages: PropertyStage[] = [];
  const stagesNode = tryGetSeq(node, 'stages', context);
  if (stagesNode !== undefined)
    for (const stageNode of stagesNode.items as YamlNode[])
      stages.push(
        parseStage(
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
      parsePassive(loader, passives, objectDefName, asMap(passiveNode, context), undefined, undefined);

  const inherit = tryGetBool(node, 'inherit', context, false);
  const tags = parsePropertyTags(loader, context, node);
  const gauge = parseGauge(context, node, range);

  const def = new PropertyDef(
    propertyGlobalId,
    propName,
    initialValue,
    initialValueRange,
    range,
    onOverflow,
    stages,
    onShortfall,
    inherit,
    tags,
    isSymbolProperty,
    gauge,
    onExhausted,
  );

  // ゲージの向きとstagesのalertの向きは、同じ「どちらが危ないか」を二度言うことになる。食い違って
  // いると片方だけが正しく見えて原因が分からなくなるので、ここで一致を確かめる（6.8節）。
  if (gauge !== undefined && gauge.hasDirection && def.alertDirection !== 'mixed') {
    const stagesWorsenUpward = def.alertDirection === 'up';
    if (stages.length > 0 && stagesWorsenUpward !== gauge.worsensUpward)
      throw new YamlLoadError(
        `${context}: gaugeの向き（max: ${gauge.atMax}）とstagesのalertの向きが食い違っています。` +
          'どちらの端が危ないかは1つに揃えてください。',
      );
  }

  // rangeを持つプロパティはバーとして描かれる（6.4節）。上下どちらの端も悪い並びでは、塗りの向きが
  // 「良い方へ伸びる」とも「悪い方へ伸びる」とも決められない。両側が悪い量（体温など）は、値そのもの
  // ではなく片側だけの度合い（熱中症・低体温症）を別のプロパティとして見せる。
  if (range !== undefined && def.alertDirection === 'mixed')
    throw new YamlLoadError(
      `${context}: stagesのalertが上下どちらの端でも深刻になっています。rangeを持つプロパティは` +
        `バーとして描かれるため、深刻さは下から上へ単調でなければなりません。`,
    );

  return def;
}

/**
 * props.'name'.gauge（6.8節）を読む。カードにバーとして出すかと、両端の見せ方を宣言する。
 *
 * rangeを必須にするのは、割合が定義できなければバーとして描きようがないため（同6.4節のratioOf）。
 */
function parseGauge(context: string, node: YAMLMap, range: PropertyRange | undefined): GaugeDef | undefined {
  const gaugeNode = tryGetMap(node, 'gauge', context);
  if (gaugeNode === undefined) return undefined;

  if (range === undefined)
    throw new YamlLoadError(
      `${context}: gaugeを使うには'range'が必須です（割合が定義できないとバーにできません）。`,
    );

  const unknownKeys = entriesInOrder(gaugeNode)
    .map(([key]) => key)
    .filter((key) => key !== 'min' && key !== 'max');
  if (unknownKeys.length > 0)
    throw new YamlLoadError(`${context}.gauge: 未知のキー '${unknownKeys.join(', ')}' です。`);

  return new GaugeDef(gaugeEnd(context, gaugeNode, 'min'), gaugeEnd(context, gaugeNode, 'max'));
}

/** gaugeの片端の見せ方。綴り間違いをロード時に捕まえるため一覧と突き合わせる。 */
function gaugeEnd(context: string, gaugeNode: YAMLMap, key: 'min' | 'max'): GaugeEnd {
  const text = requireScalar(gaugeNode, key, `${context}.gauge`);
  const end = GAUGE_ENDS.find((candidate) => candidate === text);
  if (end === undefined)
    throw new YamlLoadError(
      `${context}.gauge.${key}: 未知の見せ方 '${text}' です（${GAUGE_ENDS.join(' / ')} のいずれかを指定してください）。`,
    );
  return end;
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

/**
 * rangeイベント（on_overflow・on_shortfall、6.3節）の中身を読む。対象はselfのみで、
 * pick候補の中の効果にも引き継ぐ。空のmapping（`on_shortfall: {}`）は「宣言だけして何もしない」
 * （既定のクランプを打ち消す）を意味し、空のActiveEffectsになる。
 */
function parseRangeEventEffect(loader: WorldCodexYamlLoader, context: string, node: YAMLMap): ActiveEffect {
  return parseActiveEffectBody(loader, context, node, false, true);
}

/** 1つのstagesエントリを解釈する（6.4節）。数値型はmin（半開区間）、シンボル型はeq
 * （nameが比較対象そのもの）を使う。stage内のpassivesも併せて解釈しpassivesへ追記する。 */
function parseStage(
  loader: WorldCodexYamlLoader,
  objectDefName: string,
  propName: string,
  context: string,
  isSymbolProperty: boolean,
  passives: PassiveEffect[],
  stageMap: YAMLMap,
): PropertyStage {
  const stageName = requireScalar(stageMap, 'name', context);
  const alert = parseAlertLevel(context, stageMap);
  // 段が宣言するart接尾辞（6.4節）。art_by_stageが指すプロパティの段だけがこれを持てるが、
  // その検証は object_def 全体を見渡せる RawObjectDef.resolve が行う（ここでは持たない）。
  const art = tryGetScalar(stageMap, 'art', context);
  let stage: PropertyStage;

  if (isSymbolProperty) {
    if (tryGetNode(stageMap, 'min') !== undefined)
      throw new YamlLoadError(
        `${context}: シンボル型プロパティのstageに'min'は使えません（'name'自体がそのまま比較対象になります）。`,
      );
    stage = new PropertyStage(stageName, undefined, loader.symbolNames.intern(stageName), alert, art);
  } else {
    const min = tryGetNumber(stageMap, 'min', context);
    stage = new PropertyStage(stageName, min, undefined, alert, art);
  }

  // stage内のpassivesは常に配列（条件違いの複数ブロックを書けるようにするため）。
  const stagePassives = tryGetSeq(stageMap, 'passives', context);
  if (stagePassives !== undefined)
    for (const passiveNode of stagePassives.items as YamlNode[])
      parsePassive(loader, passives, objectDefName, asMap(passiveNode, context), propName, stageName);

  return stage;
}

/** stagesエントリのalert（6.4節）。未指定は安全域。綴り間違いをロード時に捕まえるため一覧と突き合わせる。 */
function parseAlertLevel(context: string, stageMap: YAMLMap): AlertLevel {
  const text = tryGetScalar(stageMap, 'alert', context);
  if (text === undefined) return 'safe';

  const level = ALERT_LEVELS.find((candidate) => candidate === text);
  if (level === undefined)
    throw new YamlLoadError(
      `${context}: 未知のalert '${text}' です（${ALERT_LEVELS.join(' / ')} のいずれかを指定してください）。`,
    );
  return level;
}

/**
 * on_overflow/on_shortfall未指定時の既定動作として、「自分自身をrangeの境界（isMax指定側）へ
 * setする」ActiveEffectを合成する。著者は`range`を書くだけでクランプが得られ、特別な挙動が
 * 要る場合だけon_overflow/on_shortfallを明示すればよい。
 */
function buildDefaultOverflowEffect(
  range: PropertyRange,
  propertyGlobalId: number,
  isMax: boolean,
): ActiveEffects {
  const operations: ActiveEffect[] = [new SetEffect('self', propertyGlobalId, isMax ? range.max : range.min)];
  return new ActiveEffects(operations);
}
