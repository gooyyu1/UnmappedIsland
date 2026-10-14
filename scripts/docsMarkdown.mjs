/**
 * 公開サイトの `/docs/` を描く markdown-it（`buildDocsSite.mjs` が使う）。**描画器と設定を持つのは
 * ここ1箇所**——文書が「サイトでどう読まれるか」を見る検査（`tests/docs/`）も同じものを通す。
 * 写すと、設定を変えたときに検査だけが古い読み方のまま緑になる。
 */
import hljs from 'highlight.js';
import MarkdownIt from 'markdown-it';
import { githubSlugs } from './githubSlugs.mjs';

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

/**
 * サイトに載る本文のHTML。
 *
 * @param {string} text Markdown
 * @returns {string}
 */
export function renderDocsMarkdown(text) {
  return markdown.render(text);
}

/**
 * サイトと同じ読み方で切ったトークン列（描画の手前）。
 *
 * @param {string} text Markdown
 * @returns {import('./docsMarkdown.d.mts').DocsToken[]}
 */
export function parseDocsMarkdown(text) {
  return markdown.parse(text, {});
}
