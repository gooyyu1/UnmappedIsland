import type { DefNames, DescriptionToken } from './Description';
import { symbolRef, text } from './Description';
import type { GenerationDefs } from './generation/GenerationDefs';
import type { NameRegistry } from './NameRegistry';
import type { ObjectDef, ObjectDefTable } from './ObjectDef';
import type { SlotDef } from './SlotDef';
import type { WellKnownProperties } from './WellKnownProperties';

/**
 * ロードされたYAMLファイル全体を表す集約オブジェクト（GameElementDefinition.md 3.1節）。
 * 本体データ（ObjectDefTable）、6種の独立した名前空間（object/property/slot/tag/property_tag/symbol）の
 * NameRegistry、およびWellKnownPropertiesを持つ。ロード完了後は不変として扱う。
 * symbolNamesはシンボル型props（6節）の値の名前空間。実行時状態（WorldObject）は含まない
 * （runtimeが担う）。
 *
 * 定義が自分を書き表す（`describe`、[`Description`](./Description.ts)）ときのグローバルID→識別子の
 * 引き当ても引き受ける（DefNames）。名前空間を6つとも持つのはここだけのため。
 */
export class WorldCodex implements DefNames {
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

  /**
   * 自動生成された製作中オブジェクト（RecipeSystem.md 1節）→ その完成品のグローバルID。
   *
   * 製作中オブジェクトは名前も表示名もレシピから導かれるため、完成品を指す手掛かりを型自身は
   * 持てない（YAMLの語彙に無い）。生成した側だけが知っている対応をここへ残す。
   */
  private readonly inProgressProducts: ReadonlyMap<number, number>;

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
    inProgressProducts?: ReadonlyMap<number, number>,
  ) {
    this.inProgressProducts = inProgressProducts ?? new Map();
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

  objectName(globalId: number): string {
    return this.objectNames.getName(globalId);
  }

  propertyName(globalId: number): string {
    return this.propertyNames.getName(globalId);
  }

  slotName(globalId: number): string {
    return this.slotNames.getName(globalId);
  }

  tagName(globalId: number): string {
    return this.tagNames.getName(globalId);
  }

  propertyTagName(globalId: number): string {
    return this.propertyTagNames.getName(globalId);
  }

  /**
   * プロパティの値1つの書き表し方（DefNames参照）。シンボル型（6.6節）と宣言しているプロパティの値だけ
   * シンボル名へ戻す。シンボル型でも数値リテラルが書かれている箇所（未登録のIDになる）は数値のまま出す。
   */
  propertyValue(propertyGlobalId: number, value: number): DescriptionToken {
    if (!this.symbolicProperties.has(propertyGlobalId)) return text(String(value));
    const name = this.symbolNames.getName(value);
    return name === undefined ? text(String(value)) : symbolRef(name);
  }

  /** シンボル型と宣言されたプロパティのグローバルID。同じ名前でも型ごとに宣言が違いうるので、
   * 1つでもシンボル型として宣言していれば含める。 */
  private get symbolicProperties(): ReadonlySet<number> {
    if (this.symbolicPropertyIds === undefined) {
      const found = new Set<number>();
      for (let globalId = 0; globalId < this.objects.count; globalId++)
        for (const propertyDef of this.objects.get(globalId).enumeratePropertyDefs())
          if (propertyDef.isSymbolic) found.add(propertyDef.globalId);
      this.symbolicPropertyIds = found;
    }
    return this.symbolicPropertyIds;
  }

  private symbolicPropertyIds: ReadonlySet<number> | undefined;

  /** この型が製作中オブジェクトなら、その完成品の型。そうでなければundefined。 */
  productOf(def: ObjectDef): ObjectDef | undefined {
    const productGlobalId = this.inProgressProducts.get(def.globalId);
    return productGlobalId === undefined ? undefined : this.objects.get(productGlobalId);
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
