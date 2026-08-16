import { parseDocument } from 'yaml';
import type { YAMLMap } from 'yaml';
import type { YamlNode } from './yamlMapping';
import {
  asMap,
  asScalarText,
  entriesInOrder,
  tryGetBool,
  tryGetMap,
  tryGetScalar,
  tryGetSeq,
} from './yamlMapping';
import { YamlLoadError } from './YamlLoadError';
import { RawObjectDef } from './RawObjectDef';
import type { LoadReport } from './LoadReport';
import type { RawPatch } from './RawPatch';
import { applyPatches, parsePatch } from './RawPatch';
import { RawTrait } from './RawTrait';
import { buildGenerationDefs, loadGenerationSections, resetGeneration } from './parseGeneration';
import { NameRegistry } from '../domain/defs/NameRegistry';
import type { ObjectDef } from '../domain/defs/ObjectDef';
import { ObjectDefTable } from '../domain/defs/ObjectDef';
import { WellKnownProperties } from '../domain/defs/WellKnownProperties';
import { IN_PROGRESS_SOURCE, inProgressObjectsYaml, productGlobalIdOf } from './inProgressObjects';
import { WorldCodex } from '../domain/defs/WorldCodex';
import type { AxisDef } from '../domain/defs/generation/AxisDef';
import type { GenerationScopeDef } from '../domain/defs/generation/GenerationScopeDef';
import type { LocationTypeDef } from '../domain/defs/generation/LocationTypeDef';

/**
 * YAMLファイル群からWorldCodexを組み立てるロード処理の入口（GameElementDefinition.md 3節）。
 *
 * パース全般をこのクラスが担い、5種のNameRegistryを保持する。「trait解決込みでobject_defを
 * 組み立てる」責務はRawObjectDef.resolveが担う。props/slots/actions/combinationsはフィールド
 * 単位のtrait上書きマージ対象のため、深い意味解釈とprop/slot名等のInternはload時点ではなく
 * resolveまで遅延する。object_def自身のglobalIdのみtrait解決に依存しないため、parseObjectDefの
 * 時点で確定する。
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

    const objectDefs = tryGetMap(root, 'object_defs', label);
    if (objectDefs !== undefined)
      for (const [name, node] of entriesInOrder(objectDefs))
        addUnique(
          this.globalObjectDefs,
          name,
          this.parseObjectDef(name, asMap(node, `object_defs.'${name}'`), label),
          'object_defs',
        );

    const traits = tryGetMap(root, 'traits', label);
    if (traits !== undefined)
      for (const [name, node] of entriesInOrder(traits))
        addUnique(
          this.globalTraits,
          name,
          this.parseTrait(name, asMap(node, `traits.'${name}'`), label),
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
          report.add(
            label,
            `patch_object_defs[${index}]`,
            error instanceof Error ? error.message : String(error),
          );
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
    const generated = inProgressObjectsYaml(
      [...objectDefsByGlobalId.values()],
      this.tagNames,
      this.objectNames,
    );
    const inProgressProducts = new Map<number, number>();
    if (generated !== undefined) {
      const authored = new Set(this.globalObjectDefs.keys());
      this.load(IN_PROGRESS_SOURCE, generated);
      for (const [name, raw] of this.globalObjectDefs) {
        if (authored.has(name)) continue;
        const def = raw.resolve(this.globalTraits, this);
        objectDefsByGlobalId.set(def.globalId, def);
        inProgressProducts.set(def.globalId, productGlobalIdOf(name, this.objectNames));
      }
    }

    // 全object_defの走査が終わったこの時点で、objectNames.countが最終値として確定する。
    const defsByGlobalId = new Array<ObjectDef>(this.objectNames.count);
    for (const [globalId, def] of objectDefsByGlobalId) defsByGlobalId[globalId] = def;

    const wellKnown = new WellKnownProperties(this.propertyNames);
    const generation = buildGenerationDefs(this, objectDefsByGlobalId);
    const codex = new WorldCodex(
      this.objectNames,
      this.propertyNames,
      this.slotNames,
      this.tagNames,
      this.propertyTagNames,
      this.symbolNames,
      new ObjectDefTable(defsByGlobalId),
      wellKnown,
      generation,
      inProgressProducts,
    );

    this.reset();
    return codex;
  }

  private reset(): void {
    this.globalObjectDefs.clear();
    this.globalTraits.clear();
    this.patches = [];
    resetGeneration(this);
    this._objectNames = new NameRegistry();
    this._propertyNames = new NameRegistry();
    this._slotNames = new NameRegistry();
    this._tagNames = new NameRegistry();
    this._propertyTagNames = new NameRegistry();
    this._symbolNames = new NameRegistry();
  }

  /** object_defs.'name'の1エントリ。中身の取り出しはRawObjectDef自身が行う（patchで取り直すため）。
   * globalIdのみここで確定させる。 */
  private parseObjectDef(name: string, node: YAMLMap, source: string): RawObjectDef {
    return new RawObjectDef(name, source, this.objectNames.intern(name), node);
  }

  /** traits.'name'の1エントリを浅く抽出する（parseObjectDefと同じく生YAMLノードのまま持つ）。
   * traitは実行時に識別されないため、interning対象の識別子を持たない。 */
  private parseTrait(name: string, node: YAMLMap, source: string): RawTrait {
    const context = `traits.'${name}'`;

    const raw = new RawTrait(name, source);
    raw.props = tryGetMap(node, 'props', context);
    raw.slots = tryGetMap(node, 'slots', context);
    raw.passives = tryGetSeq(node, 'passives', context);
    raw.stackOrder = tryGetMap(node, 'stack_order', context);
    raw.representedBy = tryGetScalar(node, 'represented_by', context);
    raw.mainItemSlot = tryGetScalar(node, 'main_item_slot', context);
    raw.artByStage = tryGetScalar(node, 'art_by_stage', context);
    raw.quantitative = tryGetBool(node, 'quantitative', context, false);
    raw.boundToOwner = tryGetBool(node, 'bound_to_owner', context, false);
    raw.notStackable = !tryGetBool(node, 'stackable', context, true);
    raw.actions = tryGetMap(node, 'actions', context);
    raw.combinations = tryGetMap(node, 'combinations', context);

    // レシピは成果物のobject_defへ埋め込むもの（RecipeSystem.md）なので、複数の型へ混ぜるtraitには
    // 書けない（どれが成果物か決まらない）。読み飛ばすと黙って消えるため、ロード時に弾く。
    if (tryGetMap(node, 'recipes', context) !== undefined)
      throw new YamlLoadError(
        `${context}: recipesはtraitに書けません（成果物のobject_defへ書いてください）。`,
      );

    const tags = tryGetSeq(node, 'tags', context);
    if (tags !== undefined) for (const t of tags.items as YamlNode[]) raw.tags.push(asScalarText(t, context));

    return raw;
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
