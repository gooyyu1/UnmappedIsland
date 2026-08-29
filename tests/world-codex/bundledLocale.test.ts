import { readFileSync } from 'node:fs';
import { parseDocument, isMap, isScalar, isSeq } from 'yaml';
import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { Localization } from '../../src/locale/Localization';
import { bundledLocaleText, LOCALE_FILE, parseLocale } from '../../src/locale/Localization';
import { UI_TEXT_NAMES } from '../../src/locale/uiTexts';
import { typeDisplayName } from '../../src/locale/typeDisplayName';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, WORLD_CODEX_DIR, worldCodexYamlPaths } from '../support/worldCodexFiles';

/**
 * 同梱の表示文字列（`ja.yaml`）が、同梱のWorldCodexと噛み合っているかの検査。
 *
 * **欠けても壊れない**——対応表に無い語は識別子のまま画面に出るだけなので、付け忘れも改名の
 * 取り残しもここでしか気付けない。対応表そのものの読み方は
 * tests/locale/localization.test.ts が受け持つ。
 */

/** カードのタイトルの板に収まる幅（全角の文字数ぶん。CardView.md 1節 カードの枠）。 */
const NAME_MAX_WIDTH = 10;

/**
 * 名前の幅を全角の文字数として近似する（半角は0.5、それ以外は1.0）。
 * 実測より大きめに出るので、これで収まれば実物も収まる。
 */
function nameWidth(label: string): number {
  return [...label].reduce((total, char) => total + (/[ -~｡-ﾟ]/.test(char) ? 0.5 : 1), 0);
}

/**
 * `reason`が書ける2箇所（GameElementDefinition.md 14.6節と9.3節）。**同じ綴りの別の名前空間**なので、
 * 引く先の対応表も別（`reason_texts` と `destroy_reason_texts`）。
 */
type ReasonNamespace = 'condition' | 'destroy';

/**
 * WorldCodexのYAMLが書いた理由（reason）の識別子を、名前空間ごとに集める。ロード後のConditionNodeも
 * 効果も木に畳まれていて列挙できないため、定義ファイルの構文木から拾う。
 *
 * **字面ではなく構文木を辿る。** 行の形で見分けると、同じ意味の`- {reason: x, ...}`と
 * `- reason: x`が別の扱いになり、書き方を変えただけで検査をすり抜ける。
 */
function declaredReasonNames(): ReadonlyMap<ReasonNamespace, ReadonlySet<string>> {
  const found = new Map<ReasonNamespace, Set<string>>([
    ['condition', new Set()],
    ['destroy', new Set()],
  ]);

  /** namespaceは、この節の直下に書かれた`reason`がどちらの名前空間に属するか（属さない位置ならundefined）。 */
  const walk = (node: unknown, namespace: ReasonNamespace | undefined): void => {
    if (isSeq(node)) {
      // conditionsもdestroyもリストで書けて、要素1つずつが同じ名前空間の`reason`を持つ。
      for (const item of node.items) walk(item, namespace);
      return;
    }
    if (!isMap(node)) return;

    for (const pair of node.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : '';
      if (key === 'reason' && isScalar(pair.value)) {
        expect(namespace, `'reason: ${String(pair.value.value)}' が想定外の位置にある`).toBeDefined();
        found.get(namespace!)!.add(String(pair.value.value));
        continue;
      }
      // 要件は`conditions`のほか、全レシピへ掛かる`crafting_conditions`（RecipeSystem.md 5節）にも書ける。
      const isConditions = key.endsWith('conditions');
      walk(pair.value, isConditions ? 'condition' : key === 'destroy' ? 'destroy' : undefined);
    }
  };

  for (const path of worldCodexYamlPaths())
    walk(parseDocument(readFileSync(path, 'utf8')).contents, undefined);
  return found;
}

/**
 * WorldCodexのYAMLが告げる出来事（signal、9.8節）の識別子。ロード後の効果は木に畳まれていて
 * 列挙できないため、理由（reason）と同じく定義ファイルの字面から拾う。
 */
function declaredSignalNames(): readonly string[] {
  const found = new Set<string>();
  for (const path of worldCodexYamlPaths())
    for (const match of readFileSync(path, 'utf8').matchAll(/^\s*-?\s*signal:\s*([a-z][a-z0-9_]*)\s*$/gm))
      found.add(match[1]);
  return [...found];
}

describe('同梱の表示文字列ファイル', () => {
  let codex: WorldCodex;
  let locale: Localization;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
    locale = parseLocale(LOCALE_FILE, bundledLocaleText());
  });

  it('カードに並ぶもの（item/fixture/injury）はすべて表示名を持つ', () => {
    // 対応表に無いと識別子（thick_branch等）がそのままカードに出るため、UIに出る型には必須とする。
    const carded = ['item', 'fixture', 'injury'].map((tag) => codex.tagNames.getId(tag));

    for (let globalId = 0; globalId < codex.objects.count; globalId++) {
      const objectDef = codex.objects.get(globalId);
      if (!carded.some((tag) => objectDef.tags.includes(tag))) continue;
      // 自動生成された型は自分のエントリを持たず、素の型の名前と書式から組み立てる（3.5節）。
      expect(typeDisplayName(codex, locale, objectDef), `${objectDef.name} には表示名が必要`).not.toBe(
        objectDef.name,
      );
    }
  });

  it('宣言されたプロパティタグはすべて表示名を持つ', () => {
    // タブ名として画面に出るため、欠けると識別子（nutrition等）がそのままタブに出る。
    for (let globalId = 0; globalId < codex.propertyTagNames.count; globalId++) {
      const name = codex.propertyTagNames.getName(globalId);
      expect(locale.propertyTag(name).displayName, `${name} には表示名が必要`).not.toBe(name);
    }
  });

  it('キャラクタのプロパティはすべてアイコンを持つ', () => {
    // ステータスの行の左に出る（StatusArea.md 3節）。どのプロパティも固定表示にすればそこへ並ぶので、
    // statusタグの有無では絞らない。欠けるとその行だけ絵ではなく名前になる。
    const characterTag = codex.tagNames.getId('character');

    for (let globalId = 0; globalId < codex.objects.count; globalId++) {
      const objectDef = codex.objects.get(globalId);
      if (!objectDef.tags.includes(characterTag)) continue;

      const texts = locale.object(objectDef.name);
      for (const propertyDef of objectDef.enumeratePropertyDefs())
        expect(
          texts.prop(propertyDef.name).icon,
          `${objectDef.name}の${propertyDef.name} にはアイコンが必要`,
        ).toBeDefined();
    }
  });

  it('宣言されたシンボル（天気・季節）はすべて表示名を持つ', () => {
    // 天気は状況エリアの空の窓に名前として出るため、欠けると識別子（scorching等）がそのまま出る。
    for (let globalId = 0; globalId < codex.symbolNames.count; globalId++) {
      const name = codex.symbolNames.getName(globalId);
      expect(locale.symbol(name).displayName, `${name} には表示名が必要`).not.toBe(name);
    }
  });

  it('天気の名前に、気温の暑さの語と気象庁の定義を持つ語を使わない', () => {
    // 天気が表すのは日射そのもの（＝原因）で、気温の暑さはそこから生まれる結果であり、別の
    // プロパティ（ambient_temperature）が持つ。また気温を決める値はいずれも仮の値なので、
    // 数値の定義を持つ名前は調整のたびに実態とずれる（ClimateSystem.md 4節）。
    const FORBIDDEN = ['暑', '夏日', '熱帯夜', '冬日'];
    for (const weather of ['storm', 'heavy_rain', 'light_rain', 'cloudy', 'clear', 'sunny', 'scorching']) {
      const name = locale.symbol(weather).displayName;
      for (const term of FORBIDDEN) expect(name.includes(term), `${weather}: '${name}'`).toBe(false);
    }
  });

  it('conditionsが宣言する理由（reason）はすべて文言を持つ', () => {
    // 欠けると、押せないアクションの吹き出しが「今はできない。」に落ちて理由が伝わらない
    // （GameElementDefinition.md 14.6節）。
    for (const reasonName of declaredReasonNames().get('condition')!)
      expect(locale.reason(reasonName), `reason '${reasonName}' には文言が必要`).toBeDefined();
  });

  it('destroyが名乗る消し方（reason）はすべて文言を持つ', () => {
    // 死亡ダイアログが死因として出す（VitalsSystem.md 6節）。欠けると識別子（dehydrated等）が
    // そのまま画面に出る。**段の対応表は見ない**——名前が揃っているのはたまたまで、揃っている
    // ことに意味は無い（9.3節）。
    for (const reasonName of declaredReasonNames().get('destroy')!)
      expect(locale.destroyReason(reasonName), `消し方 '${reasonName}' には文言が必要`).not.toBe(reasonName);
  });

  it('告げる出来事（signal）はすべて、札の上に収まる短い文言を持つ', () => {
    // 欠けると識別子（missed等）がそのまま札の上に出る。文字はカードの幅（205u）へ52uで置くので、
    // 全角4文字ぶんが収まる上限（CardView.md 14節）。
    const SIGNAL_MAX_WIDTH = 4;

    for (const signalName of declaredSignalNames()) {
      const label = locale.signal(signalName);
      expect(label, `signal '${signalName}' には文言が必要`).not.toBe(signalName);
      expect(nameWidth(label), `signal '${signalName}': '${label}' は札に収まらない`).toBeLessThanOrEqual(
        SIGNAL_MAX_WIDTH,
      );
    }
  });

  it('画面に出る段（stage_texts）は、カードの上に収まる短い文言を持つ', () => {
    // カードの覆いとして出る（CardView.md 9.1節）。長いと幅に合わせて縮み、大きく出て気付かせる
    // 効果が薄れるので、全角3文字ぶんを上限にする。
    const STAGE_MAX_WIDTH = 3;

    expect(locale.stage('unconscious'), '気絶は覆いを出す段（VitalsSystem.md 6節）').not.toBe('unconscious');

    for (const name of declaredSectionKeys('stage_texts')) {
      const label = locale.stage(name);
      expect(nameWidth(label), `stage '${name}': '${label}' はカードに収まらない`).toBeLessThanOrEqual(
        STAGE_MAX_WIDTH,
      );
    }
  });

  it('カードの名前は枠のタイトルの板に1行で収まる', () => {
    // 板は高さ22uの固定で、名前は16uの1行（CardView.md 1節 カードの枠）。使える幅172uに対して
    // 全角なら10文字ぶんにあたる。
    //
    // **幅はフォントを使わず近似で測る。** Nodeには文字の描画幅を測る手段が無く、そのために
    // フォントを依存に加えたくない。全角1.0・半角0.5で数えると、実測（Noto Sans JP）に対して
    // 常に大きめに出る——16uでの英字の平均は0.50字ぶんで、最も細い並び（illi…）は0.19字ぶん。
    // つまり**この検査を通れば実物は必ず収まる**。
    for (let globalId = 0; globalId < codex.objects.count; globalId++) {
      const def = codex.objects.get(globalId);
      const name = def.name;
      const label = typeDisplayName(codex, locale, def);
      expect(nameWidth(label), `'${label}' (${name}) はカードのタイトルに収まらない`).toBeLessThanOrEqual(
        NAME_MAX_WIDTH,
      );
    }
  });

  it('画面が名指しする地の文（ui_texts）と、対応表の中身が過不足なく一致する', () => {
    // 欠ければ名前（close等）がそのまま画面に出て、余っていれば誰も引かない語が残る。
    // どちらもコードとYAMLの片方だけを直したときにできるので、両向きで見る。
    const declared = declaredSectionKeys('ui_texts');
    expect(
      UI_TEXT_NAMES.filter((name) => !declared.includes(name)),
      '対応表に無い',
    ).toEqual([]);
    expect(
      declared.filter((name) => !(UI_TEXT_NAMES as readonly string[]).includes(name)),
      'コードが名指ししていない',
    ).toEqual([]);
  });

  it('存在しない識別子のエントリを持たない（WorldCodexの改名時の取り残しを防ぐ）', () => {
    for (const name of declaredSectionKeys('object_texts'))
      expect(codex.objectNames.tryGetId(name), `'${name}' はWorldCodexに存在しない識別子`).toBeDefined();

    for (const name of declaredSectionKeys('symbol_texts'))
      expect(codex.symbolNames.tryGetId(name), `'${name}' はWorldCodexに存在しないシンボル`).toBeDefined();

    const destroyReasons = declaredReasonNames().get('destroy')!;
    for (const name of declaredSectionKeys('destroy_reason_texts'))
      expect(destroyReasons.has(name), `'${name}' を名乗るdestroyはWorldCodexに無い`).toBe(true);

    const types = new Map(codex.generation!.locationTypes.map((type) => [type.name, type]));
    for (const [typeName, variantIds] of declaredLocationNames()) {
      const type = types.get(typeName);
      expect(type, `'${typeName}' は存在しないlocation_type`).toBeDefined();
      for (const variantId of variantIds)
        expect(
          type!.variants.map((v) => v.id),
          `'${typeName}' に存在しない亜種 '${variantId}'`,
        ).toContain(variantId);
    }
  });

  it('土地の型と亜種はすべて表示名を持つ', () => {
    // 欠けると識別子（sandy_beach、palm等）がそのままカードの名前になる。
    for (const type of codex.generation!.locationTypes) {
      expect(locale.location(type.name).displayName, `${type.name} には表示名が必要`).not.toBe(type.name);
      for (const variant of type.variants)
        expect(
          locale.location(type.name).variant(variant.id).displayName,
          `${type.name}の亜種 ${variant.id} には表示名が必要`,
        ).not.toBe(variant.id);
    }
  });

  it('土地の名前に位置が分かる語を出さない', () => {
    // 名前から島の形が割れないことの歯止め（TerrainGeneration.md 3.6節）。方角の語が
    // 亜種の名前へ紛れ込むのを防ぐ。
    const DIRECTIONS = ['東', '西', '南', '北'];
    for (const type of codex.generation!.locationTypes) {
      const texts = locale.location(type.name);
      const names = [texts.displayName, ...type.variants.map((v) => texts.variant(v.id).displayName)];
      for (const name of names)
        for (const direction of DIRECTIONS)
          expect(name.includes(direction), `${type.name}: '${name}'`).toBe(false);
    }
  });

  /**
   * 対応表の1つの節に並ぶ識別子（defaultを除く）。Localizationは引く側の口しか持たないため、
   * ファイルを直接読む。
   */
  function declaredSectionKeys(sectionName: string): string[] {
    const root = parseDocument(bundledLocaleText()).contents;
    if (!isMap(root)) throw new Error(`${sectionName}が見つかりません。`);

    const section = root.get(sectionName, true);
    if (!isMap(section)) throw new Error(`${sectionName}が見つかりません。`);

    return section.items
      .map((pair) => (isScalar(pair.key) ? String(pair.key.value) : ''))
      .filter((name) => name !== '' && name !== 'default');
  }

  /** 対応表のlocation_texts節に並ぶ「型の識別子 → 亜種の識別子の並び」（defaultを除く）。 */
  function declaredLocationNames(): Map<string, string[]> {
    const root = parseDocument(bundledLocaleText()).contents;
    if (!isMap(root)) throw new Error('location_textsが見つかりません。');

    const section = root.get('location_texts', true);
    if (!isMap(section)) throw new Error('location_textsが見つかりません。');

    const declared = new Map<string, string[]>();
    for (const pair of section.items) {
      const typeName = isScalar(pair.key) ? String(pair.key.value) : '';
      if (typeName === '' || typeName === 'default') continue;

      const variants = isMap(pair.value) ? pair.value.get('variants', true) : undefined;
      declared.set(
        typeName,
        isMap(variants)
          ? variants.items.map((v) => (isScalar(v.key) ? String(v.key.value) : '')).filter((id) => id !== '')
          : [],
      );
    }
    return declared;
  }
});
