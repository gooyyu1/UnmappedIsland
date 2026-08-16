import { describe, expect, it } from 'vitest';
import { readZip, ZipReadError } from '../../src/assetPack/zip';
import { zipArchive } from '../support/zipArchive';

/** ZIPの読み取り（AssetPack.md 2節）。無圧縮とdeflateの両方、および読めない形を確かめる。 */
describe('ZIPの読み取り', () => {
  it('無圧縮のエントリをそのまま取り出す', async () => {
    const files = await readZip(zipArchive([{ name: 'objects/rock.png', content: 'PNGのつもり' }]));

    expect([...files.keys()]).toEqual(['objects/rock.png']);
    expect(new TextDecoder().decode(files.get('objects/rock.png'))).toBe('PNGのつもり');
  });

  it('deflateのエントリを展開する', async () => {
    const text = 'object_defs:\n  rock: {tags: [item]}\n'.repeat(20);
    const files = await readZip(
      zipArchive([{ name: 'world-codex/rock.yaml', content: text, deflate: true }]),
    );

    expect(new TextDecoder().decode(files.get('world-codex/rock.yaml'))).toBe(text);
  });

  it('複数のエントリを、圧縮方式が混ざっていても読める', async () => {
    const files = await readZip(
      zipArchive([
        { name: 'world-codex/a.yaml', content: 'a', deflate: true },
        { name: 'objects/b.png', content: new Uint8Array([1, 2, 3]) },
        { name: 'locale/ja.yaml', content: 'ja', deflate: true },
      ]),
    );

    expect([...files.keys()].sort()).toEqual(['locale/ja.yaml', 'objects/b.png', 'world-codex/a.yaml']);
    expect(files.get('objects/b.png')).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('ディレクトリの項目は在庫に入れない', async () => {
    const files = await readZip(
      zipArchive([
        { name: 'objects/', content: '' },
        { name: 'objects/c.png', content: 'x' },
      ]),
    );

    expect([...files.keys()]).toEqual(['objects/c.png']);
  });

  it('ZIPでないものはエラーになる', async () => {
    const notZip = new TextEncoder().encode('これはZIPではない').buffer as ArrayBuffer;

    await expect(readZip(notZip)).rejects.toThrow(ZipReadError);
  });
});
