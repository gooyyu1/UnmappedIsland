import type { GenerationDefs } from './generation/GenerationDefs';
import { GeneratedTypes } from './GeneratedTypes';
import type { NameRegistry } from './NameRegistry';
import type { ObjectDef, ObjectDefTable } from './ObjectDef';
import type { SlotDef } from './SlotDef';
import type { WorldVocabulary } from './WorldVocabulary';

/**
 * ロードされたYAMLファイル全体を表す集約オブジェクト（GameElementDefinition.md 3.1節）。
 * 本体データ（ObjectDefTable）、6種の独立した名前空間（object/property/slot/tag/property_tag/symbol）の
 * NameRegistry、およびWorldVocabularyを持つ。ロード完了後は不変として扱う。
 * symbolNamesはシンボル型props（6節）の値の名前空間。実行時状態（WorldObject）は含まない
 * （runtimeが担う）。
 *
 * グローバルID→識別子の引き当ても引き受ける。名前空間を6つとも持つのはここだけのため。
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
  /** コードがYAMLの単語へ寄せている依存の一覧（WorldVocabulary参照）。 */
  readonly vocabulary: WorldVocabulary;

  /** 地形生成の定義一式（terrain_generation.yamlのaxes/location_types/generation_scopes）。
   * 生成定義を1つも含まないロードではundefined（地形生成を使わないCodexも成立する）。 */
  readonly generation: GenerationDefs | undefined;

  /**
   * ロード時に生成された型の座標表（GameElementDefinition.md 3.5節）。生成型は名前も表示名も
   * 組み立てた結果でしかないため、素の型と軸の値の組をここへ残す。becomeの行き先解決も、
   * 製作中オブジェクトから完成品を引くのも、この1つの表が答える。
   */
  readonly generatedTypes: GeneratedTypes;

  /**
   * レシピ一覧の棚に使うタグ（`recipe_categories`、Windows.md 9節）のグローバルID。
   * **並びが優先順位**で、完成品は最初に一致した棚にだけ載る。
   */
  readonly recipeCategoryTagIds: readonly number[];

  constructor(
    objectNames: NameRegistry,
    propertyNames: NameRegistry,
    slotNames: NameRegistry,
    tagNames: NameRegistry,
    propertyTagNames: NameRegistry,
    symbolNames: NameRegistry,
    objects: ObjectDefTable,
    vocabulary: WorldVocabulary,
    generation?: GenerationDefs,
    generatedTypes?: GeneratedTypes,
    recipeCategoryTagIds: readonly number[] = [],
  ) {
    this.generatedTypes = generatedTypes ?? new GeneratedTypes();
    this.recipeCategoryTagIds = recipeCategoryTagIds;
    this.objectNames = objectNames;
    this.propertyNames = propertyNames;
    this.slotNames = slotNames;
    this.tagNames = tagNames;
    this.propertyTagNames = propertyTagNames;
    this.symbolNames = symbolNames;
    this.objects = objects;
    this.vocabulary = vocabulary;
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
   * シンボル型（6.6節）と宣言されたプロパティのグローバルID。同じ名前でも型ごとに宣言が違いうるので、
   * 1つでもシンボル型として宣言していれば含める。
   *
   * **値をどう見せるかは読み手が決める**ので、ここが答えるのは「この値はシンボルか」だけ。
   */
  get symbolicProperties(): ReadonlySet<number> {
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

  /**
   * 生成型（3.5節）の素の型。生成型でなければ自分自身。**絵と名前の骨格はここから引く**
   * ——変種のために絵を描き足す道は無いので、素の型のものを映す。
   */
  baseOf(def: ObjectDef): ObjectDef {
    return this.objects.get(this.generatedTypes.coordinateOf(def).baseGlobalId);
  }

  /**
   * ロード時に自動生成された型か（3.5節）。**一覧にも対応表にも自分の場所を持たない**——名前も絵も
   * 素の型から組み立てるので、並べても同じ物の別の顔が増えるだけになる。
   */
  isGenerated(def: ObjectDef): boolean {
    return this.baseOf(def) !== def;
  }

  /**
   * この型が素の型からどれだけ動いた先に居るか（3.5節）。軸の名前 → その軸の値の識別子で、素の型では空。
   *
   * **どの軸かで扱いを分けません。** 作りかけも中身入りも「素の型の変種」で、違うのは軸の名前と、
   * その名前に紐づく書式（[`Localization.md`](../../docs/engine/Localization.md)）だけです。
   */
  variationsOf(def: ObjectDef): ReadonlyMap<string, string> {
    return this.generatedTypes.coordinateOf(def).axisValues;
  }

  /**
   * defの座標から、axisValuesで指した軸だけを動かした先の型（`become`、9.9節）。その座標に型が
   * 居なければundefined＝そこへは変われない。
   */
  tryResolveBecome(def: ObjectDef, axisValues: ReadonlyMap<string, string>): ObjectDef | undefined {
    const globalId = this.generatedTypes.tryResolve(def, axisValues);
    return globalId === undefined ? undefined : this.objects.get(globalId);
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
   * 世界にただ1つ存在する型（`singleton: true`、15節）のグローバルIDを宣言順で返す。
   *
   * 「1つだけ存在すべき」を「**世界を作った時点で必ず1つ在る**」と読む（NewGame.start）。そうでないと、
   * 型の名前で行き先を指す`move`の`to_object`（9.6節）が、まだ湧いていない場所を指すことになる。
   */
  singletonGlobalIds(): readonly number[] {
    const ids: number[] = [];
    for (let globalId = 0; globalId < this.objects.count; globalId++) {
      if (this.objects.get(globalId).isSingleton) ids.push(globalId);
    }
    return ids;
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
