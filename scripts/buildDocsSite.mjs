/**
 * docs/以下のMarkdownをGitHub Pages用のHTMLへ変換する（`.github/workflows/pages.yml`が呼ぶ）。
 *
 * 見出しのアンカーIDはGitHubと同じ規則で付ける（{@link githubSlugs}）。ドキュメント同士のリンクは
 * Markdownのままなので、変換と同時に拡張子を差し替える。
 *
 * 使い方: node scripts/buildDocsSite.mjs <入力ディレクトリ> <出力ディレクトリ> <headタグへ差し込むHTML>
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';
import process from 'node:process';
import hljs from 'highlight.js';
import MarkdownIt from 'markdown-it';
import { githubSlugs } from './githubSlugs.mjs';

/** 本文のスタイル。索引ページ（pages.yml）と同じものを使う。 */
const MARKDOWN_CSS = 'https://cdn.jsdelivr.net/npm/github-markdown-css@5/github-markdown-dark.min.css';
/** コードブロックの配色。GitHubの暗いテーマと同じ見た目にする。 */
const HIGHLIGHT_CSS = 'https://cdn.jsdelivr.net/npm/highlight.js@11/styles/github-dark.min.css';

const markdown = MarkdownIt({
  html: true,
  highlight(code, language) {
    // mermaidは表示するコードではなく図。ページ側のmermaidが既定で拾うセレクタ（.mermaid）で出す。
    // mermaidは要素のinnerHTMLをエンティティ復号して定義として読むので、中身はエスケープしておく。
    if (language === 'mermaid') return `<pre class="mermaid">${markdown.utils.escapeHtml(code)}</pre>`;
    if (language === '' || !hljs.getLanguage(language)) return '';
    return `<pre class="hljs"><code>${hljs.highlight(code, { language }).value}</code></pre>`;
  },
});

/**
 * 見出しへアンカーIDを付ける。IDは文書全体の見出しの並びから決まる（同じ見出しが複数あると連番が
 * 付く）ため、1つずつではなく文書単位で先に割り当てる。
 */
markdown.core.ruler.push('github_anchors', (state) => {
  const openings = [];
  for (let i = 0; i < state.tokens.length; i++) if (state.tokens[i].type === 'heading_open') openings.push(i);

  // heading_openの次のトークンが、その見出しの本文（Markdownのまま）。
  const slugs = githubSlugs(openings.map((i) => state.tokens[i + 1].content));
  openings.forEach((tokenIndex, index) => state.tokens[tokenIndex].attrSet('id', slugs[index]));
});

/**
 * ドキュメント同士のリンクを、変換後のHTMLへ向け直す。`:`を含むもの（http(s):・mailto:）は外部の
 * リンクなので触らない。
 */
markdown.core.ruler.push('md_links_to_html', (state) => {
  for (const token of state.tokens) {
    for (const child of token.children ?? []) {
      if (child.type !== 'link_open') continue;
      const href = child.attrGet('href');
      if (href === null || href.includes(':')) continue;
      child.attrSet('href', href.replace(/\.md(#|$)/, '.html$1'));
    }
  }
});

function page(title, body, header) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes" />
<title>${title}</title>
<link rel="stylesheet" href="${MARKDOWN_CSS}" />
<link rel="stylesheet" href="${HIGHLIGHT_CSS}" />
${header}</head>
<body>
<article class="markdown-body" style="max-width:900px;margin:2rem auto;padding:1rem 2rem;box-sizing:border-box">
${body}</article>
</body>
</html>
`;
}

function markdownFilesIn(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true, recursive: true }))
    if (entry.isFile() && extname(entry.name).toLowerCase() === '.md')
      found.push(join(entry.parentPath, entry.name));
  return found.sort();
}

const [inputDir, outputDir, headerPath] = process.argv.slice(2);
if (inputDir === undefined || outputDir === undefined || headerPath === undefined) {
  console.error(
    '使い方: node scripts/buildDocsSite.mjs <入力ディレクトリ> <出力ディレクトリ> <headへ差し込むHTML>',
  );
  process.exit(1);
}

const header = readFileSync(headerPath, 'utf8');
for (const path of markdownFilesIn(inputDir)) {
  const outPath = join(outputDir, relative(inputDir, path).replace(/\.md$/, '.html'));
  mkdirSync(dirname(outPath), { recursive: true });
  const body = markdown.render(readFileSync(path, 'utf8'));
  writeFileSync(outPath, page(basename(outPath, '.html'), body, header), 'utf8');
  console.log(`Generated: ${outPath}`);
}
