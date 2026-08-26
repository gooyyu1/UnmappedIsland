import type { YAMLMap } from 'yaml';
import { isMap } from 'yaml';
import {
  asMap,
  asScalarText,
  entriesInOrder,
  requireInt,
  requireKnownKeys,
  requireScalar,
  tryGetBool,
  tryGetInt,
  tryGetMap,
  tryGetNumber,
  tryGetSeq,
} from './yamlMapping';
import type { YamlNode } from './yamlMapping';
import { YamlLoadError } from './YamlLoadError';
import { withYamlContext } from './parseCommon';
import type { WorldCodexYamlLoader } from './WorldCodexYamlLoader';
import { PropertyRange } from '../domain/PropertyDef';
import type { ObjectDef } from '../domain/ObjectDef';
import { AxisDef, GeneratorLayer } from '../domain/generation/AxisDef';
import { GenerationDefs } from '../domain/generation/GenerationDefs';
import { GenerationScopeDef, CoverageGuaranteeDef } from '../domain/generation/GenerationScopeDef';
import type { GuaranteePick } from '../domain/generation/GenerationScopeDef';
import {
  AxisLimit,
  AxisPreference,
  LocationTypeDef,
  LocationVariantDef,
} from '../domain/generation/LocationTypeDef';

/** 蓄積した地形生成定義（axes/location_types/generation_scopes）をLoad系メソッドの呼び出しごとに
 * この関数群を通じて登録する。trait合成が無いためパース済みのDefで持ち、他ファイルとの相互参照の
 * 検証だけをbuildGenerationDefsまで遅延する。 */
export function loadGenerationSections(loader: WorldCodexYamlLoader, label: string, root: YAMLMap): void {
  const axes = tryGetMap(root, 'axes', label);
  if (axes !== undefined)
    for (const [name, node] of entriesInOrder(axes)) {
      if (loader.generationAxes.has(name)) throw new YamlLoadError(`axes '${name}' が重複しています。`);
      loader.generationAxes.set(name, parseAxis(name, node));
    }

  const locationTypes = tryGetMap(root, 'location_types', label);
  if (locationTypes !== undefined)
    for (const [name, node] of entriesInOrder(locationTypes)) {
      if (loader.generationLocationTypes.some((type) => type.name === name))
        throw new YamlLoadError(`location_types '${name}' が重複しています。`);
      loader.generationLocationTypes.push(parseLocationType(loader, name, node));
    }

  const scopes = tryGetMap(root, 'generation_scopes', label);
  if (scopes !== undefined)
    for (const [name, node] of entriesInOrder(scopes)) {
      if (loader.generationScopes.has(name))
        throw new YamlLoadError(`generation_scopes '${name}' が重複しています。`);
      loader.generationScopes.set(name, parseGenerationScope(name, node));
    }
}

function parseAxis(name: string, raw: YamlNode): AxisDef {
  const context = `axes.'${name}'`;
  const node = asMap(raw, context);

  const rangeNode = tryGetMap(node, 'range', context);
  if (rangeNode === undefined) throw new YamlLoadError(`${context}: 'range'は必須です。`);
  const range = new PropertyRange(
    requireInt(rangeNode, 'min', context),
    requireInt(rangeNode, 'max', context),
  );

  const generatorNode = tryGetMap(node, 'generator', context);
  if (generatorNode === undefined) throw new YamlLoadError(`${context}: 'generator'は必須です。`);
  const layers: GeneratorLayer[] = [];
  const blendItems = (tryGetSeq(generatorNode, 'blend', context)?.items ?? []) as YamlNode[];
  for (let i = 0; i < blendItems.length; i++) {
    const layerContext = `${context}.generator.blend[${i}]`;
    const layerNode = blendItems[i];
    if (!isMap(layerNode)) throw new YamlLoadError(`${layerContext}: 各層はmappingである必要があります。`);
    layers.push(parseGeneratorLayer(layerContext, layerNode));
  }

  requireKnownKeys(node, ['range', 'generator', 'stretch_sites_to_range'], context);
  requireKnownKeys(generatorNode, ['blend'], context);
  return new AxisDef(name, range, layers, tryGetBool(node, 'stretch_sites_to_range', context) ?? false);
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
      requireKnownKeys(node, ['type', 'weight', 'reference'], context);
      return new GeneratorLayer('distance_field', weight);
    }

    case 'layered_noise': {
      const layer = withYamlContext(
        context,
        () =>
          new GeneratorLayer(
            'layered_noise',
            weight,
            requireInt(node, 'octaves', context),
            requireInt(node, 'frequency', context),
            requireInt(node, 'seed_offset', context),
          ),
      );
      requireKnownKeys(node, ['type', 'weight', 'octaves', 'frequency', 'seed_offset'], context);
      return layer;
    }

    default:
      throw new YamlLoadError(
        `${context}: 未知のジェネレータ 'type: ${type}' です（対応: distance_field / layered_noise）。`,
      );
  }
}

/**
 * variants（亜種、TerrainGeneration.md 3.6節）。`- {id: berry, props: {berry_find: 30}}` の並び。
 * propsのプロパティが実在するかの検証はbuildGenerationDefsまで遅延する（object_defが別ファイルで
 * 後から定義されうるため、object_defの実在検証と同じ理由）。
 */
function parseVariants(loader: WorldCodexYamlLoader, context: string, node: YAMLMap): LocationVariantDef[] {
  const variants: LocationVariantDef[] = [];
  const variantsNode = tryGetSeq(node, 'variants', context);
  if (variantsNode === undefined) return variants;

  for (const entry of variantsNode.items as YamlNode[]) {
    const variantContext = `${context}.variants[${variants.length}]`;
    const map = asMap(entry, variantContext);
    const variantId = requireScalar(map, 'id', variantContext);

    const props = new Map<number, number>();
    const propsNode = tryGetMap(map, 'props', variantContext);
    if (propsNode !== undefined)
      for (const [propName, valueNode] of entriesInOrder(propsNode)) {
        const propContext = `${variantContext}.props.'${propName}'`;
        const value = Number(asScalarText(valueNode, propContext));
        if (!Number.isInteger(value))
          throw new YamlLoadError(`${propContext}: 亜種が上書きする値は整数である必要があります。`);
        props.set(loader.propertyNames.intern(propName), value);
      }

    requireKnownKeys(map, ['id', 'props'], variantContext);
    variants.push(new LocationVariantDef(variantId, props));
  }

  if (new Set(variants.map((v) => v.id)).size !== variants.length)
    throw new YamlLoadError(`${context}: variantsに同じidが複数あります。`);

  return variants;
}

function parseLocationType(loader: WorldCodexYamlLoader, name: string, raw: YamlNode): LocationTypeDef {
  const context = `location_types.'${name}'`;
  const node = asMap(raw, context);

  // object_defの実在検証はbuildGenerationDefsまで遅延する（別ファイルで後から定義されうるため）。
  const objectDefGlobalId = loader.objectNames.intern(requireScalar(node, 'object_def', context));
  const variants = parseVariants(loader, context, node);

  const scopes: string[] = [];
  const scopesNode = tryGetSeq(node, 'applicable_scopes', context);
  if (scopesNode !== undefined)
    for (const scope of scopesNode.items as YamlNode[]) scopes.push(asScalarText(scope, context));

  const moveCost = tryGetNumber(node, 'move_cost', context) ?? 1;
  const isFallback = tryGetBool(node, 'is_fallback', context) ?? false;
  const priority = tryGetInt(node, 'priority', context) ?? 0;

  const preferences: AxisPreference[] = [];
  const preferencesNode = tryGetMap(node, 'axis_preferences', context);
  if (preferencesNode !== undefined)
    for (const [axisName, prefNode] of entriesInOrder(preferencesNode)) {
      const prefContext = `${context}.axis_preferences.'${axisName}'`;
      const prefMap = asMap(prefNode, prefContext);
      requireKnownKeys(prefMap, ['ideal', 'tolerance', 'weight'], prefContext);
      preferences.push(
        withYamlContext(
          prefContext,
          () =>
            new AxisPreference(
              axisName,
              requireInt(prefMap, 'ideal', prefContext),
              requireInt(prefMap, 'tolerance', prefContext),
              tryGetInt(prefMap, 'weight', prefContext) ?? 100,
            ),
        ),
      );
    }

  const hardLimits: AxisLimit[] = [];
  const limitsNode = tryGetMap(node, 'hard_limits', context);
  if (limitsNode !== undefined)
    for (const [axisName, limitNode] of entriesInOrder(limitsNode)) {
      const limitContext = `${context}.hard_limits.'${axisName}'`;
      const limitMap = asMap(limitNode, limitContext);
      requireKnownKeys(limitMap, ['min', 'max'], limitContext);
      hardLimits.push(
        withYamlContext(
          limitContext,
          () =>
            new AxisLimit(
              axisName,
              tryGetInt(limitMap, 'min', limitContext),
              tryGetInt(limitMap, 'max', limitContext),
            ),
        ),
      );
    }

  requireKnownKeys(
    node,
    [
      'object_def',
      'variants',
      'applicable_scopes',
      'move_cost',
      'is_fallback',
      'priority',
      'axis_preferences',
      'hard_limits',
    ],
    context,
  );

  return new LocationTypeDef(
    name,
    objectDefGlobalId,
    variants,
    scopes,
    moveCost,
    isFallback,
    priority,
    preferences,
    hardLimits,
  );
}

function parseGenerationScope(name: string, raw: YamlNode): GenerationScopeDef {
  const context = `generation_scopes.'${name}'`;
  const node = asMap(raw, context);

  const siteCountNode = tryGetMap(node, 'site_count', context);
  if (siteCountNode === undefined) throw new YamlLoadError(`${context}: 'site_count'は必須です。`);
  const siteCountMin = requireInt(siteCountNode, 'min', context);
  const siteCountMax = requireInt(siteCountNode, 'max', context);

  const guarantees: CoverageGuaranteeDef[] = [];
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

      requireKnownKeys(guaranteeNode, ['location_type', 'count', 'axis', 'pick'], guaranteeContext);
      guarantees.push(
        withYamlContext(
          guaranteeContext,
          () =>
            new CoverageGuaranteeDef(
              requireScalar(guaranteeNode, 'location_type', guaranteeContext),
              tryGetInt(guaranteeNode, 'count', guaranteeContext) ?? 1,
              requireScalar(guaranteeNode, 'axis', guaranteeContext),
              pick,
            ),
        ),
      );
    }
  }

  const scope = withYamlContext(
    context,
    () =>
      new GenerationScopeDef({
        name,
        siteCountMin,
        siteCountMax,
        coastBandMaxDistance: tryGetInt(node, 'coast_band', context) ?? 0,
        clampsHullSitesToCoast: tryGetBool(node, 'hull_coast', context) ?? false,
        interiorBias: tryGetNumber(node, 'interior_bias', context) ?? 0,
        extraEdgeDetourThreshold: tryGetNumber(node, 'extra_edge_detour_factor', context) ?? 1.5,
        diameterMeters: requireInt(node, 'diameter_meters', context),
        walkMetersPerHour: requireInt(node, 'walk_meters_per_hour', context),
        climbMetersPerHour: requireInt(node, 'climb_meters_per_hour', context),
        elevationAxis: requireScalar(node, 'elevation_axis', context),
        elevationTopMeters: requireInt(node, 'elevation_top_meters', context),
        maxSitesPerType: tryGetInt(node, 'max_sites_per_type', context) ?? 0,
        crowdingPenaltyPerDuplicate: tryGetNumber(node, 'crowding_penalty', context) ?? 0,
        guarantees,
      }),
  );

  requireKnownKeys(
    node,
    [
      'site_count',
      'coast_band',
      'hull_coast',
      'interior_bias',
      'extra_edge_detour_factor',
      'diameter_meters',
      'walk_meters_per_hour',
      'climb_meters_per_hour',
      'elevation_axis',
      'elevation_top_meters',
      'max_sites_per_type',
      'crowding_penalty',
      'guarantees',
    ],
    context,
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

  // 型の一覧を名前で引くのはここだけの仕事。**指した名前がグローバルIDへ解決できるか**は
  // 生成の宣言だけでは答えられない（GenerationDefsはobject_defの表もNameRegistryも持たない）。
  for (const type of loader.generationLocationTypes) {
    if (!objectDefsByGlobalId.has(type.objectDefGlobalId))
      throw new YamlLoadError(
        `location_types '${type.name}' が参照するobject_def '${loader.objectNames.getName(type.objectDefGlobalId)}' が見つかりません。`,
      );

    // 亜種が上書きするプロパティは、その土地のobject_defが持っていなければならない（持たない
    // プロパティへの書き込みは黙って消えるため、書き間違いをここで止める）。
    const objectDef = objectDefsByGlobalId.get(type.objectDefGlobalId)!;
    for (const variant of type.variants)
      for (const propertyGlobalId of variant.props.keys())
        if (objectDef.tryGetPropertyDef(propertyGlobalId) === undefined)
          throw new YamlLoadError(
            `location_types '${type.name}' の亜種 '${variant.id}' が上書きするプロパティ ` +
              `'${loader.propertyNames.getName(propertyGlobalId)}' を、object_def '${objectDef.name}' が持っていません。`,
          );
  }

  // ルートキーどうしの参照（軸・location_type）はGenerationDefs自身が確かめる。
  return withYamlContext(
    'terrain_generation',
    () =>
      new GenerationDefs(
        new Map(loader.generationAxes),
        [...loader.generationLocationTypes],
        new Map(loader.generationScopes),
      ),
  );
}

export function resetGeneration(loader: WorldCodexYamlLoader): void {
  loader.generationAxes.clear();
  loader.generationLocationTypes.length = 0;
  loader.generationScopes.clear();
}
