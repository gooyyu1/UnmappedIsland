import type { GenerationDefs } from './generation/GenerationDefs';
import type { NameRegistry } from './NameRegistry';
import type { ObjectDefTable } from './ObjectDef';
import type { SlotDef } from './SlotDef';
import type { WellKnownProperties } from './WellKnownProperties';

/**
 * ロードされたYAMLファイル全体を表す集約オブジェクト（GameElementDefinition.md 3.1節）。
 * 本体データ（ObjectDefTable）、6種の独立した名前空間（object/property/slot/tag/property_tag/symbol）の
 * NameRegistry、およびWellKnownPropertiesを持つ。ロード完了後は不変として扱う。
 * symbolNamesはシンボル型props（6節）の値の名前空間。実行時状態（WorldObject）は含まない
 * （runtimeが担う）。
 */
export class WorldCodex {
  readonly objectNames: NameRegistry;
  readonly propertyNames: NameRegistry;
  readonly slotNames: NameRegistry;
  readonly tagNames: NameRegistry;

  /**
   * プロパティのタグ（6.7節）の名前空間。object_defのタグ（tagNames）とは別で、`property_tags` で
   * 宣言された順にIDが振られる。UIはこのIDの昇順をカテゴリの表示順として使ってよい。
   */
  readonly propertyTagNames: NameRegistry;

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
    propertyTagNames: NameRegistry,
    symbolNames: NameRegistry,
    objects: ObjectDefTable,
    wellKnown: WellKnownProperties,
    generation?: GenerationDefs,
  ) {
    this.objectNames = objectNames;
    this.propertyNames = propertyNames;
    this.slotNames = slotNames;
    this.tagNames = tagNames;
    this.propertyTagNames = propertyTagNames;
    this.symbolNames = symbolNames;
    this.objects = objects;
    this.wellKnown = wellKnown;
    this.generation = generation;
  }

  /**
   * タグ（4.1節）を持つobject_defの識別子を、宣言順（グローバルID順）で返す。未登録のタグでは空。
   * タグは型のグループを指す唯一の手段なので、「locationな型の一覧」「選べるキャラクタの一覧」は
   * いずれもこれで引く。
   */
  objectDefNamesWithTag(tagName: string): readonly string[] {
    const tagId = this.tagNames.tryGetId(tagName);
    if (tagId === undefined) return [];

    const names: string[] = [];
    for (let globalId = 0; globalId < this.objects.count; globalId++) {
      const objectDef = this.objects.get(globalId);
      if (objectDef.tags.includes(tagId)) names.push(objectDef.name);
    }
    return names;
  }

  /**
   * このスロットへ、外から持ち込める型が1つでもあるか。単独で在れない型（`bound_to_owner`、7.9節）
   * しか受け付けないスロットは、持ち主の中で生まれる以外に入りようがない——怪我のスロットがこれ。
   * 画面はこれを見て「落とせる場所」の空枠を出すかを決める。
   */
  admitsBroughtObjects(slotDef: SlotDef): boolean {
    for (let globalId = 0; globalId < this.objects.count; globalId++) {
      const objectDef = this.objects.get(globalId);
      if (objectDef.boundToOwner) continue;
      if (slotDef.acceptsAnywhere(objectDef)) return true;
    }
    return false;
  }
}
