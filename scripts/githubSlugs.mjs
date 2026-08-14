/**
 * 見出しの並びから、GitHubと同じ規則でアンカーIDを順に割り当てる。
 *
 * 公開サイト（`scripts/buildDocsSite.mjs`）が実際に出力するIDと、ドキュメントの参照を検査する
 * `tests/docs/docReferences.test.ts` が期待するIDは一致していなければならないため、規則はここだけに置く。
 *
 * @param {readonly string[]} headings 見出しの本文（`#`とその後の空白を除いた、Markdownのままの文字列）
 * @returns {string[]} 入力と同じ並びのアンカーID
 */
export function githubSlugs(headings) {
  const seen = new Map();
  return headings.map((heading) => {
    const text = heading
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // リンクは表示名だけが残る
      .replace(/[`*]/g, '');
    const base = text
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\s-]/gu, '')
      .replace(/ /g, '-');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    // 同じ見出しが複数あるときの連番の付き方もGitHubに合わせる。
    return count === 0 ? base : `${base}-${count}`;
  });
}
