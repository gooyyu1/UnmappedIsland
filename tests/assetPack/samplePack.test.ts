import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AssetPack } from '../../src/assetPack/AssetPack';
import { readZip } from '../../src/assetPack/zip';
import { loadWorldCodex } from '../../src/loader/loadWorldCodex';
import { loadLocalization } from '../../src/locale/Localization';
import { samplePackFiles } from '../../scripts/samplePackFiles.mjs';
import { SAMPLE_PACK_ZIP } from '../support/samplePack';

/**
 * 配布物として置いてあるサンプルアセットパック（`public/sample-pack.zip`）の検査。
 *
 * ZIPは中身が読めない形でコミットされているため、**元の`sample-pack/`と食い違っても差分に
 * 現れない**。固め直し忘れも、パックの置き方の規約（AssetPack.md 3節）を変えたときの取り残しも、
 * ここで落とす。
 *
 * 期待するバイト列は固める側（`scripts/samplePackFiles.mjs`）から引く。作業ツリーの改行は
 * 取り出し方で変わるので、ここでファイルを読み直すと、中身が合っていても環境によって落ちる。
 */
describe('サンプルアセットパック', () => {
  const zip = new Uint8Array(readFileSync(SAMPLE_PACK_ZIP));

  async function pack(): Promise<AssetPack> {
    return new AssetPack('sample-pack', await readZip(zip.buffer as ArrayBuffer));
  }

  it('ZIPの中身が sample-pack/ と一致する（固め直し忘れの検出）', async () => {
    const files = await readZip(zip.buffer as ArrayBuffer);
    const expected = samplePackFiles();

    expect([...files.keys()].sort()).toEqual(expected.map(({ name }) => name));
    for (const { name, content } of expected) expect(files.get(name), name).toEqual(content);
  });

  it('ZIPの中のテキストは改行がLFに揃っている（固めた環境でバイト列が変わらない）', async () => {
    // 正規化を外して固め直しても、LFの作業ツリーでは何も起きないので、期待値との突き合わせでは
    // 気付けない。コミットされたZIP自身を見れば、どの環境で検査しても同じ結果になる。
    const files = await readZip(zip.buffer as ArrayBuffer);

    for (const [name, content] of files)
      if (name.endsWith('.yaml')) expect(content.includes(0x0d), name).toBe(false);
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
