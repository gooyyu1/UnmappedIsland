import { parseDocument } from 'yaml';
import type { YamlNode } from './yamlMapping';
import { asMap, asScalarText, entriesInOrder, tryGetMap, tryGetSeq } from './yamlMapping';
import { YamlLoadError } from './YamlLoadError';
import { messageOf } from './errorMessage';
import { RawObjectDef } from './RawObjectDef';
import type { LoadReport } from './LoadReport';
import type { RawPatch } from './RawPatch';
import { applyPatches, parsePatch } from './RawPatch';
import { RawTrait } from './RawTrait';
import { buildGenerationDefs, loadGenerationSections, resetGeneration } from './parseGeneration';
import { NameRegistry } from '../domain/NameRegistry';
import type { ObjectDef } from '../domain/ObjectDef';
import { ObjectDefTable } from '../domain/ObjectDef';
import { WorldVocabulary } from '../domain/WorldVocabulary';
import { IN_PROGRESS_SOURCE, inProgressObjectsYaml } from './inProgressObjects';
import type { GeneratedObjectDefs } from './generatedObjectDefs';
import { GeneratedTypes } from '../domain/GeneratedTypes';
import { AXIS_VARIANT_SOURCE, axisVariantsYaml } from './axisVariants';
import { WorldCodex } from '../domain/WorldCodex';
import type { AxisDef } from '../domain/generation/AxisDef';
import type { GenerationScopeDef } from '../domain/generation/GenerationScopeDef';
import type { LocationTypeDef } from '../domain/generation/LocationTypeDef';
import { built } from './parseCommon';

/**
 * YAMLファイル群からWorldCodexを組み立てるロード処理の入口（GameElementDefinition.md 3節）。
 *
 * パース全般をこのクラスが担い、名前空間ごとのNameRegistryを保持する（objectNames以下のゲッター参照）。「trait解決込みでobject_defを
 * 組み立てる」責務はRawObjectDef.resolveが担う。props/slots/actions/combinationsはフィールド
 * 単位のtrait上書きマージ対象のため、深い意味解釈とprop/slot名等のInternはload時点ではなく
 * resolveまで遅延する。object_def自身のglobalIdのみtrait解決に依存しないため、RawObjectDefを
 * 作る時点で確定する。
 *
 * load系メソッドは何度でも呼べ、呼ぶたびにこのインスタンスへ追記する（thisを返すため
 * `new WorldCodexYamlLoader().load(label, text).build()`と書ける）。
 *
 * object_defs/trait名の重複は、呼び出し元・ファイル・ディレクトリを問わず常にエラー（3.3節の
 * 厳格モード）。「後勝ちで上書き」の規則は一切持たない（MODによる差し替えは専用のpatch文法で
 * 表現する想定）。
 *
 * buildは蓄積内容から不変のWorldCodexを組み立てて返し、このインスタンスの蓄積状態を初期化する。
 */
export class WorldCodexYamlLoader {
  /** load系メソッドで蓄積した、パース済みだがtrait未解決のobject_defs/traits。 */
  private readonly globalObjectDefs = new Map<string, RawObjectDef>();
  private readonly globalTraits = new Map<string, RawTrait>();

  /** 読み込んだpatch（3.4節）。当たる先が全部揃ってからでないと当てられないので、buildまで貯める。 */
  private patches: RawPatch[] = [];

  /** レシピ一覧の棚に使うタグ（recipe_categories、Windows.md 9節）。宣言順がそのまま優先順位。 */
  private recipeCategoryTagIds: number[] = [];

  private _objectNames = new NameRegistry();
  private _propertyNames = new NameRegistry();
  private _slotNames = new NameRegistry();
  private _tagNames = new NameRegistry();
  private _propertyTagNames = new NameRegistry();
  private _symbolNames = new NameRegistry();

  /** 6種の名前空間（object/property/slot/tag/property_tag/symbol）のNameRegistry。 */
  get objectNames(): NameRegistry {
    return this._objectNames;
  }
  get propertyNames(): NameRegistry {
    return this._propertyNames;
  }
  get slotNames(): NameRegistry {
    return this._slotNames;
  }
  get tagNames(): NameRegistry {
    return this._tagNames;
  }
  get propertyTagNames(): NameRegistry {
    return this._propertyTagNames;
  }
  get symbolNames(): NameRegistry {
    return this._symbolNames;
  }

  /** load系メソッドで蓄積した地形生成定義（axes/location_types/generation_scopes）。
   * parseGeneration.tsの関数群だけが読み書きする。 */
  readonly generationAxes = new Map<string, AxisDef>();
  readonly generationLocationTypes: LocationTypeDef[] = [];
  readonly generationScopes = new Map<string, GenerationScopeDef>();

  /** テキストとして渡された1つのYAMLを読み込む（labelはエラーメッセージ用の出所表示）。 */
  load(label: string, yamlText: string, report?: LoadReport): this {
    const doc = parseDocument(yamlText);
    if (doc.errors.length > 0) throw new YamlLoadError(`${label}: YAML構文エラー: ${doc.errors[0].message}`);
    if (doc.contents === null) return this;

    const root = asMap(doc.contents, label);

    // プロパティタグ（6.7節）はprops側の参照より先に揃っている必要があるが、object_defのtrait解決
    // （＝propsの解釈）はbuild時なので、ファイル間の読み込み順は問わない。IDは宣言順に振られ、
    // それがそのままUIでのカテゴリの並び順になる。重複宣言はinternが冪等なので黙って無視される。
    const propertyTags = tryGetMap(root, 'property_tags', label);
    if (propertyTags !== undefined)
      for (const [name] of entriesInOrder(propertyTags)) this._propertyTagNames.intern(name);

    // レシピ一覧の棚（Windows.md 9節）。既にあるタグ（4.1節）を並べ替えて指すだけなので、
    // ここでの重複は書き間違いではなく「パックが同じ棚を足した」だけ。先に宣言された位置を保つ。
    const recipeCategories = tryGetSeq(root, 'recipe_categories', label);
    if (recipeCategories !== undefined)
      for (const node of recipeCategories.items as YamlNode[]) {
        const tagId = this._tagNames.intern(asScalarText(node, `${label}.recipe_categories`));
        if (!this.recipeCategoryTagIds.includes(tagId)) this.recipeCategoryTagIds.push(tagId);
      }

    const objectDefs = tryGetMap(root, 'object_defs', label);
    if (objectDefs !== undefined)
      for (const [name, node] of entriesInOrder(objectDefs))
        addUnique(
          this.globalObjectDefs,
          name,
          new RawObjectDef(name, label, this.objectNames.intern(name), asMap(node, `object_defs.'${name}'`)),
          'object_defs',
        );

    const traits = tryGetMap(root, 'traits', label);
    if (traits !== undefined)
      for (const [name, node] of entriesInOrder(traits))
        addUnique(
          this.globalTraits,
          name,
          new RawTrait(name, label, asMap(node, `traits.'${name}'`)),
          'traits',
        );

    // 既存のobject_defへの変更（3.4節）。当たる先が揃っている必要があるので、適用はbuildまで待つ。
    const patches = tryGetSeq(root, 'patch_object_defs', label);
    if (patches !== undefined)
      (patches.items as YamlNode[]).forEach((node, index) => {
        try {
          this.patches.push(parsePatch(node, index, label, report));
        } catch (error) {
          // 書き方そのものの誤りも、報告先があればその1件を捨てて続ける（AssetPack.md 6.1節）。
          if (report === undefined) throw error;
          report.add(label, `patch_object_defs[${index}]`, messageOf(error));
        }
      });

    // 地形生成の3ルートキー（axes/location_types/generation_scopes。parseGeneration.ts）。
    loadGenerationSections(this, label, root);

    return this;
  }

  /** 蓄積したobject_defs/traitsから不変のWorldCodexを組み立てて返す。呼び終わると
   * このインスタンスの蓄積状態は初期化される。 */
  build(): WorldCodex {
    applyPatches(this.patches, this.globalObjectDefs);

    const objectDefsByGlobalId = new Map<number, ObjectDef>();
    for (const raw of this.globalObjectDefs.values()) {
      const def = raw.resolve(this.globalTraits, this);
      objectDefsByGlobalId.set(def.globalId, def);
    }

    // レシピを持つ型から製作中オブジェクトを生成する（RecipeSystem.md 1節）。build()の中でしか
    // 行えない——objectNames.countはこの直後に密配列の長さとして確定し、build()後に型を足すと
    // グローバルIDが配列からはみ出すため。
    const generatedTypes = new GeneratedTypes();
    this.loadGenerated(
      IN_PROGRESS_SOURCE,
      inProgressObjectsYaml([...objectDefsByGlobalId.values()], this.tagNames, this.objectNames),
      objectDefsByGlobalId,
      generatedTypes,
    );

    // 軸を宣言した型から変種を生成する（3.5節）。製作中オブジェクトの後に行うのは、素の型が持つ
    // recipesを変種へ写さないため（作れるのは空の容器のほう）。
    this.loadGenerated(
      AXIS_VARIANT_SOURCE,
      axisVariantsYaml(this, this.globalObjectDefs, [...objectDefsByGlobalId.values()]),
      objectDefsByGlobalId,
      generatedTypes,
    );

    // 全object_defの走査が終わったこの時点で、objectNames.countが最終値として確定する。
    // 参照だけされた型のところは埋まらない（ObjectDefTable参照）。
    const defsByGlobalId = new Array<ObjectDef | undefined>(this.objectNames.count);
    for (const [globalId, def] of objectDefsByGlobalId) defsByGlobalId[globalId] = def;

    const vocabulary = new WorldVocabulary(this.propertyNames, this.slotNames, this.tagNames);
    const generation = buildGenerationDefs(this, objectDefsByGlobalId);
    // 世界全体を見て初めて言える矛盾（型をまたぐ宣言どうしの噛み合わせ）は、両方を持つWorldCodexが見る。
    const codex = built(
      '世界全体',
      () =>
        new WorldCodex(
          this.objectNames,
          this.propertyNames,
          this.slotNames,
          this.tagNames,
          this.propertyTagNames,
          this.symbolNames,
          new ObjectDefTable(defsByGlobalId),
          vocabulary,
          generation,
          generatedTypes,
          this.recipeCategoryTagIds,
        ),
    );

    this.reset();
    return codex;
  }

  /**
   * 生成したobject_defsを読み込み、**新しく現れた型だけ**を解決して生成型として登録する。
   *
   * **どの生成器も手順は同じ**——違うのは何を生成するかと、型ごとの座標の出所だけなので、
   * 生成器はYAMLと座標の組（GeneratedObjectDefs）で答え、ここは1本で足りる。生成が空ならしない。
   */
  private loadGenerated(
    source: string,
    generated: GeneratedObjectDefs | undefined,
    objectDefsByGlobalId: Map<number, ObjectDef>,
    generatedTypes: GeneratedTypes,
  ): void {
    if (generated === undefined) return;

    const authored = new Set(this.globalObjectDefs.keys());
    this.load(source, generated.yaml);
    for (const [name, raw] of this.globalObjectDefs) {
      if (authored.has(name)) continue;
      const coordinate = generated.coordinates.get(name);
      if (coordinate === undefined)
        throw new YamlLoadError(`${source}: 生成した型'${name}'の座標がありません。`);

      const def = raw.resolve(this.globalTraits, this);
      objectDefsByGlobalId.set(def.globalId, def);
      generatedTypes.register(def.globalId, coordinate);
    }
  }

  private reset(): void {
    this.globalObjectDefs.clear();
    this.globalTraits.clear();
    this.patches = [];
    this.recipeCategoryTagIds = [];
    resetGeneration(this);
    this._objectNames = new NameRegistry();
    this._propertyNames = new NameRegistry();
    this._slotNames = new NameRegistry();
    this._tagNames = new NameRegistry();
    this._propertyTagNames = new NameRegistry();
    this._symbolNames = new NameRegistry();
  }
}

function addUnique<T extends { source: string }>(
  map: Map<string, T>,
  name: string,
  raw: T,
  kindLabel: string,
): void {
  const existing = map.get(name);
  if (existing !== undefined)
    throw new YamlLoadError(
      `${kindLabel} '${name}' が重複しています（'${existing.source}' と '${raw.source}'）。`,
    );
  map.set(name, raw);
}
