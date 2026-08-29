import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `scripts/buildDocsSite.mjs`（`.github/workflows/pages.yml` が呼ぶ）が空を返していないかの検査。
 *
 * この道具が1枚も出さなくなっても、Pagesのワークフローは緑のまま通る——後続が索引ページを作り、
 * ゲームを載せて公開するので、**中身の無いサイトが公開される**。`npm test` から呼ばれていないと、
 * 誰も気づかない。
 *
 * 見るのは**`.md` の数だけ `.html` が出ること**だけで、中身の変換の正しさは見ない（見出しの
 * アンカーは `tests/docs/` の参照の検査と `githubSlugs` が見ている）。
 */

const ROOT = resolve(__dirname, '../..');

/** そのディレクトリ以下の、その拡張子のファイル数。道具の側と同じく大文字小文字を無視する。 */
function countFiles(dir: string, extension: string): number {
  return readdirSync(dir, { withFileTypes: true, recursive: true }).filter(
    (entry) => entry.isFile() && extname(entry.name).toLowerCase() === extension,
  ).length;
}

describe('docs/ のHTML化', () => {
  it('.md の数だけ .html が出る', () => {
    const work = mkdtempSync(join(tmpdir(), 'unmapped-island-docs-site-'));
    try {
      // 出力先を先に作る。1枚も出なかったときに、読めないディレクトリではなく0枚として出す。
      const site = join(work, 'site');
      mkdirSync(site, { recursive: true });
      const header = join(work, 'header.html');
      writeFileSync(header, '<style></style>\n', 'utf-8');

      execFileSync('node', [join(ROOT, 'scripts/buildDocsSite.mjs'), 'docs', site, header], {
        cwd: ROOT,
        encoding: 'utf-8',
      });

      const markdown = countFiles(join(ROOT, 'docs'), '.md');
      expect(markdown, 'docs/ に .md が1つも無い').toBeGreaterThan(0);
      expect(countFiles(site, '.html'), `docs/ の .md は ${markdown} 件`).toBe(markdown);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  /**
   * mermaidのブロックは表示するコードではなく図なので、クライアント側のmermaidが既定で拾う形
   * （`.mermaid`）で出す。mermaidは要素のinnerHTMLをエンティティ復号して図の定義として読むため、
   * 中身は素のままではなくエスケープされている必要がある。
   */
  it('mermaidのブロックは、コードブロックではなく.mermaidとして出る', () => {
    const work = mkdtempSync(join(tmpdir(), 'unmapped-island-docs-site-mermaid-'));
    try {
      const input = join(work, 'docs');
      mkdirSync(input, { recursive: true });
      writeFileSync(
        join(input, 'diagram.md'),
        ['```mermaid', 'flowchart TD', '  A["<入口>"] --> B', '```', ''].join('\n'),
        'utf-8',
      );
      const site = join(work, 'site');
      mkdirSync(site, { recursive: true });
      const header = join(work, 'header.html');
      writeFileSync(header, '<style></style>\n', 'utf-8');

      execFileSync('node', [join(ROOT, 'scripts/buildDocsSite.mjs'), input, site, header], {
        cwd: ROOT,
        encoding: 'utf-8',
      });

      const html = readFileSync(join(site, 'diagram.html'), 'utf-8');
      expect(html).toContain('<pre class="mermaid">');
      expect(html).not.toContain('language-mermaid');
      expect(html).toContain('A[&quot;&lt;入口&gt;&quot;] --&gt; B');
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});
