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
  }
}
