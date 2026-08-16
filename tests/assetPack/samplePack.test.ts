import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AssetPack } from '../../src/assetPack/AssetPack';
import { readZip } from '../../src/assetPack/zip';
import { loadWorldCodex } from '../../src/loader/loadWorldCodex';
import { loadLocalization } from '../../src/locale/Localization';
import { SAMPLE_PACK_DIR, SAMPLE_PACK_ZIP } from '../support/samplePack';

/**
 * 配布物として置いてあるサンプルアセットパック（`public/sample-pack.zip`）の検査。
 *
 * ZIPは中身が読めない形でコミットされているため、**元の`sample-pack/`と食い違っても差分に
 * 現れない**。固め直し忘れも、パックの置き方の規約（AssetPack.md 3節）を変えたときの取り残しも、
 * ここで落とす。
 */
describe('サンプルアセットパック', () => {
  const zip = new Uint8Array(readFileSync(SAMPLE_PACK_ZIP));

  async function pack(): Promise<AssetPack> {
    return new AssetPack('sample-pack', await readZip(zip.buffer as ArrayBuffer));
  }

  it('ZIPの中身が sample-pack/ と一致する（固め直し忘れの検出）', async () => {
    const files = await readZip(zip.buffer as ArrayBuffer);

    expect([...files.keys()].sort()).toEqual(sourceFiles().map(([name]) => name));
    for (const [name, content] of sourceFiles()) expect(files.get(name), name).toEqual(content);
  });

  it('定義・表示文字列・絵が、置き方の規約どおりの場所に入っている', async () => {
    const loaded = await pack();

    expect([...loaded.worldCodexTexts().keys()]).toEqual(['sample-pack:world-codex/potions.yaml']);
    expect(loaded.localeText('ja')).toContain('poison_potion');
    expect([...loaded.objectArt().keys()]).toEqual(['healing_potion', 'poison_potion']);
  });

  it('同梱ぶんへ重ねると、薬が型としても表示文字列としても足される', async () => {
    const loaded = await pack();

    const codex = loadWorldCodex(loaded);
    expect(codex.objectNames.tryGetId('poison_potion')).toBeDefined();
    expect(codex.objectNames.tryGetId('healing_potion')).toBeDefined();

    const locale = loadLocalization(loaded);
    expect(locale.object('poison_potion').displayName).toBe('毒薬');
    expect(locale.object('poison_potion').action('drink').displayName).toBe('あおる');
  });
});

/** `sample-pack/` 以下の全ファイル（ZIP内のパスと中身。パス順）。 */
function sourceFiles(): readonly [string, Uint8Array][] {
  return readdirSync(SAMPLE_PACK_DIR, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .map((path): [string, Uint8Array] => [
      relative(SAMPLE_PACK_DIR, path).split(sep).join('/'),
      new Uint8Array(readFileSync(path)),
    ])
    .sort(([a], [b]) => (a < b ? -1 : 1));
}
