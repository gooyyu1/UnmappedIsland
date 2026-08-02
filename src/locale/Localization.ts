import { parseDocument } from 'yaml';
import type { YAMLMap } from 'yaml';
import { asMap, entriesInOrder, tryGetMap, tryGetScalar } from '../loader/yamlMapping';
import { YamlLoadError } from '../loader/YamlLoadError';
import type { LocationName } from '../domain/generation/IslandMap';

/** 表示文字列を引く言語。切り替えの入口はまだ無いため、日本語で固定（Localization.md）。 */
export const LANGUAGE = 'ja';

/** ゲーム本体に同梱される表示文字列ファイルのパス（public/配下、ビルドでそのまま配信される）。 */
export const LOCALE_FILE = `locale/${LANGUAGE}.yaml`;

/**
 * オブジェクトが持つメンバーのうち、表示文字列を定義できる種類。値はlocaleファイルの節名であり、
 * WorldCodex側の呼び名（props/actions/combinations）に揃えている。
 */
const MEMBER_CATEGORIES = ['props', 'actions', 'combinations'] as const;
type MemberCategory = (typeof MEMBER_CATEGORIES)[number];

/** 全オブジェクト共通のメンバーの表示文字列を書くときの、オブジェクト識別子の代わりのキー。 */
const DEFAULT_KEY = 'default';

/**
 * 1つの対象（オブジェクト・プロパティ・アクション等）の表示文字列。
 *
 * displayNameは必ず値を持つ: 対応表に無ければ識別子そのものになる（Localization.md）。
 * descriptionは無ければundefinedで、呼び出し側が「説明が無い」ことを区別できるようにする。
 */
export class Texts {
  readonly displayName: string;
  readonly description: string | undefined;

  constructor(displayName: string, description?: string) {
    this.displayName = displayName;
    this.description = description;
  }
}

/** localeファイルに書かれたままの表示文字列（どちらも省略可能）。識別子へのフォールバックは引く側が行う。 */
interface DeclaredTexts {
  readonly displayName: string | undefined;
  readonly description: string | undefined;
}

/** localeファイルの1エントリ（オブジェクト自身の文字列と、種類ごとのメンバーの文字列）。 */
class ObjectTextsEntry {
  readonly own: DeclaredTexts | undefined;
  private readonly members: ReadonlyMap<MemberCategory, ReadonlyMap<string, DeclaredTexts>>;

  constructor(
    own: DeclaredTexts | undefined,
    members: ReadonlyMap<MemberCategory, ReadonlyMap<string, DeclaredTexts>>,
  ) {
    this.own = own;
    this.members = members;
  }

  tryGetMember(category: MemberCategory, name: string): DeclaredTexts | undefined {
    return this.members.get(category)?.get(name);
  }
}

/**
 * 1つのオブジェクトの表示文字列を引く窓口。メンバー（props/actions/combinations）は、そのオブジェクト
 * 自身の定義 → defaultエントリの定義 → 識別子、の順に解決する。
 */
export class ObjectTexts {
  private readonly identifier: string;
  private readonly entry: ObjectTextsEntry | undefined;
  private readonly defaults: ObjectTextsEntry | undefined;

  constructor(
    identifier: string,
    entry: ObjectTextsEntry | undefined,
    defaults: ObjectTextsEntry | undefined,
  ) {
    this.identifier = identifier;
    this.entry = entry;
    this.defaults = defaults;
  }

  /** オブジェクト自身の表示名。defaultエントリは参照しない（全オブジェクトが同じ名前になってしまうため）。 */
  get displayName(): string {
    return this.entry?.own?.displayName ?? this.identifier;
  }

  /** オブジェクト自身の説明文。displayNameと同じくdefaultエントリは参照しない。 */
  get description(): string | undefined {
    return this.entry?.own?.description;
  }

  prop(propertyName: string): Texts {
    return this.member('props', propertyName);
  }

  action(actionName: string): Texts {
    return this.member('actions', actionName);
  }

  combination(combinationName: string): Texts {
    return this.member('combinations', combinationName);
  }

  private member(category: MemberCategory, name: string): Texts {
    const declared = this.entry?.tryGetMember(category, name) ?? this.defaults?.tryGetMember(category, name);
    return new Texts(declared?.displayName ?? name, declared?.description);
  }
}

/**
 * 1つの土地の型の表示文字列を引く窓口。亜種（variants）はメンバーとして持つ。
 * オブジェクトと違い、土地の名前は型と亜種の識別子の組み合わせで決まる（TerrainGeneration.md 3.6節）。
 */
export class LocationTexts {
  private readonly identifier: string;
  private readonly entry: LocationTextsEntry | undefined;

  constructor(identifier: string, entry: LocationTextsEntry | undefined) {
    this.identifier = identifier;
    this.entry = entry;
  }

  /** 亜種を持たない土地の表示名。未登録なら識別子そのもの。 */
  get displayName(): string {
    return this.entry?.own?.displayName ?? this.identifier;
  }

  get description(): string | undefined {
    return this.entry?.own?.description;
  }

  /** 亜種の表示名。これがその土地の名前そのものになる（型の名前へは足さない）。 */
  variant(variantId: string): Texts {
    const declared = this.entry?.tryGetVariant(variantId);
    return new Texts(declared?.displayName ?? variantId, declared?.description);
  }
}

/** localeファイルのlocation_textsの1エントリ（型自身の文字列と、亜種ごとの文字列）。 */
class LocationTextsEntry {
  readonly own: DeclaredTexts | undefined;
  private readonly variants: ReadonlyMap<string, DeclaredTexts>;

  constructor(own: DeclaredTexts | undefined, variants: ReadonlyMap<string, DeclaredTexts>) {
    this.own = own;
    this.variants = variants;
  }

  tryGetVariant(variantId: string): DeclaredTexts | undefined {
    return this.variants.get(variantId);
  }
}

/**
 * 亜種を使い切ったときに名前へ付ける通し番号の書式（location_texts.default.ordinal_suffix）。
 * `{n}` が番号に置き換わる。データ（variants）が足りないときの最後の手段なので、通常は使われない。
 */
const DEFAULT_ORDINAL_SUFFIX = ' ({n})';

/**
 * 識別子から表示文字列を引く対応表（Localization.md）。WorldCodexは識別子だけを持ち、
 * 画面に出す文字列はこちらが持つ。
 */
export class Localization {
  private readonly objects: ReadonlyMap<string, ObjectTextsEntry>;
  private readonly propertyTags: ReadonlyMap<string, DeclaredTexts>;
  private readonly locations: ReadonlyMap<string, LocationTextsEntry>;
  private readonly ordinalSuffix: string;

  constructor(
    objects: ReadonlyMap<string, ObjectTextsEntry>,
    propertyTags: ReadonlyMap<string, DeclaredTexts> = new Map(),
    locations: ReadonlyMap<string, LocationTextsEntry> = new Map(),
    ordinalSuffix: string = DEFAULT_ORDINAL_SUFFIX,
  ) {
    this.objects = objects;
    this.propertyTags = propertyTags;
    this.locations = locations;
    this.ordinalSuffix = ordinalSuffix;
  }

  /** 1つの土地の型の表示文字列。未登録の型でも、識別子へフォールバックする窓口として必ず返る。 */
  location(typeName: string): LocationTexts {
    return new LocationTexts(typeName, this.locations.get(typeName));
  }

  /**
   * 生成された土地の名前（LocationName）を1つの文字列に組み立てる。亜種があればその名前が
   * 土地の名前そのもので、無ければ型の名前になる。
   */
  locationName(name: LocationName): string {
    const texts = this.location(name.typeName);
    const base = name.variantId === undefined ? texts.displayName : texts.variant(name.variantId).displayName;
    return name.ordinal === undefined ? base : base + this.ordinalSuffix.replace('{n}', String(name.ordinal));
  }

  /** プロパティのタグ（GameElementDefinition.md 6.7節）の表示文字列。未登録なら識別子そのもの。 */
  propertyTag(tagName: string): Texts {
    const declared = this.propertyTags.get(tagName);
    return new Texts(declared?.displayName ?? tagName, declared?.description);
  }

  /** 1つのobject_defの表示文字列。未登録のオブジェクトでも、識別子へフォールバックする窓口として必ず返る。 */
  object(objectDefName: string): ObjectTexts {
    return new ObjectTexts(objectDefName, this.objects.get(objectDefName), this.objects.get(DEFAULT_KEY));
  }

  /** 表示文字列を1つも持たない対応表（表示文字列を必要としないテスト用）。 */
  static empty(): Localization {
    return new Localization(new Map());
  }
}

/**
 * 表示文字列のYAMLを読む（labelはエラーメッセージ用の出所表示）。知らない節・キーは無視するため、
 * 実装が追いつく前に節を足しても壊れない。
 */
export function parseLocale(label: string, yamlText: string): Localization {
  const document = parseDocument(yamlText);
  if (document.errors.length > 0)
    throw new YamlLoadError(`${label}: YAML構文エラー: ${document.errors[0].message}`);
  if (document.contents === null) return Localization.empty();

  const root = asMap(document.contents, label);

  const objects = new Map<string, ObjectTextsEntry>();
  const section = tryGetMap(root, 'object_texts', label);
  if (section !== undefined)
    for (const [name, node] of entriesInOrder(section)) {
      const context = `${label}.object_texts.'${name}'`;
      objects.set(name, parseEntry(asMap(node, context), context));
    }

  const propertyTags = new Map<string, DeclaredTexts>();
  const tagSection = tryGetMap(root, 'property_tag_texts', label);
  if (tagSection !== undefined)
    for (const [name, node] of entriesInOrder(tagSection)) {
      const context = `${label}.property_tag_texts.'${name}'`;
      const texts = parseTexts(asMap(node, context), context);
      if (texts !== undefined) propertyTags.set(name, texts);
    }

  const locations = new Map<string, LocationTextsEntry>();
  let ordinalSuffix = DEFAULT_ORDINAL_SUFFIX;
  const locationSection = tryGetMap(root, 'location_texts', label);
  if (locationSection !== undefined)
    for (const [name, node] of entriesInOrder(locationSection)) {
      const context = `${label}.location_texts.'${name}'`;
      const entryNode = asMap(node, context);

      if (name === DEFAULT_KEY) {
        ordinalSuffix = tryGetScalar(entryNode, 'ordinal_suffix', context) ?? ordinalSuffix;
        continue;
      }

      const variants = new Map<string, DeclaredTexts>();
      const variantsNode = tryGetMap(entryNode, 'variants', context);
      if (variantsNode !== undefined)
        for (const [variantId, variantNode] of entriesInOrder(variantsNode)) {
          const variantContext = `${context}.variants.'${variantId}'`;
          const texts = parseTexts(asMap(variantNode, variantContext), variantContext);
          if (texts !== undefined) variants.set(variantId, texts);
        }

      locations.set(name, new LocationTextsEntry(parseTexts(entryNode, context), variants));
    }

  return new Localization(objects, propertyTags, locations, ordinalSuffix);
}

function parseEntry(node: YAMLMap, context: string): ObjectTextsEntry {
  const members = new Map<MemberCategory, ReadonlyMap<string, DeclaredTexts>>();
  for (const category of MEMBER_CATEGORIES) {
    const categoryNode = tryGetMap(node, category, context);
    if (categoryNode === undefined) continue;

    const entries = new Map<string, DeclaredTexts>();
    for (const [name, memberNode] of entriesInOrder(categoryNode)) {
      const memberContext = `${context}.${category}.'${name}'`;
      const texts = parseTexts(asMap(memberNode, memberContext), memberContext);
      if (texts !== undefined) entries.set(name, texts);
    }
    members.set(category, entries);
  }

  return new ObjectTextsEntry(parseTexts(node, context), members);
}

/** display_name/descriptionを読む。どちらも無ければundefined。 */
function parseTexts(node: YAMLMap, context: string): DeclaredTexts | undefined {
  const displayName = tryGetScalar(node, 'display_name', context);
  const description = tryGetScalar(node, 'description', context);
  return displayName === undefined && description === undefined ? undefined : { displayName, description };
}
