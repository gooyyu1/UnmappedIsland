import type { DefNames, DescriptionLine, DescriptionToken } from './describe/Description';
import { DescriptionWriter } from './describe/Description';
import { defNamesOf } from './describe/codexNames';
import type { LocationTypeDef } from '../domain/generation/LocationTypeDef';
import type { ObjectDef } from '../domain/ObjectDef';
import type { Texts } from '../locale/Localization';
import { typeDisplayName } from '../locale/typeDisplayName';
import type { CodexSource } from './CodexSource';
import { EMPTY_HTML, escapeHtml, inlineArtHtml } from './html';

/**
 * 参照（識別子）の見せ方。データを書く人は識別子で、遊ぶ人と訳す人は表示名で読みたいので、
 * どちらで読むかを画面上で切り替えられるようにする。
 */
export type NamingMode = 'display' | 'identifier';

/**
 * 読み込んだ定義を人間向けのHTMLに変換する窓口。
 *
 * 定義の中身をどう言い表すかは定義自身（`describe`、domain/Description.ts）が知っているので、
 * ここが担うのは**見せ方**だけ——表示名を引く、リンクを張る、識別子と表示名を切り替える。
 */
export class CodexView {
  readonly source: CodexSource;
  private readonly namingMode: NamingMode;

  constructor(source: CodexSource, namingMode: NamingMode) {
    this.source = source;
    this.namingMode = namingMode;
  }

  private defNames: DefNames | undefined;

  get codex() {
    return this.source.codex;
  }

  get locale() {
    return this.source.locale;
  }

  // ------------------------------------------------------------------
  // 定義の引き当て
  // ------------------------------------------------------------------

  /**
   * 一覧に出すobject_defを、グローバルIDの順（＝宣言順）に返す。
   *
   * **製作中オブジェクト（RecipeSystem.md 1節）は含めない。** レシピから自動生成された型で、
   * 中身は完成品のrecipesの節にそのまま出ている——一覧に並べても、作りかけの姿という同じ物の
   * 別の顔が増えるだけで、読み手には重複にしか見えない。識別子で名指しすれば個別のページは開ける。
   */
  objectDefs(): readonly ObjectDef[] {
    const defs: ObjectDef[] = [];
    for (let globalId = 0; globalId < this.codex.objects.count; globalId++) {
      const def = this.codex.objects.tryGet(globalId);
      // 名前だけが登録されて定義が無いグローバルID（参照だけされた型）は飛ばす。
      if (def !== undefined && !this.codex.isGenerated(def)) defs.push(def);
    }
    return defs;
  }

  /** タグ（4.1節）を持つobject_defの識別子（宣言順）。一覧に出さない型は含まない（objectDefs参照）。 */
  objectsWithTag(tagName: string): readonly string[] {
    const tagId = this.codex.tagNames.tryGetId(tagName);
    if (tagId === undefined) return [];
    return this.objectDefs()
      .filter((def) => def.tags.includes(tagId))
      .map((def) => def.name);
  }

  /** objectNameの型がpropertyNameのプロパティを持つか。 */
  hasProperty(objectName: string, propertyName: string): boolean {
    const globalId = this.codex.propertyNames.tryGetId(propertyName);
    if (globalId === undefined) return false;
    return this.objectDef(objectName)?.tryGetPropertyDef(globalId) !== undefined;
  }

  objectDef(name: string): ObjectDef | undefined {
    const globalId = this.codex.objectNames.tryGetId(name);
    return globalId === undefined ? undefined : this.codex.objects.get(globalId);
  }

  /** 宣言されているobject_defのタグ（4.1節）を、宣言順（グローバルIDの順）に返す。 */
  tagNames(): readonly string[] {
    const names: string[] = [];
    for (let globalId = 0; globalId < this.codex.tagNames.count; globalId++)
      names.push(this.codex.tagNames.getName(globalId));
    return names;
  }

  /** propertyNameという名前のプロパティを持つobject_defの識別子（宣言順）。 */
  objectsWithProperty(propertyName: string): readonly string[] {
    const globalId = this.codex.propertyNames.tryGetId(propertyName);
    if (globalId === undefined) return [];
    return this.objectDefs()
      .filter((def) => def.tryGetPropertyDef(globalId) !== undefined)
      .map((def) => def.name);
  }

  /** slotNameという名前のスロットを持つobject_defの識別子（宣言順）。 */
  objectsWithSlot(slotName: string): readonly string[] {
    const globalId = this.codex.slotNames.tryGetId(slotName);
    if (globalId === undefined) return [];
    return this.objectDefs()
      .filter((def) => def.tryGetSlotDef(globalId) !== undefined)
      .map((def) => def.name);
  }

  // ------------------------------------------------------------------
  // 表示名（識別子表示モードでは識別子そのもの）
  // ------------------------------------------------------------------

  objectLabel(name: string): string {
    return this.label(name, this.objectDisplayName(name));
  }

  /**
   * 土地の型（TerrainGeneration.md 1節）は表示名をlocation_textsが持つ（object_textsではない）ため、
   * object_textsに宣言が無ければそちらを見る。宣言があればそちらが優先。
   */
  objectDisplayName(name: string): string {
    const declared = this.locale.object(name).displayName;
    if (declared !== name) return declared;

    // 生成された型（GameElementDefinition.md 3.5節）は自分のエントリを持てず、素の型の名前と
    // 軸ごとの書式から組み立てる。
    const def = this.objectDef(name);
    if (def !== undefined && this.codex.isGenerated(def))
      return typeDisplayName(this.codex, this.locale, def);

    const locationType = this.locationTypeOf(name);
    return locationType === undefined ? name : this.locale.location(locationType.name).displayName;
  }

  /** この型を実体とする土地の型。地形生成の定義を持たないCodexや、土地でない型ではundefined。 */
  locationTypeOf(objectName: string): LocationTypeDef | undefined {
    const globalId = this.codex.objectNames.tryGetId(objectName);
    if (globalId === undefined) return undefined;
    return this.codex.generation?.locationTypes.find((type) => type.objectDefGlobalId === globalId);
  }

  /**
   * プロパティの表示名。同じ名前でもobject_defごとに文字列を変えられる（Localization.md）ため、
   * 持ち主が分かっていればそれを使い、分からなければdefaultエントリだけで引く。
   */
  propertyLabel(objectName: string | undefined, propertyName: string): string {
    return this.label(propertyName, this.propertyTexts(objectName, propertyName).displayName);
  }

  /** 操作の表示名。オブジェクトのメンバーなので持ち主とセットで引く。 */
  interactionLabel(objectName: string, name: string): string {
    return this.label(name, this.interactionTexts(objectName, name).displayName);
  }

  interactionTexts(objectName: string, name: string): Texts {
    return this.locale.object(objectName).interaction(name);
  }

  slotLabel(name: string): string {
    return this.label(name, this.locale.slot(name).displayName);
  }

  symbolLabel(name: string): string {
    return this.label(name, this.locale.symbol(name).displayName);
  }

  propertyTagLabel(name: string): string {
    return this.label(name, this.locale.propertyTag(name).displayName);
  }

  /** 告げる出来事（9.8節のsignal）の文言。札の上に出るのと同じ言葉。 */
  signalLabel(name: string): string {
    return this.label(name, this.locale.signal(name));
  }

  /**
   * object_defのタグ（4.1節）。**ここは識別子をそのまま出す**——`tag_texts`（Localization.tag）は
   * 在るが、ビューアはタグを見出しではなく分類の鍵として並べるため、引き当てていない。
   */
  tagLabel(name: string): string {
    return name;
  }

  objectDescription(name: string): string | undefined {
    const declared = this.locale.object(name).description;
    if (declared !== undefined) return declared;
    const locationType = this.locationTypeOf(name);
    return locationType === undefined ? undefined : this.locale.location(locationType.name).description;
  }

  /**
   * 表示名が対応表に無いか。識別子がそのまま出ている状態を「未翻訳」とみなす目安で、
   * 翻訳の抜けを見つける手掛かりとして印を付けるためだけに使う。
   */
  isUntranslated(identifier: string, displayName: string): boolean {
    return identifier === displayName;
  }

  private propertyTexts(objectName: string | undefined, propertyName: string) {
    // 未登録の識別子でも窓口は必ず返り、defaultエントリ→識別子の順にフォールバックする
    // （Localization.md）。持ち主が分からないときは空文字を渡してdefaultだけを引く。
    return this.locale.object(objectName ?? '').prop(propertyName);
  }

  private label(identifier: string, displayName: string): string {
    return this.namingMode === 'identifier' ? identifier : displayName;
  }

  // ------------------------------------------------------------------
  // リンク
  // ------------------------------------------------------------------

  objectHref(name: string): string {
    return `#/object/${encodeURIComponent(name)}`;
  }

  /** タグの行き先はタグ別の一覧（1ページ）の中のその節。タグごとにページを分けない。 */
  tagHref(name: string): string {
    return `#/by-tag/${encodeURIComponent(name)}`;
  }

  slotHref(name: string): string {
    return `#/slot/${encodeURIComponent(name)}`;
  }

  propertyHref(objectName: string, propertyName: string): string {
    return `#/property/${encodeURIComponent(objectName)}/${encodeURIComponent(propertyName)}`;
  }

  /**
   * プロパティ参照のリンク先。持ち主が分かっていればそのページ、分からなければ同名のプロパティを
   * 持つobject_defを探し、1つなら直接、複数なら候補一覧へ向ける（実行時にどのインスタンスが
   * 相手になるかは、定義だけからは決まらないため）。
   */
  private propertyRefHref(objectName: string | undefined, propertyName: string): string | undefined {
    if (objectName !== undefined && this.hasProperty(objectName, propertyName))
      return this.propertyHref(objectName, propertyName);

    const candidates = this.objectsWithProperty(propertyName);
    if (candidates.length === 0) return undefined;
    if (candidates.length === 1) return this.propertyHref(candidates[0], propertyName);
    return `#/prop-candidates/${encodeURIComponent(propertyName)}`;
  }

  // ------------------------------------------------------------------
  // 説明（DescriptionToken/DescriptionLine）のHTML化
  // ------------------------------------------------------------------

  /**
   * 説明の断片1つをHTMLへ。selfObjectNameは`self`が指すobject_def（この説明を宣言している型）で、
   * `self.温度`のような参照のリンク先を決めるのに要る。
   */
  tokenHtml(token: DescriptionToken, selfObjectName: string | undefined): string {
    switch (token.kind) {
      case 'text':
        return escapeHtml(token.text);
      case 'object':
        // 型の参照には絵を添える。何が生まれるのか・何を使うのかは、名前より絵のほうが速い。
        return this.refHtml(
          'object',
          token.name,
          this.objectLabel(token.name),
          this.objectHref(token.name),
          inlineArtHtml(token.name),
        );
      case 'property': {
        const owner = token.root === undefined || token.root === 'self' ? selfObjectName : undefined;
        const prefix = token.root === undefined ? '' : `<span class="ref-root">${token.root}.</span>`;
        const label = this.propertyLabel(owner, token.name);
        return prefix + this.refHtml('property', token.name, label, this.propertyRefHref(owner, token.name));
      }
      case 'slot':
        return this.refHtml('slot', token.name, this.slotLabel(token.name), this.slotHref(token.name));
      case 'tag':
        return this.refHtml('tag', token.name, this.tagLabel(token.name), this.tagHref(token.name));
      case 'symbol':
        return this.refHtml('symbol', token.name, this.symbolLabel(token.name), undefined);
      case 'property_tag':
        return this.refHtml('property-tag', token.name, this.propertyTagLabel(token.name), undefined);
      case 'stage':
        return this.refHtml('stage', token.name, token.name, undefined);
      case 'action':
      case 'combination': {
        // 操作は宣言元の型のメンバー（Localization.md）。selfが指す型がその持ち主になる。
        const label =
          selfObjectName === undefined ? token.name : this.interactionLabel(selfObjectName, token.name);
        return this.refHtml(token.kind, token.name, label, undefined);
      }
      case 'reason':
        // 理由は識別子ではなく文言そのものが読みたい情報（Localization.md reason_texts節）。
        return this.refHtml('reason', token.name, this.locale.reason(token.name) ?? token.name, undefined);
      case 'signal':
        return this.refHtml('signal', token.name, this.signalLabel(token.name), undefined);
    }
  }

  tokensHtml(tokens: readonly DescriptionToken[], selfObjectName: string | undefined): string {
    return tokens.map((token) => this.tokenHtml(token, selfObjectName)).join('');
  }

  /** グローバルIDを識別子へ戻す窓口（describeが使う）。 */
  get names(): DefNames {
    this.defNames ??= defNamesOf(this.codex);
    return this.defNames;
  }

  /** 説明の行をリストへ。入れ子（pick候補・レシピの工程）は字下げで表す。 */
  linesHtml(lines: readonly DescriptionLine[], selfObjectName: string | undefined): string {
    if (lines.length === 0) return EMPTY_HTML;
    const items = lines
      .map((line) => `<li style="--depth:${line.depth}">${this.tokensHtml(line.tokens, selfObjectName)}</li>`)
      .join('');
    return `<ul class="description">${items}</ul>`;
  }

  /** 定義自身にwriterへ書かせ、その結果をリストへ（呼び出し側がwriterを持ち回らずに済む近道）。 */
  describeHtml(selfObjectName: string | undefined, describe: (out: DescriptionWriter) => void): string {
    const writer = new DescriptionWriter();
    describe(writer);
    return this.linesHtml(writer.toLines(), selfObjectName);
  }

  /**
   * 参照1つのHTML。識別子は常に吹き出し（title）へ残し、表示名で見ていても元の名前を辿れるようにする。
   * prefixは名前の前に置くHTML（型の絵など。リンクの内側に入れて、絵からも辿れるようにする）。
   */
  private refHtml(
    kind: string,
    identifier: string,
    label: string,
    href: string | undefined,
    prefix = '',
  ): string {
    const attributes = `class="ref ref-${kind}" title="${escapeHtml(identifier)}"`;
    const body = prefix + escapeHtml(label);
    return href === undefined
      ? `<span ${attributes}>${body}</span>`
      : `<a ${attributes} href="${href}">${body}</a>`;
  }
}
