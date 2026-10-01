/**
 * docs/以下のMarkdownをGitHub Pages用のHTMLへ変換する（`.github/workflows/pages.yml`が呼ぶ）。
 *
 * 本文の描き方（見出しのアンカー・文書間リンクの向け直し）は `docsMarkdown.mjs` が持つ。
 *
 * 使い方: node scripts/buildDocsSite.mjs <入力ディレクトリ> <出力ディレクトリ> <headタグへ差し込むHTML>
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';
import process from 'node:process';
import { renderDocsMarkdown } from './docsMarkdown.mjs';

/** 本文のスタイル。索引ページ（pages.yml）と同じものを使う。 */
const MARKDOWN_CSS = 'https://cdn.jsdelivr.net/npm/github-markdown-css@5/github-markdown-dark.min.css';
/** コードブロックの配色。GitHubの暗いテーマと同じ見た目にする。 */
const HIGHLIGHT_CSS = 'https://cdn.jsdelivr.net/npm/highlight.js@11/styles/github-dark.min.css';

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
  const body = renderDocsMarkdown(readFileSync(path, 'utf8'));
  writeFileSync(outPath, page(basename(outPath, '.html'), body, header), 'utf8');
  console.log(`Generated: ${outPath}`);
}
