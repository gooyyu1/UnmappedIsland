import { readFileSync } from 'node:fs';
import { parseDocument, isMap, isScalar } from 'yaml';
import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import type { Localization } from '../../src/locale/Localization';
import { LOCALE_FILE, parseLocale } from '../../src/locale/Localization';
import { YamlLoadError } from '../../src/loader/YamlLoadError';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, WORLD_CODEX_DIR, worldCodexYamlPaths } from '../support/worldCodexFiles';

/** ゲーム本体に同梱される表示文字列ファイル（テストはリポジトリルートで実行される前提）。 */
const LOCALE_PATH = `public/${LOCALE_FILE}`;

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
 * WorldCodexのYAMLがconditionsに書いた理由（reason、14.6節）の識別子。ロード後のConditionNodeは
 * 木に畳まれていて列挙できないため、定義ファイルの字面から拾う。
 */
function declaredReasonNames(): readonly string[] {
  const found = new Set<string>();
  for (const path of worldCodexYamlPaths())
    for (const match of readFileSync(path, 'utf8').matchAll(/^\s*-?\s*reason:\s*([a-z][a-z0-9_]*)\s*$/gm))
      found.add(match[1]);
  return [...found];
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

describe('Localization(表示文字列の対応表)', () => {
  const locale = parseLocale(
    'ja.yaml',
    `
object_texts:
  default:
    display_name: 使われない名前
    props:
      exploration_progress:
        display_name: 探索の進み具合
        description: 共通の説明
    actions:
      eat:
        display_name: 食べる
    combinations:
      pour_in:
        display_name: 注ぎ移す
  coconut:
    display_name: ヤシの実
    description: 硬い殻に覆われた実。
    props:
      freshness:
        display_name: 鮮度
    actions:
      eat:
        display_name: かじる
        description: 殻を割って中身を食べる。
`,
  );

  it('オブジェクト自身のdisplay_nameとdescriptionを引ける', () => {
    expect(locale.object('coconut').displayName).toBe('ヤシの実');
    expect(locale.object('coconut').description).toBe('硬い殻に覆われた実。');
  });

  it('未登録のオブジェクトは識別子を表示名にし、説明は持たない', () => {
    expect(locale.object('thick_branch').displayName).toBe('thick_branch');
    expect(locale.object('thick_branch').description).toBeUndefined();
  });

  it('props・actions・combinationsの表示文字列を引ける', () => {
    expect(locale.object('coconut').prop('freshness').displayName).toBe('鮮度');
    expect(locale.object('coconut').action('eat').displayName).toBe('かじる');
    expect(locale.object('coconut').action('eat').description).toBe('殻を割って中身を食べる。');
    expect(locale.object('coconut').combination('pour_in').displayName).toBe('注ぎ移す');
  });

  it('オブジェクト側に定義が無いメンバーはdefaultエントリへフォールバックする', () => {
    const texts = locale.object('coconut').prop('exploration_progress');

    expect(texts.displayName).toBe('探索の進み具合');
    expect(texts.description).toBe('共通の説明');
    // オブジェクト自身が未登録でも、defaultのメンバーは引ける。
    expect(locale.object('sandy_beach').prop('exploration_progress').displayName).toBe('探索の進み具合');
  });

  it('オブジェクト側の定義はdefaultエントリより優先される', () => {
    expect(locale.object('coconut').action('eat').displayName).toBe('かじる');
    expect(locale.object('thick_branch').action('eat').displayName, 'defaultの側').toBe('食べる');
  });

  it('defaultエントリのdisplay_nameはオブジェクトの表示名には使われない', () => {
    expect(locale.object('thick_branch').displayName).toBe('thick_branch');
  });

  it('どこにも定義が無いメンバーは識別子を表示名にする', () => {
    expect(locale.object('coconut').prop('weight').displayName).toBe('weight');
    expect(locale.object('coconut').action('burn').displayName).toBe('burn');
    expect(locale.object('coconut').combination('mix').description).toBeUndefined();
  });

  it('中身がいるオブジェクトの名前は、{container}に自分の表示名・{content}に中身の名前が入る', () => {
    const texts = parseLocale(
      'ja.yaml',
      `object_texts:
  default:
    display_name_with_content: '{content}入りの{container}'
  canteen:
    display_name: 水筒
  jar:
    display_name: 甕
    display_name_with_content: '{container}（{content}）'
`,
    );

    expect(texts.object('canteen').displayNameWithContent('水'), 'defaultの書式').toBe('水入りの水筒');
    expect(texts.object('jar').displayNameWithContent('水'), '自分の書式が優先される').toBe('甕（水）');
  });

  it('書式が無ければ、中身がいても表示名のまま', () => {
    expect(locale.object('coconut').displayNameWithContent('水')).toBe('ヤシの実');
    expect(locale.object('thick_branch').displayNameWithContent('水'), '未登録なら識別子').toBe(
      'thick_branch',
    );
  });

  it('差し込んだ名前の中のプレースホルダは置換されない', () => {
    const texts = parseLocale(
      'ja.yaml',
      `object_texts:
  default:
    display_name_with_content: '{content}入りの{container}'
  canteen:
    display_name: '{content}筒'
`,
    );

    expect(texts.object('canteen').displayNameWithContent('水')).toBe('水入りの{content}筒');
  });

  it('object_textsの節が無い・空のファイルでも読める', () => {
    expect(parseLocale('ja.yaml', '').object('coconut').displayName).toBe('coconut');
    expect(parseLocale('ja.yaml', 'ui:\n  ok: OK\n').object('coconut').displayName).toBe('coconut');
  });

  it('操作を実行できない理由の文言を引ける（未登録ならundefined）', () => {
    const withReasons = parseLocale('ja.yaml', 'reason_texts:\n  too_heavy: 荷が重すぎる。\n');

    expect(withReasons.reason('too_heavy')).toBe('荷が重すぎる。');
    expect(withReasons.reason('unknown_reason'), '未登録なら理由を出さない').toBeUndefined();
  });

  it('告げられた出来事の文言を引ける（未登録なら識別子）', () => {
    const texts = parseLocale('ja.yaml', 'signal_texts:\n  missed: 空振り\n');

    expect(texts.signal('missed')).toBe('空振り');
    expect(texts.signal('dodged'), '未登録でも札の上には何か出す').toBe('dodged');
  });

  it('プロパティのタグの表示名を引ける（未登録なら識別子）', () => {
    const texts = parseLocale('ja.yaml', 'property_tag_texts:\n  nutrition:\n    display_name: 栄養\n');

    expect(texts.propertyTag('nutrition').displayName).toBe('栄養');
    expect(texts.propertyTag('health').displayName).toBe('health');
  });

  it('シンボル型プロパティの値の表示名を引ける（未登録なら識別子）', () => {
    const texts = parseLocale('ja.yaml', 'symbol_texts:\n  scorching:\n    display_name: 灼熱\n');

    expect(texts.symbol('scorching').displayName).toBe('灼熱');
    expect(texts.symbol('drizzle').displayName).toBe('drizzle');
  });

  it('表示文字列がスカラーでなければエラーになる', () => {
    expect(() =>
      parseLocale('ja.yaml', 'object_texts:\n  coconut:\n    display_name: {ja: ヤシの実}\n'),
    ).toThrow(YamlLoadError);
    expect(() => parseLocale('ja.yaml', 'object_texts:\n  coconut: ヤシの実\n')).toThrow(YamlLoadError);
  });
});

describe('同梱の表示文字列ファイル', () => {
  let codex: WorldCodex;
  let locale: Localization;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
    locale = parseLocale(LOCALE_PATH, readFileSync(LOCALE_PATH, 'utf8'));
  });

  it('カードに並ぶもの（item/fixture/injury）はすべて表示名を持つ', () => {
    // 対応表に無いと識別子（thick_branch等）がそのままカードに出るため、UIに出る型には必須とする。
    const carded = ['item', 'fixture', 'injury'].map((tag) => codex.tagNames.getId(tag));

    for (let globalId = 0; globalId < codex.objects.count; globalId++) {
      const objectDef = codex.objects.get(globalId);
      if (!carded.some((tag) => objectDef.tags.includes(tag))) continue;
      // 製作中オブジェクト（自動生成）は自分のエントリを持たず、完成品の名前と
      // default.display_name_in_progress から組み立てる（PlayScreenViewのnameOf）。
      if (codex.productOf(objectDef) !== undefined) continue;
      expect(locale.object(objectDef.name).displayName, `${objectDef.name} には表示名が必要`).not.toBe(
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
    for (const reasonName of declaredReasonNames())
      expect(locale.reason(reasonName), `reason '${reasonName}' には文言が必要`).toBeDefined();
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

  it('カードの名前は枠のタイトルの板に1行で収まる', () => {
    // 板は高さ22uの固定で、名前は16uの1行（CardView.md 1節 カードの枠）。使える幅172uに対して
    // 全角なら10文字ぶんにあたる。
    //
    // **幅はフォントを使わず近似で測る。** Nodeには文字の描画幅を測る手段が無く、そのために
    // フォントを依存に加えたくない。全角1.0・半角0.5で数えると、実測（Noto Sans JP）に対して
    // 常に大きめに出る——16uでの英字の平均は0.50字ぶんで、最も細い並び（illi…）は0.19字ぶん。
    // つまり**この検査を通れば実物は必ず収まる**。
    for (let globalId = 0; globalId < codex.objects.count; globalId++) {
      const name = codex.objects.get(globalId).name;
      const label = locale.object(name).displayName;
      expect(nameWidth(label), `'${label}' (${name}) はカードのタイトルに収まらない`).toBeLessThanOrEqual(
        NAME_MAX_WIDTH,
      );
    }
  });

  it('存在しない識別子のエントリを持たない（WorldCodexの改名時の取り残しを防ぐ）', () => {
    for (const name of declaredSectionKeys('object_texts'))
      expect(codex.objectNames.tryGetId(name), `'${name}' はWorldCodexに存在しない識別子`).toBeDefined();

    for (const name of declaredSectionKeys('symbol_texts'))
      expect(codex.symbolNames.tryGetId(name), `'${name}' はWorldCodexに存在しないシンボル`).toBeDefined();

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
    const root = parseDocument(readFileSync(LOCALE_PATH, 'utf8')).contents;
    if (!isMap(root)) throw new Error(`${sectionName}が見つかりません。`);

    const section = root.get(sectionName, true);
    if (!isMap(section)) throw new Error(`${sectionName}が見つかりません。`);

    return section.items
      .map((pair) => (isScalar(pair.key) ? String(pair.key.value) : ''))
      .filter((name) => name !== '' && name !== 'default');
  }

  /** 対応表のlocation_texts節に並ぶ「型の識別子 → 亜種の識別子の並び」（defaultを除く）。 */
  function declaredLocationNames(): Map<string, string[]> {
    const root = parseDocument(readFileSync(LOCALE_PATH, 'utf8')).contents;
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
