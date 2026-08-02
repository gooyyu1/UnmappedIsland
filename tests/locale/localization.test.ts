import { readFileSync } from 'node:fs';
import { parseDocument, isMap, isScalar } from 'yaml';
import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import type { Localization } from '../../src/locale/Localization';
import { LOCALE_FILE, parseLocale } from '../../src/locale/Localization';
import { YamlLoadError } from '../../src/loader/YamlLoadError';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/** ゲーム本体に同梱される表示文字列ファイル（テストはリポジトリルートで実行される前提）。 */
const LOCALE_PATH = `public/${LOCALE_FILE}`;

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

  it('object_textsの節が無い・空のファイルでも読める', () => {
    expect(parseLocale('ja.yaml', '').object('coconut').displayName).toBe('coconut');
    expect(parseLocale('ja.yaml', 'ui:\n  ok: OK\n').object('coconut').displayName).toBe('coconut');
  });

  it('プロパティのタグの表示名を引ける（未登録なら識別子）', () => {
    const texts = parseLocale('ja.yaml', 'property_tag_texts:\n  nutrition:\n    display_name: 栄養\n');

    expect(texts.propertyTag('nutrition').displayName).toBe('栄養');
    expect(texts.propertyTag('health').displayName).toBe('health');
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

  it('カードに並ぶ発見物（item/fixture）はすべて表示名を持つ', () => {
    // 対応表に無いと識別子（thick_branch等）がそのままカードに出るため、UIに出る型には必須とする。
    const itemTag = codex.tagNames.getId('item');
    const fixtureTag = codex.tagNames.getId('fixture');

    for (let globalId = 0; globalId < codex.objects.count; globalId++) {
      const objectDef = codex.objects.get(globalId);
      if (!objectDef.tags.includes(itemTag) && !objectDef.tags.includes(fixtureTag)) continue;
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

  it('存在しない識別子のエントリを持たない（WorldCodexの改名時の取り残しを防ぐ）', () => {
    for (const name of declaredObjectNames())
      expect(codex.objectNames.tryGetId(name), `'${name}' はWorldCodexに存在しない識別子`).toBeDefined();

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
   * 対応表のobject_texts節に並ぶオブジェクト識別子（defaultを除く）。Localizationは引く側の口しか
   * 持たないため、ファイルを直接読む。
   */
  function declaredObjectNames(): string[] {
    const root = parseDocument(readFileSync(LOCALE_PATH, 'utf8')).contents;
    if (!isMap(root)) throw new Error('object_textsが見つかりません。');

    const section = root.get('object_texts', true);
    if (!isMap(section)) throw new Error('object_textsが見つかりません。');

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
