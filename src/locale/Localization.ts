import { parseDocument } from 'yaml';
import type { AssetPack } from '../asset-pack/AssetPack';
import type { YAMLMap } from 'yaml';
import { asMap, asScalarText, entriesInOrder, tryGetMap, tryGetScalar } from '../loader/yamlMapping';
import { YamlLoadError } from '../loader/YamlLoadError';
import type { LocationName } from '../domain/generation/IslandMap';

/** 表示文字列を引く言語。切り替えの入口はまだ無いため、日本語で固定（Localization.md）。 */
export const LANGUAGE = 'ja';

/** ゲーム本体に同梱される表示文字列ファイル（src/assets/locale/、ビルド時に中身が埋め込まれる）。 */
export const LOCALE_FILE = `locale/${LANGUAGE}.yaml`;

/** 同梱される表示文字列ファイルの中身。言語ごとに1ファイルで、コード側への登録は要らない。 */
const LOCALE_TEXTS = import.meta.glob('../assets/locale/*.yaml', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

/** LOCALE_FILEの中身。 */
export function bundledLocaleText(): string {
  const text = LOCALE_TEXTS[`../assets/locale/${LANGUAGE}.yaml`];
  if (text === undefined) throw new YamlLoadError(`'${LOCALE_FILE}' が同梱されていません。`);
  return text;
}

/**
 * 表示文字列を読む。同梱ぶんに、アセットパックが同じ言語の対応表を持っていれば重ねる
 * （AssetPack.md）。書式の誤りも識別子の重複もYamlLoadErrorのまま呼び出し側へ出す。
 */
export function loadLocalization(pack: AssetPack | undefined): Localization {
  const bundled = parseLocale(LOCALE_FILE, bundledLocaleText());

  const packText = pack?.localeText(LANGUAGE);
  if (pack === undefined || packText === undefined) return bundled;

  const label = `${pack.name}:${LOCALE_FILE}`;
  return bundled.mergedWith(parseLocale(label, packText), label);
}

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

  /**
   * 名前の代わりに置ける絵（Localization.md）。無ければundefinedで、呼び出し側は名前を出す。
   * 今これを読むのはステータスの行だけ（StatusArea.md 3節）。
   */
  readonly icon: string | undefined;

  constructor(displayName: string, description?: string, icon?: string) {
    this.displayName = displayName;
    this.description = description;
    this.icon = icon;
  }
}

/**
 * 書式へ名前で値を差し込む（`{name}` の形。ICU MessageFormatなどJSで広く使われている書き方に倣う）。
 *
 * **置換は1回で走らせる。** 順に置き換えると、先に差し込んだ名前の中の `{...}` まで置換対象になる。
 * 知らない名前はそのまま残す——書式の書き間違いを、黙って空文字にするより気付けるようにするため。
 */
function format(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}

/**
 * 1つのスロットの表示文字列。
 *
 * スロットは必ず持ち主のものなので、名前は2通りある。`displayName` はスロットだけを指す短い言い方
 * （「装備」）、`displayNameWithOwner` は持ち主込みの言い方（「マルコの装備」）で、後者は書式から
 * 組み立てる。中身入りの入れ物の名前（`displayNameWithContent`）と同じ考え方。
 */
export class SlotTexts {
  readonly displayName: string;

  /**
   * ここへ物を入れる操作の文言（宣言が無ければundefined）。ドロップの吹き出しに出す
   * （CardInteraction.md 2節 カードのドラッグ＆ドロップ）。スロットの名前（場所を指す「手当て」）とは
   * 別の文字列——出すのは行為の名前（「手当てする」）だから。
   */
  readonly putIn: Texts | undefined;

  private readonly format: string | undefined;

  constructor(displayName: string, format?: string, putIn?: Texts) {
    this.displayName = displayName;
    this.format = format;
    this.putIn = putIn;
  }

  /**
   * 持ち主込みの言い方。書式の `{slot}` がスロットの名前、`{owner}` が持ち主の名前。
   * 書式が無ければスロットの名前だけを返す。
   */
  displayNameWithOwner(ownerName: string): string {
    if (this.format === undefined) return this.displayName;
    return format(this.format, { slot: this.displayName, owner: ownerName });
  }
}

/** localeファイルに書かれたままの表示文字列（いずれも省略可能）。識別子へのフォールバックは引く側が行う。 */
interface DeclaredTexts {
  readonly displayName: string | undefined;
  readonly description: string | undefined;
  readonly icon: string | undefined;
  readonly displayNameWithContent: string | undefined;
  readonly displayNameWithOwner: string | undefined;
  readonly displayNameInProgress: string | undefined;
}

/** localeファイルのslot_textsの1エントリ（スロット自身の文字列と、そこへ入れる操作の文字列）。 */
class SlotTextsEntry {
  readonly own: DeclaredTexts | undefined;
  readonly putIn: DeclaredTexts | undefined;

  constructor(own: DeclaredTexts | undefined, putIn: DeclaredTexts | undefined) {
    this.own = own;
    this.putIn = putIn;
  }
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

  /**
   * 中身（represented_byの代表、GameElementDefinition.md 7.6節）がいるときの表示名。
   * display_name_with_content の `%1` が自分の表示名、`%2` が中身の名前になる。書式が無ければ
   * 表示名のまま（中身の有無で名前が変わらない）。
   *
   * displayNameと違いdefaultエントリを参照する。書式であって名前ではなく、`%1` は各オブジェクト
   * 自身の表示名から埋まるので、共通の書式を書いても全オブジェクトが同じ名前になることはない。
   */
  displayNameWithContent(contentName: string): string {
    const declared = this.entry?.own?.displayNameWithContent ?? this.defaults?.own?.displayNameWithContent;
    if (declared === undefined) return this.displayName;
    return format(declared, { container: this.displayName, content: contentName });
  }

  /**
   * 製作中オブジェクト（RecipeSystem.md 1節）の表示名。`{product}` に完成品の名前が入る。
   *
   * この型は自動生成なので対応表に自分のエントリを持てない。displayNameWithContentと同じく、
   * 書式であって名前なのでdefaultエントリを参照する。
   */
  displayNameInProgress(productName: string): string {
    const declared = this.entry?.own?.displayNameInProgress ?? this.defaults?.own?.displayNameInProgress;
    if (declared === undefined) return productName;
    return format(declared, { product: productName });
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
    return new Texts(declared?.displayName ?? name, declared?.description, declared?.icon);
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
  private readonly symbols: ReadonlyMap<string, DeclaredTexts>;
  private readonly locations: ReadonlyMap<string, LocationTextsEntry>;
  private readonly reasons: ReadonlyMap<string, string>;
  private readonly ordinalSuffix: string;
  private readonly slots: ReadonlyMap<string, SlotTextsEntry>;
  private readonly signals: ReadonlyMap<string, string>;
  private readonly stages: ReadonlyMap<string, string>;

  constructor(
    objects: ReadonlyMap<string, ObjectTextsEntry>,
    propertyTags: ReadonlyMap<string, DeclaredTexts> = new Map(),
    symbols: ReadonlyMap<string, DeclaredTexts> = new Map(),
    locations: ReadonlyMap<string, LocationTextsEntry> = new Map(),
    reasons: ReadonlyMap<string, string> = new Map(),
    ordinalSuffix: string = DEFAULT_ORDINAL_SUFFIX,
    slots: ReadonlyMap<string, SlotTextsEntry> = new Map(),
    signals: ReadonlyMap<string, string> = new Map(),
    stages: ReadonlyMap<string, string> = new Map(),
  ) {
    this.objects = objects;
    this.propertyTags = propertyTags;
    this.symbols = symbols;
    this.locations = locations;
    this.reasons = reasons;
    this.ordinalSuffix = ordinalSuffix;
    this.slots = slots;
    this.signals = signals;
    this.stages = stages;
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

  /**
   * 操作を実行できない理由（GameElementDefinition.md 14.6節のreason）の文言。未登録ならundefinedで、
   * 呼び出し側は理由を出さない（識別子をそのまま画面へ出しても意味が通らないため）。
   */
  reason(reasonName: string): string | undefined {
    return this.reasons.get(reasonName);
  }

  /**
   * 段（GameElementDefinition.md 6.4節のstages）の文言。カードの覆いのように、UIが段の名前を読んで
   * 出す場所で使う（CardView.md 9.1節）。未登録なら識別子そのもの。
   *
   * 段の名前はプロパティごとの名前空間だが、対応表は平らに持つ——同じ名前の段は同じ言葉で出す。
   */
  stage(stageName: string): string {
    return this.stages.get(stageName) ?? stageName;
  }

  /**
   * 告げられた出来事（GameElementDefinition.md 9.8節のsignal）の文言。未登録なら識別子そのもの。
   *
   * 理由（reason）と違って「出さない」選択が無い——出来事が起きたことは既に世界の側で決まっていて、
   * 文言の欠けを黙って握り潰すと、空振りが再び「何も起きない」に戻る。
   */
  signal(signalName: string): string {
    return this.signals.get(signalName) ?? signalName;
  }

  /**
   * スロット（GameElementDefinition.md 7節）の表示文字列。未登録なら識別子そのもの。
   *
   * スロットは必ず持ち主のものなので、名前も**持ち主込みの言い方**を持てる（`display_name_with_owner`、
   * 中身入りの入れ物の名前と同じ考え方）。子ウィンドウの見出しがこれを使う。
   */
  slot(slotName: string): SlotTexts {
    const declared = this.slots.get(slotName);
    const format =
      declared?.own?.displayNameWithOwner ?? this.slots.get(DEFAULT_KEY)?.own?.displayNameWithOwner;
    const putIn = declared?.putIn;
    return new SlotTexts(
      declared?.own?.displayName ?? slotName,
      format,
      putIn === undefined ? undefined : new Texts(putIn.displayName ?? slotName, putIn.description),
    );
  }

  /** プロパティのタグ（GameElementDefinition.md 6.7節）の表示文字列。未登録なら識別子そのもの。 */
  propertyTag(tagName: string): Texts {
    const declared = this.propertyTags.get(tagName);
    return new Texts(declared?.displayName ?? tagName, declared?.description);
  }

  /**
   * シンボル型プロパティの値（GameElementDefinition.md 6.6節。天気の`scorching`、季節の`dry`など）の
   * 表示文字列。未登録なら識別子そのもの。
   *
   * 値はどのオブジェクトにも属さない独立した名前空間（`WorldCodex.symbolNames`）にあるので、
   * プロパティのタグと同じく独立した節から引く。
   */
  symbol(symbolName: string): Texts {
    const declared = this.symbols.get(symbolName);
    return new Texts(declared?.displayName ?? symbolName, declared?.description);
  }

  /** 1つのobject_defの表示文字列。未登録のオブジェクトでも、識別子へフォールバックする窓口として必ず返る。 */
  object(objectDefName: string): ObjectTexts {
    return new ObjectTexts(objectDefName, this.objects.get(objectDefName), this.objects.get(DEFAULT_KEY));
  }

  /**
   * もう1つの対応表を重ねた対応表を返す（アセットパックのぶん、AssetPack.md）。
   *
   * **同じ識別子が両方にあればエラー。** 定義YAMLと同じ規則で、後勝ちの上書きは持たない
   * （どちらの言葉が出るかが読み込み順で決まってしまう）。通し番号の書式は、相手が宣言して
   * いればそちらを採る（既定のままなら重複ではない）。
   */
  mergedWith(other: Localization, label: string): Localization {
    return new Localization(
      merged(this.objects, other.objects, label, 'object_texts'),
      merged(this.propertyTags, other.propertyTags, label, 'property_tag_texts'),
      merged(this.symbols, other.symbols, label, 'symbol_texts'),
      merged(this.locations, other.locations, label, 'location_texts'),
      merged(this.reasons, other.reasons, label, 'reason_texts'),
      other.ordinalSuffix === DEFAULT_ORDINAL_SUFFIX ? this.ordinalSuffix : other.ordinalSuffix,
      merged(this.slots, other.slots, label, 'slot_texts'),
      merged(this.signals, other.signals, label, 'signal_texts'),
      merged(this.stages, other.stages, label, 'stage_texts'),
    );
  }

  /** 表示文字列を1つも持たない対応表（表示文字列を必要としないテスト用）。 */
  static empty(): Localization {
    return new Localization(new Map());
  }
}

/** 2つの節を重ねる。同じ識別子が両方にあれば、どちらが出るか決められないのでエラー。 */
function merged<T>(
  base: ReadonlyMap<string, T>,
  added: ReadonlyMap<string, T>,
  label: string,
  section: string,
): ReadonlyMap<string, T> {
  const all = new Map(base);
  for (const [name, value] of added) {
    if (all.has(name)) throw new YamlLoadError(`${label}: ${section} の '${name}' は既に宣言されています。`);
    all.set(name, value);
  }
  return all;
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

  const slots = new Map<string, SlotTextsEntry>();
  const slotSection = tryGetMap(root, 'slot_texts', label);
  if (slotSection !== undefined)
    for (const [name, node] of entriesInOrder(slotSection)) {
      const context = `${label}.slot_texts.'${name}'`;
      const entryNode = asMap(node, context);
      const putInNode = tryGetMap(entryNode, 'put_in', context);
      slots.set(
        name,
        new SlotTextsEntry(
          parseTexts(entryNode, context),
          putInNode === undefined ? undefined : parseTexts(putInNode, `${context}.put_in`),
        ),
      );
    }

  const symbols = new Map<string, DeclaredTexts>();
  const symbolSection = tryGetMap(root, 'symbol_texts', label);
  if (symbolSection !== undefined)
    for (const [name, node] of entriesInOrder(symbolSection)) {
      const context = `${label}.symbol_texts.'${name}'`;
      const texts = parseTexts(asMap(node, context), context);
      if (texts !== undefined) symbols.set(name, texts);
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

  const reasons = new Map<string, string>();
  const reasonSection = tryGetMap(root, 'reason_texts', label);
  if (reasonSection !== undefined)
    for (const [name, node] of entriesInOrder(reasonSection))
      reasons.set(name, asScalarText(node, `${label}.reason_texts.'${name}'`));

  const signals = new Map<string, string>();
  const signalSection = tryGetMap(root, 'signal_texts', label);
  if (signalSection !== undefined)
    for (const [name, node] of entriesInOrder(signalSection))
      signals.set(name, asScalarText(node, `${label}.signal_texts.'${name}'`));

  const stages = new Map<string, string>();
  const stageSection = tryGetMap(root, 'stage_texts', label);
  if (stageSection !== undefined)
    for (const [name, node] of entriesInOrder(stageSection))
      stages.set(name, asScalarText(node, `${label}.stage_texts.'${name}'`));

  return new Localization(
    objects,
    propertyTags,
    symbols,
    locations,
    reasons,
    ordinalSuffix,
    slots,
    signals,
    stages,
  );
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

/** 1つの対象の表示文字列を読む。1つも書かれていなければundefined。 */
function parseTexts(node: YAMLMap, context: string): DeclaredTexts | undefined {
  const displayName = tryGetScalar(node, 'display_name', context);
  const description = tryGetScalar(node, 'description', context);
  const icon = tryGetScalar(node, 'icon', context);
  const displayNameWithContent = tryGetScalar(node, 'display_name_with_content', context);
  const displayNameWithOwner = tryGetScalar(node, 'display_name_with_owner', context);
  const displayNameInProgress = tryGetScalar(node, 'display_name_in_progress', context);
  if (
    displayName === undefined &&
    description === undefined &&
    icon === undefined &&
    displayNameWithContent === undefined &&
    displayNameWithOwner === undefined &&
    displayNameInProgress === undefined
  )
    return undefined;
  return {
    displayName,
    description,
    icon,
    displayNameWithContent,
    displayNameWithOwner,
    displayNameInProgress,
  };
}
