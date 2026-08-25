import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { documentedSections } from './generatedReport';

/**
 * 手書きの文書（`docs/diagnostics/*.md`）の「YAMLの節」の表を読む側の検査。
 *
 * **この解析だけが、生成物ではなく人が書いた文書を字面で読む。** 改行の違いで見出しに一致しないと
 * 節が0件になり、CRLFの作業ツリーでだけ赤くなる（Linuxのままでは気づけない）。`.prettierrc` の
 * `endOfLine: auto` が示すとおりCRLFは想定内の状態なので、そこで結果が変わらないことを見る。
 */
describe('手書きの文書の「YAMLの節」の表', () => {
  const DOC_DIR = join('docs', 'diagnostics');

  /** 表を持つ文書だけを対象にする（README のように表を持たない文書は、0件どうしの空振りになる）。 */
  const documents = readdirSync(DOC_DIR)
    .filter((name) => name.endsWith('.md'))
    .map((name) => ({ name, markdown: readFileSync(join(DOC_DIR, name), 'utf8').replace(/\r\n/g, '\n') }))
    .filter(({ markdown }) => documentedSections(markdown).all.length > 0);

  // 表の読み取りが丸ごと壊れると対象が0本になり、下の検査が何も見ないまま緑になる。レポート1本に
  // 読み方の文書が1本という対応そのものを見て、空振りを塞ぐ。
  it('表を持つ文書が、レポートの本数だけ在る', () => {
    const reports = readdirSync('stats').filter((name) => name.endsWith('.yaml'));

    expect(
      documents.map(({ name }) => name),
      `${DOC_DIR}の「YAMLの節」の表が読めない文書がある`,
    ).toHaveLength(reports.length);
  });

  it('CRLFの作業ツリーでも、同じ節を挙げる', () => {
    for (const { name, markdown } of documents) {
      expect(documentedSections(markdown.replace(/\n/g, '\r\n')), name).toEqual(documentedSections(markdown));
    }
  });
});
