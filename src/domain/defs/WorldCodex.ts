import type { GenerationDefs } from './generation/GenerationDefs';
import type { NameRegistry } from './NameRegistry';
import type { ObjectDefTable } from './ObjectDef';
import type { WellKnownProperties } from './WellKnownProperties';

/**
 * ロードされたYAMLファイル全体を表す集約オブジェクト（GameElementDefinition.md 3.1節）。
 * 本体データ（ObjectDefTable）、5種の独立した名前空間（object/property/slot/tag/symbol）の
 * NameRegistry、およびWellKnownPropertiesを持つ。ロード完了後は不変として扱う。
 * symbolNamesはシンボル型props（6節）の値の名前空間。実行時状態（WorldObject）は含まない
 * （runtimeが担う）。
 */
export class WorldCodex {
  readonly objectNames: NameRegistry;
  readonly propertyNames: NameRegistry;
  readonly slotNames: NameRegistry;
  readonly tagNames: NameRegistry;
  readonly symbolNames: NameRegistry;

  readonly objects: ObjectDefTable;
  readonly wellKnown: WellKnownProperties;

  /** 地形生成の定義一式（terrain_generation.yamlのaxes/location_types/generation_scopes）。
   * 生成定義を1つも含まないロードではundefined（地形生成を使わないCodexも成立する）。 */
  readonly generation: GenerationDefs | undefined;

  constructor(
    objectNames: NameRegistry,
    propertyNames: NameRegistry,
    slotNames: NameRegistry,
    tagNames: NameRegistry,
    symbolNames: NameRegistry,
    objects: ObjectDefTable,
    wellKnown: WellKnownProperties,
    generation?: GenerationDefs,
  ) {
    this.objectNames = objectNames;
    this.propertyNames = propertyNames;
    this.slotNames = slotNames;
    this.tagNames = tagNames;
    this.symbolNames = symbolNames;
    this.objects = objects;
    this.wellKnown = wellKnown;
    this.generation = generation;
  }
}
