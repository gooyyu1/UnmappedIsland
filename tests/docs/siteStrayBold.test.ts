import { readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { specDocs, trackedFiles } from '../../scripts/docScope.mjs';
import { parseDocsMarkdown, type DocsToken } from '../../scripts/docsMarkdown.mjs';

/**
 * 公開サイトで、太字の `**` が文字のまま出る箇所が無いかの検査。
 *
 * 和文の `**……。**次の文` のように、**閉じの `**` の直前が約物で直後が文字**だと、CommonMark では
 * 閉じとして読まれない（左側の区切りにしかなれない）。開きの直前が文字で直後が約物（`は**「`）も
 * 同じで、開きになれない。**サイトと同じ描画器**（`docsMarkdown.mjs`）で読み、強調にならずに文字
 * として残った `**` を挙げる。直すなら約物を太字の外へ出す（`**……**。`・`「**……**」`）か、
 * 外側に約物を置く（`、**「……」**`）。
 */

const ROOT = resolve(__dirname, '../..');

/** 文字として残った `**` の在り処を、`<ファイル>:<段落の先頭行>` で。 */
function strayBold(rel: string): string[] {
  const found: string[] = [];
  const walk = (tokens: readonly DocsToken[], line: number | null): void => {
    for (const token of tokens) {
      const at = token.map === null ? line : token.map[0] + 1;
      // 地の文だけを見る。インラインのコードやコードブロックの中の `**` は文字であってよい。
      if (token.type === 'text' && token.content.includes('**')) {
        found.push(`${rel.split(sep).join('/')}:${at ?? '?'}: ${token.content.trim()}`);
      }
      if (token.children !== null) walk(token.children, at);
    }
  };
  walk(parseDocsMarkdown(readFileSync(join(ROOT, rel), 'utf-8')), null);
  return found;
}

describe('公開サイトの太字', () => {
  const docs = specDocs(ROOT).filter((rel) => rel.endsWith('.md'));

  it('文書が読めている', () => {
    // 射程が空になると、下の検査は何も見ないまま緑になる。
    expect(docs.length).toBeGreaterThan(0);
  });

  it('`**` が強調にならず文字のまま出る段落が無い', () => {
    expect(
      docs.flatMap(strayBold),
      '`**` が約物と文字に挟まれると区切りにならない。約物を太字の外へ出す（`**……**。`・`「**……**」`）',
    ).toEqual([]);
  });
});

/**
 * markdown-it を読み込む書き方。サイトの描画器が `docsMarkdown.mjs` の1箇所に在ることを、読み込み元で
 * 確かめる——別の場所が自前の markdown-it を持つと、そこだけ設定がずれ、上の検査はサイトと違う読み方の
 * まま緑になる。
 */
const IMPORTS_MARKDOWN_IT = /(?:from|import\(|require\()\s*['"]markdown-it['"]/;

describe('サイトの描画器の在り処', () => {
  it('markdown-it を読み込むのは `scripts/docsMarkdown.mjs` だけ', () => {
    const importers = ['*.ts', '*.mts', '*.cts', '*.js', '*.mjs', '*.cjs']
      .flatMap((pattern) => trackedFiles(ROOT, pattern))
      .filter((rel) => IMPORTS_MARKDOWN_IT.test(readFileSync(join(ROOT, rel), 'utf-8')))
      .map((rel) => rel.split(sep).join('/'));
    expect(importers, '描画器は `docsMarkdown.mjs` から引く（設定を写すと検査とサイトがずれる）').toEqual([
      'scripts/docsMarkdown.mjs',
    ]);
  });
});
