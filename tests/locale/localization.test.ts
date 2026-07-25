import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { LOCALE_FILE, Localization, parseLocale } from '../../src/locale/Localization';
import { YamlLoadError } from '../../src/loader/YamlLoadError';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/** ゲーム本体に同梱される表示文字列ファイル（テストはリポジトリルートで実行される前提）。 */
const LOCALE_PATH = `public/${LOCALE_FILE}`;

describe('Localization(表示文字列の対応表)', () => {
  it('識別子から表示文字列を引ける', () => {
    const locale = parseLocale('ja.yaml', 'object_defs:\n  coconut: ヤシの実\n');

    expect(locale.objectName('coconut')).toBe('ヤシの実');
  });

  it('未登録の識別子は識別子そのものを返す', () => {
    const locale = parseLocale('ja.yaml', 'object_defs:\n  coconut: ヤシの実\n');

    expect(locale.objectName('driftwood')).toBe('driftwood');
    expect(Localization.empty().objectName('coconut')).toBe('coconut');
  });

  it('object_defsの節が無い・空のファイルでも読める', () => {
    expect(parseLocale('ja.yaml', '').objectName('coconut')).toBe('coconut');
    expect(parseLocale('ja.yaml', 'ui:\n  ok: OK\n').objectName('coconut')).toBe('coconut');
  });

  it('表示文字列がスカラーでなければエラーになる', () => {
    expect(() => parseLocale('ja.yaml', 'object_defs:\n  coconut:\n    ja: ヤシの実\n')).toThrow(
      YamlLoadError,
    );
  });
});

describe('同梱の表示文字列ファイル', () => {
  let codex: WorldCodex;
  let locale: Localization;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
    locale = parseLocale(LOCALE_PATH, readFileSync(LOCALE_PATH, 'utf8'));
  });

  it('カードに並ぶ発見物（item/fixture）はすべて表示文字列を持つ', () => {
    // 対応表に無いと識別子（driftwood等）がそのままカードに出るため、UIに出る型には必須とする。
    const itemTag = codex.tagNames.getId('item');
    const fixtureTag = codex.tagNames.getId('fixture');

    for (let globalId = 0; globalId < codex.objects.count; globalId++) {
      const objectDef = codex.objects.get(globalId);
      if (!objectDef.tags.includes(itemTag) && !objectDef.tags.includes(fixtureTag)) continue;
      expect(locale.objectName(objectDef.name), `${objectDef.name} には表示文字列が必要`).not.toBe(
        objectDef.name,
      );
    }
  });

  it('存在しない識別子に対する表示文字列を持たない（WorldCodexの改名時の取り残しを防ぐ）', () => {
    for (const name of localizedObjectNames())
      expect(codex.objectNames.tryGetId(name), `'${name}' はWorldCodexに存在しない識別子`).toBeDefined();
  });

  /** 対応表のobject_defs節に並ぶ識別子。Localizationは引く側の口しか持たないため、ファイルから直接読む。 */
  function localizedObjectNames(): string[] {
    const text = readFileSync(LOCALE_PATH, 'utf8');
    const section = text.slice(text.indexOf('object_defs:'));
    return [...section.matchAll(/^ {2}(\w+):/gm)].map((match) => match[1]);
  }
});
