import type { AxisDef } from './AxisDef';
import type { GenerationScopeDef } from './GenerationScopeDef';
import type { LocationTypeDef } from './LocationTypeDef';

/**
 * 地形生成の定義一式（terrain_generation.yamlのaxes/location_types/generation_scopes）。
 * WorldCodexの一部としてロード後不変。生成ファイルがロードされていない場合、
 * WorldCodex.generationはundefinedになる。
 *
 * 軸名・LocationType名・スコープ名は生成時にしか使われないため、NameRegistryでinternせず
 * stringのまま持つ。locationTypesの並びはYAMLの宣言順（マッチングの同点解決を決定的にするため）。
 */
export class GenerationDefs {
  readonly axes: ReadonlyMap<string, AxisDef>;
  readonly locationTypes: readonly LocationTypeDef[];
  readonly scopes: ReadonlyMap<string, GenerationScopeDef>;

  constructor(
    axes: ReadonlyMap<string, AxisDef>,
    locationTypes: readonly LocationTypeDef[],
    scopes: ReadonlyMap<string, GenerationScopeDef>,
  ) {
    this.axes = axes;
    this.locationTypes = locationTypes;
    this.scopes = scopes;

    // 3つのルートキーは互いを名前で指す。**指した先が無ければ黙って効かない**（軸が無ければ好みも
    // 上限も評価されず、location_typeが無ければ保証だけが満たされない）ので、組み上がった時点で弾く。
    for (const type of locationTypes)
      for (const [key, entries] of [
        ['axis_preferences', type.preferences],
        ['hard_limits', type.hardLimits],
      ] as const)
        for (const { axis } of entries)
          if (!axes.has(axis))
            throw new Error(
              `location_types '${type.name}' の${key}が参照する軸 '${axis}' が見つかりません。`,
            );

    for (const scope of scopes.values()) {
      if (!axes.has(scope.elevationAxis))
        throw new Error(
          `generation_scopes '${scope.name}' のelevation_axisが指す軸 '${scope.elevationAxis}' が見つかりません。`,
        );

      for (const guarantee of scope.guarantees) {
        if (!axes.has(guarantee.axis))
          throw new Error(
            `generation_scopes '${scope.name}' のguaranteesが参照する軸 '${guarantee.axis}' が見つかりません。`,
          );
        if (!locationTypes.some((type) => type.name === guarantee.locationType))
          throw new Error(
            `generation_scopes '${scope.name}' のguaranteesが参照するlocation_type ` +
              `'${guarantee.locationType}' が見つかりません。`,
          );
      }
    }
  }
}
