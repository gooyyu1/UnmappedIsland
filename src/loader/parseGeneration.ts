import type { YAMLMap } from 'yaml';
import { isMap } from 'yaml';
import {
  asMap,
  asScalarText,
  entriesInOrder,
  requireInt,
  requireScalar,
  tryGetBool,
  tryGetInt,
  tryGetMap,
  tryGetSeq,
} from './yamlMapping';
import type { YamlNode } from './yamlMapping';
import { YamlLoadError } from './YamlLoadError';
import type { WorldCodexYamlLoader } from './WorldCodexYamlLoader';
import { PropertyRange } from '../domain/defs/PropertyDef';
import type { ObjectDef } from '../domain/defs/ObjectDef';
import { AxisDef, GeneratorLayer } from '../domain/defs/generation/AxisDef';
import { GenerationDefs } from '../domain/defs/generation/GenerationDefs';
import { GenerationScopeDef, GuaranteeDef } from '../domain/defs/generation/GenerationScopeDef';
import type { GuaranteePick } from '../domain/defs/generation/GenerationScopeDef';
import { AxisLimit, AxisPreference, LocationTypeDef } from '../domain/defs/generation/LocationTypeDef';

/** 蓄積した地形生成定義（axes/location_types/generation_scopes）をLoad系メソッドの呼び出しごとに
 * この関数群を通じて登録する。trait合成が無いためパース済みのDefで持ち、他ファイルとの相互参照の
 * 検証だけをbuildGenerationDefsまで遅延する。 */
export function loadGenerationSections(loader: WorldCodexYamlLoader, label: string, root: YAMLMap): void {
  const axes = tryGetMap(root, 'axes', label);
  if (axes !== undefined)
    for (const [name, node] of entriesInOrder(axes)) {
      if (loader.generationAxes.has(name)) throw new YamlLoadError(`axes '${name}' が重複しています。`);
      loader.generationAxes.set(name, parseAxis(name, asMap(node, `axes.'${name}'`)));
    }

  const locationTypes = tryGetMap(root, 'location_types', label);
  if (locationTypes !== undefined)
    for (const [name, node] of entriesInOrder(locationTypes)) {
      if (loader.generationLocationTypes.some((type) => type.name === name))
        throw new YamlLoadError(`location_types '${name}' が重複しています。`);
      loader.generationLocationTypes.push(
        parseLocationType(loader, name, asMap(node, `location_types.'${name}'`)),
      );
    }

  const scopes = tryGetMap(root, 'generation_scopes', label);
  if (scopes !== undefined)
    for (const [name, node] of entriesInOrder(scopes)) {
      if (loader.generationScopes.has(name))
        throw new YamlLoadError(`generation_scopes '${name}' が重複しています。`);
      loader.generationScopes.set(
        name,
        parseGenerationScope(name, asMap(node, `generation_scopes.'${name}'`)),
      );
    }
}

function parseAxis(name: string, node: YAMLMap): AxisDef {
  const context = `axes.'${name}'`;

  const rangeNode = tryGetMap(node, 'range', context);
  if (rangeNode === undefined) throw new YamlLoadError(`${context}: 'range'は必須です。`);
  const range = new PropertyRange(
    requireInt(rangeNode, 'min', context),
    requireInt(rangeNode, 'max', context),
  );

  const generatorNode = tryGetMap(node, 'generator', context);
  if (generatorNode === undefined) throw new YamlLoadError(`${context}: 'generator'は必須です。`);
  const blendNode = tryGetSeq(generatorNode, 'blend', context);
  if (blendNode === undefined || blendNode.items.length === 0)
    throw new YamlLoadError(`${context}: generator.blendには1つ以上の層が必要です。`);

  const layers: GeneratorLayer[] = [];
  const blendItems = blendNode.items as YamlNode[];
  for (let i = 0; i < blendItems.length; i++) {
    const layerContext = `${context}.generator.blend[${i}]`;
    const layerNode = blendItems[i];
    if (!isMap(layerNode)) throw new YamlLoadError(`${layerContext}: 各層はmappingである必要があります。`);
    layers.push(parseGeneratorLayer(layerContext, layerNode));
  }

  checkUnknownKeys(context, node, 'range', 'generator');
  checkUnknownKeys(context, generatorNode, 'blend');
  return new AxisDef(name, range, layers);
}

function parseGeneratorLayer(context: string, node: YAMLMap): GeneratorLayer {
  const type = requireScalar(node, 'type', context);
  const weight = requireInt(node, 'weight', context);

  switch (type) {
    case 'distance_field': {
      const reference = requireScalar(node, 'reference', context);
      if (reference !== 'edge')
        throw new YamlLoadError(
          `${context}: distance_fieldのreferenceは現時点で'edge'のみ対応しています（値: '${reference}'）。`,
        );
      checkUnknownKeys(context, node, 'type', 'weight', 'reference');
      return new GeneratorLayer('distance_field', weight);
    }

    case 'layered_noise': {
      const layer = new GeneratorLayer(
        'layered_noise',
        weight,
        requireInt(node, 'octaves', context),
        requireInt(node, 'frequency', context),
        requireInt(node, 'seed_offset', context),
      );
      if (layer.octaves < 1) throw new YamlLoadError(`${context}: octavesは1以上である必要があります。`);
      if (layer.frequency < 1) throw new YamlLoadError(`${context}: frequencyは1以上である必要があります。`);
      checkUnknownKeys(context, node, 'type', 'weight', 'octaves', 'frequency', 'seed_offset');
      return layer;
    }

    default:
      throw new YamlLoadError(
        `${context}: 未知のジェネレータ 'type: ${type}' です（対応: distance_field / layered_noise）。`,
      );
  }
}

function parseLocationType(loader: WorldCodexYamlLoader, name: string, node: YAMLMap): LocationTypeDef {
  const context = `location_types.'${name}'`;

  // object_defの実在検証はbuildGenerationDefsまで遅延する（別ファイルで後から定義されうるため）。
  const objectDefGlobalId = loader.objectNames.intern(requireScalar(node, 'object_def', context));
  const displayName = requireScalar(node, 'display_name', context);

  const namePool: string[] = [];
  const namePoolNode = tryGetSeq(node, 'name_pool', context);
  if (namePoolNode !== undefined)
    for (const entry of namePoolNode.items as YamlNode[]) namePool.push(asScalarText(entry, context));
  if (new Set(namePool).size !== namePool.length)
    throw new YamlLoadError(`${context}: name_poolに同じ名前が複数あります（土地の名前は島の中で一意）。`);

  const scopes: string[] = [];
  const scopesNode = tryGetSeq(node, 'applicable_scopes', context);
  if (scopesNode !== undefined)
    for (const scope of scopesNode.items as YamlNode[]) scopes.push(asScalarText(scope, context));

  const moveCost = tryGetInt(node, 'move_cost', context) ?? 100;
  if (moveCost < 1) throw new YamlLoadError(`${context}: move_costは1以上である必要があります。`);
  const isFallback = tryGetBool(node, 'is_fallback', context, false);
  const priority = tryGetInt(node, 'priority', context) ?? 0;

  const preferences: AxisPreference[] = [];
  const preferencesNode = tryGetMap(node, 'axis_preferences', context);
  if (preferencesNode !== undefined)
    for (const [axisName, prefNode] of entriesInOrder(preferencesNode)) {
      const prefContext = `${context}.axis_preferences.'${axisName}'`;
      const prefMap = asMap(prefNode, prefContext);
      const tolerance = requireInt(prefMap, 'tolerance', prefContext);
      if (tolerance < 1) throw new YamlLoadError(`${prefContext}: toleranceは1以上である必要があります。`);
      const weight = tryGetInt(prefMap, 'weight', prefContext) ?? 100;
      if (weight < 1) throw new YamlLoadError(`${prefContext}: weightは1以上である必要があります。`);
      checkUnknownKeys(prefContext, prefMap, 'ideal', 'tolerance', 'weight');
      preferences.push(
        new AxisPreference(axisName, requireInt(prefMap, 'ideal', prefContext), tolerance, weight),
      );
    }

  const hardLimits: AxisLimit[] = [];
  const limitsNode = tryGetMap(node, 'hard_limits', context);
  if (limitsNode !== undefined)
    for (const [axisName, limitNode] of entriesInOrder(limitsNode)) {
      const limitContext = `${context}.hard_limits.'${axisName}'`;
      const limitMap = asMap(limitNode, limitContext);
      const min = tryGetInt(limitMap, 'min', limitContext);
      const max = tryGetInt(limitMap, 'max', limitContext);
      if (min === undefined && max === undefined)
        throw new YamlLoadError(`${limitContext}: 'min'または'max'のいずれかが必要です。`);
      checkUnknownKeys(limitContext, limitMap, 'min', 'max');
      hardLimits.push(new AxisLimit(axisName, min, max));
    }

  if (preferences.length === 0 && !isFallback)
    throw new YamlLoadError(
      `${context}: axis_preferencesが空の（全軸に無関心な）型はis_fallback: trueにしてください` +
        `（通常の最近傍マッチングでは距離が定義できないため）。`,
    );

  checkUnknownKeys(
    context,
    node,
    'object_def',
    'display_name',
    'name_pool',
    'applicable_scopes',
    'move_cost',
    'is_fallback',
    'priority',
    'axis_preferences',
    'hard_limits',
  );

  return new LocationTypeDef(
    name,
    objectDefGlobalId,
    displayName,
    namePool,
    scopes,
    moveCost,
    isFallback,
    priority,
    preferences,
    hardLimits,
  );
}

function parseGenerationScope(name: string, node: YAMLMap): GenerationScopeDef {
  const context = `generation_scopes.'${name}'`;

  const siteCountNode = tryGetMap(node, 'site_count', context);
  if (siteCountNode === undefined) throw new YamlLoadError(`${context}: 'site_count'は必須です。`);
  const siteCountMin = requireInt(siteCountNode, 'min', context);
  const siteCountMax = requireInt(siteCountNode, 'max', context);
  if (siteCountMin < 1 || siteCountMax < siteCountMin)
    throw new YamlLoadError(`${context}: site_countは1 <= min <= maxである必要があります。`);

  const guarantees: GuaranteeDef[] = [];
  const guaranteesNode = tryGetSeq(node, 'guarantees', context);
  if (guaranteesNode !== undefined) {
    const items = guaranteesNode.items as YamlNode[];
    for (let i = 0; i < items.length; i++) {
      const guaranteeContext = `${context}.guarantees[${i}]`;
      const guaranteeNode = items[i];
      if (!isMap(guaranteeNode))
        throw new YamlLoadError(`${guaranteeContext}: 各要素はmappingである必要があります。`);

      const pickRaw = requireScalar(guaranteeNode, 'pick', guaranteeContext);
      let pick: GuaranteePick;
      switch (pickRaw) {
        case 'max':
          pick = 'max';
          break;
        case 'min':
          pick = 'min';
          break;
        default:
          throw new YamlLoadError(
            `${guaranteeContext}: pickは'max'または'min'である必要があります（値: '${pickRaw}'）。`,
          );
      }

      const count = tryGetInt(guaranteeNode, 'count', guaranteeContext) ?? 1;
      if (count < 1) throw new YamlLoadError(`${guaranteeContext}: countは1以上である必要があります。`);

      checkUnknownKeys(guaranteeContext, guaranteeNode, 'location_type', 'count', 'axis', 'pick');
      guarantees.push(
        new GuaranteeDef(
          requireScalar(guaranteeNode, 'location_type', guaranteeContext),
          count,
          requireScalar(guaranteeNode, 'axis', guaranteeContext),
          pick,
        ),
      );
    }
  }

  const scope = new GenerationScopeDef(
    name,
    siteCountMin,
    siteCountMax,
    tryGetInt(node, 'coast_band', context) ?? 0,
    tryGetBool(node, 'hull_coast', context, false),
    tryGetInt(node, 'interior_bias', context) ?? 0,
    tryGetInt(node, 'extra_edge_detour_factor', context) ?? 150,
    tryGetInt(node, 'base_minutes_per_distance', context) ?? 1,
    guarantees,
  );

  if (scope.interiorBias < 0 || scope.interiorBias > 100)
    throw new YamlLoadError(`${context}: interior_biasは0〜100である必要があります。`);

  checkUnknownKeys(
    context,
    node,
    'site_count',
    'coast_band',
    'hull_coast',
    'interior_bias',
    'extra_edge_detour_factor',
    'base_minutes_per_distance',
    'guarantees',
  );

  return scope;
}

/** 蓄積した生成定義の相互参照を検証してGenerationDefsを組み立てる。
 * 生成定義が1つも無ければundefined（生成ファイル無しのCodex）。 */
export function buildGenerationDefs(
  loader: WorldCodexYamlLoader,
  objectDefsByGlobalId: ReadonlyMap<number, ObjectDef>,
): GenerationDefs | undefined {
  if (
    loader.generationAxes.size === 0 &&
    loader.generationLocationTypes.length === 0 &&
    loader.generationScopes.size === 0
  )
    return undefined;

  for (const type of loader.generationLocationTypes) {
    if (!objectDefsByGlobalId.has(type.objectDefGlobalId))
      throw new YamlLoadError(
        `location_types '${type.name}' が参照するobject_def '${loader.objectNames.getName(type.objectDefGlobalId)}' が見つかりません。`,
      );

    for (const preference of type.preferences)
      if (!loader.generationAxes.has(preference.axis))
        throw new YamlLoadError(
          `location_types '${type.name}' のaxis_preferencesが参照する軸 '${preference.axis}' が見つかりません。`,
        );

    for (const limit of type.hardLimits)
      if (!loader.generationAxes.has(limit.axis))
        throw new YamlLoadError(
          `location_types '${type.name}' のhard_limitsが参照する軸 '${limit.axis}' が見つかりません。`,
        );
  }

  for (const scope of loader.generationScopes.values())
    for (const guarantee of scope.guarantees) {
      if (!loader.generationAxes.has(guarantee.axis))
        throw new YamlLoadError(
          `generation_scopes '${scope.name}' のguaranteesが参照する軸 '${guarantee.axis}' が見つかりません。`,
        );
      if (!loader.generationLocationTypes.some((type) => type.name === guarantee.locationType))
        throw new YamlLoadError(
          `generation_scopes '${scope.name}' のguaranteesが参照するlocation_type '${guarantee.locationType}' が見つかりません。`,
        );
    }

  return new GenerationDefs(
    new Map(loader.generationAxes),
    [...loader.generationLocationTypes],
    new Map(loader.generationScopes),
  );
}

export function resetGeneration(loader: WorldCodexYamlLoader): void {
  loader.generationAxes.clear();
  loader.generationLocationTypes.length = 0;
  loader.generationScopes.clear();
}

function checkUnknownKeys(context: string, node: YAMLMap, ...knownKeys: readonly string[]): void {
  const unknownKeys = entriesInOrder(node)
    .map(([key]) => key)
    .filter((key) => !knownKeys.includes(key));
  if (unknownKeys.length > 0)
    throw new YamlLoadError(`${context}: 未知のキー '${unknownKeys.join(', ')}' です。`);
}
