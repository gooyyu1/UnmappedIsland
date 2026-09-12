import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import type { YamlRecord } from './generatedReport';
import { documentedSections, formatYamlReport, rounded } from './generatedReport';

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

/**
 * 生成物へ書き出す値が、グローバルIDを受け付けないことの検査。
 *
 * IDは世界を読み込むたびに振り直される番号なので、生成物に出ると**定義を1つ足しただけで無関係な行が
 * 全部動く**。それを止めているのは {@link YamlScalar} が素の数（`NotAGlobalId`）で受けていることだけ
 * ——`number` へ戻した瞬間に、下の `@ts-expect-error` が余って `npm run typecheck` が赤くなる。
 */
describe('生成物へ書き出す値', () => {
  it('グローバルIDを受け付けない', () => {
    const codex = new WorldCodexYamlLoader()
      .load('generatedReport.yaml', 'object_defs:\n  stone:\n    props:\n      weight: {value: 1}\n')
      .buildAndReset();
    const weightId = codex.propertyNames.getId('weight');

    // @ts-expect-error IDは生成物へ出さない。出したい値なら、書き出す手前で名前へ戻す。
    const record: YamlRecord = { property: weightId };
    // @ts-expect-error 丸めて通す道も同じく塞ぐ。
    rounded(weightId, 0);

    expect(formatYamlReport([], [{ key: 'properties', records: [record] }])).toContain('property');
  });
});
