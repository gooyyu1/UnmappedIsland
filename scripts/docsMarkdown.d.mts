/** markdown-it のトークンのうち、文書の検査が読む面。 */
export interface DocsToken {
  type: string;
  content: string;
  /** 原文での行の範囲（0始まり、終わりは含まない）。インラインの子には無い。 */
  map: [number, number] | null;
  children: DocsToken[] | null;
}

export function renderDocsMarkdown(text: string): string;
export function parseDocsMarkdown(text: string): DocsToken[];
