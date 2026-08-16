import { describe, expect, it } from 'vitest';
import { AssetPack } from '../../src/assetPack/AssetPack';
import { readZip } from '../../src/assetPack/zip';
import { addPackArt } from '../../src/art/packArt';
import { loadWorldCodex } from '../../src/loader/loadWorldCodex';
import { YamlLoadError } from '../../src/loader/YamlLoadError';
import { loadLocalization } from '../../src/locale/Localization';
import { zipArchive } from '../support/zipArchive';
import type { ZipSource } from '../support/zipArchive';

/**
 * アセットパックの読み込み（AssetPack.md）。ZIPのトップが `src/assets/` に相当する形で
 * 定義YAML・表示文字列・絵を受け取り、同梱ぶんへ重ねられることを確かめる。
 */
async function pack(name: string, sources: readonly ZipSource[]): Promise<AssetPack> {
  return new AssetPack(name, await readZip(zipArchive(sources)));
}

const OBJECT_YAML = `
object_defs:
  driftwood_totem:
    tags: [item, fixture]
    props:
      weight: {value: 4000}
`;

describe('アセットパックの中身', () => {
  it('定義YAMLを、出所つきのファイル名で取り出せる', async () => {
    const loaded = await pack('sample', [{ name: 'world-codex/totem.yaml', content: OBJECT_YAML }]);

    expect([...loaded.worldCodexTexts().keys()]).toEqual(['sample:world-codex/totem.yaml']);
  });

  it('表示文字列は言語ごとに引ける（無ければundefined）', async () => {
    const loaded = await pack('sample', [{ name: 'locale/ja.yaml', content: 'object_texts: {}' }]);

    expect(loaded.localeText('ja')).toBe('object_texts: {}');
    expect(loaded.localeText('en')).toBeUndefined();
  });

  it('絵は同梱ぶんと同じ名前（拡張子を落としたファイル名）で並ぶ', async () => {
    const loaded = await pack('sample', [
      { name: 'objects/driftwood_totem.png', content: new Uint8Array([1]) },
      { name: 'backgrounds/driftwood_totem_fixtures_lane.png', content: new Uint8Array([2]) },
      { name: 'world-codex/totem.yaml', content: OBJECT_YAML },
    ]);

    expect([...loaded.objectArt().keys()]).toEqual(['driftwood_totem']);
    expect([...loaded.backgroundArt().keys()]).toEqual(['driftwood_totem_fixtures_lane']);
    // 実体はBlobのURLで、同じ絵を2度引いても1つのまま。
    expect(loaded.objectArt().get('driftwood_totem')).toBe(loaded.objectArt().get('driftwood_totem'));
  });
});

describe('アセットパックを重ねた読み込み', () => {
  it('パックの定義が同梱の定義に足される', async () => {
    const codex = loadWorldCodex(
      await pack('sample', [{ name: 'world-codex/totem.yaml', content: OBJECT_YAML }]),
    );

    expect(codex.objectNames.tryGetId('driftwood_totem')).toBeDefined();
    // 同梱ぶんはそのまま読める。
    expect(codex.objectNames.tryGetId('coconut')).toBeDefined();
  });

  it('同梱と同じ識別子を宣言したパックはエラーになる', async () => {
    const clash = await pack('sample', [
      { name: 'world-codex/clash.yaml', content: 'object_defs:\n  coconut: {tags: [item]}\n' },
    ]);

    expect(() => loadWorldCodex(clash)).toThrow(YamlLoadError);
  });

  it('パックの表示文字列が同梱の対応表に足される', async () => {
    const locale = loadLocalization(
      await pack('sample', [
        {
          name: 'locale/ja.yaml',
          content: 'object_texts:\n  driftwood_totem:\n    display_name: 流木の像\n',
        },
      ]),
    );

    expect(locale.object('driftwood_totem').displayName).toBe('流木の像');
    expect(locale.object('coconut').displayName).toBe('熟したヤシの実');
  });

  it('同梱と同じ識別子の表示文字列を持つパックはエラーになる', async () => {
    const clash = await pack('sample', [
      { name: 'locale/ja.yaml', content: 'object_texts:\n  coconut:\n    display_name: 別のヤシの実\n' },
    ]);

    expect(() => loadLocalization(clash)).toThrow(YamlLoadError);
  });

  it('パックを渡さなければ同梱ぶんだけを読む', () => {
    expect(loadWorldCodex(undefined).objectNames.tryGetId('driftwood_totem')).toBeUndefined();
  });
});

describe('絵の在庫表への重ね方', () => {
  it('同梱に無い絵は足される', () => {
    const catalog = new Map([['coconut', '/bundled/coconut.png']]);

    addPackArt(catalog, new Map([['driftwood_totem', 'blob:totem']]), 'sample', '型の絵');

    expect(catalog.get('driftwood_totem')).toBe('blob:totem');
    expect(catalog.get('coconut')).toBe('/bundled/coconut.png');
  });

  it('同じ名前の絵はエラーになる（後勝ちの上書きは持たない）', () => {
    const catalog = new Map([['coconut', '/bundled/coconut.png']]);

    expect(() => addPackArt(catalog, new Map([['coconut', 'blob:other']]), 'sample', '型の絵')).toThrow(
      /coconut/,
    );
  });
});
