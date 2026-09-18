/**
 * Markdownリンクの指し先の読み方（docs/DocumentStyle.md 5節）。
 *
 * 参照が実在するかを見る側（`tests/docs/docReferences.test.ts`）と、指し先を書き換える側
 * （[`prompt-body.mjs`](daemon/prompt-body.mjs)）が、**同じ1つで「指し先か、書式の例示か」を決める**
 * ——別々に持つと、片方だけが `<パス>` のようなプレースホルダを実在のパスとして扱う。
 */

import { posix } from 'node:path';

/**
 * リンクの指し先が、**指し先として読める形**か（docs/DocumentStyle.md 5節）。読めないものは、
 * 実在のパスではなく**書式そのもの**を見せている（`docStatsCitations` が出どころの書式を
 * `<ファイル>` と書くのと同じ規約）。
 *
 * **外す形を数え上げず、読める形のほうを書く。** 外すものを挙げていくと、次に生えた例示の形が
 * 漏れて**例示が赤くなる**——コードのコメントは正規表現（`['"]([^'"]+)['"]`）も省略の `…` も
 * そのまま引くので、形は増え続ける。ASCIIのパスの字だけでできていて、点だけではないものが
 * 指し先で、それ以外は全部例示。**非ASCIIを入れない**のは、省略の `…` がそこに居るため——
 * 日本語のファイル名を足すなら、`…` を外す手を別に持つことになる。
 *
 * **判定が要るのはリンクだけ。** 節番号・節名の参照は `文書名.md N節` のように書けば
 * 参照の検査の `tokenPattern` が最初から拾わない（ファイル名の先頭に `[A-Za-z]` を要求している）が、
 * リンクの指し先は何が入っていても形が崩れないので、ここで外す。
 *
 * **囲み（インラインコード・コードフェンス）は、どちらの側でも逃げ道にならない。**
 *
 * @param {string} target リンクの `](…)` の中身（アンカーを除いたパスの部分）
 * @returns {boolean}
 */
export function isPathTarget(target) {
  return /^[A-Za-z0-9._~%/-]+$/.test(target) && !/^\.+$/.test(target);
}

/**
 * Markdownリンクの `](<指し先>#<アンカー>)`。**リンクを拾う側は、みなこれを通る**——形を別々に
 * 持つと、拾える形が片方でだけ動く。
 *
 * **呼ぶたびに作る。** `g` の付いた正規表現は `lastIndex` を持つので、使い回すと拾う側どうしが
 * 互いの読み終えた位置から読み始める。
 */
function linkPattern() {
  return /\]\(([^)\s]*?)(#[^)\s]*)?\)/g;
}

/**
 * その Markdown に在るリンクの、指し先とアンカー。**アンカーだけのリンクは指し先が空**で返る
 * （その文書の中を指しているので、指し先を持たない）。
 *
 * @param {string} markdown
 * @returns {{ file: string; anchor: string | null }[]} アンカーは `#` を落とした中身
 */
export function linksIn(markdown) {
  return [...markdown.matchAll(linkPattern())].map(([, file, anchor]) => ({
    file,
    anchor: anchor === undefined ? null : anchor.slice(1),
  }));
}

/**
 * その Markdown に在る、{@link isPathTarget 指し先として読める}リンクの指し先。アンカーは落とす。
 *
 * @param {string} markdown
 * @returns {string[]}
 */
export function pathTargetsIn(markdown) {
  return linksIn(markdown)
    .map(({ file }) => file)
    .filter(isPathTarget);
}

/**
 * Markdownの中の相対リンクを、**リポジトリ直下からの相対へ付け替える。**
 *
 * 付け替えるのは{@link isPathTarget 指し先として読める形}だけ。URL・アンカーだけのリンク・
 * 書式の例示（`<パス>`）はそのまま返す——実在のパスを指していないので、起点を持たない。
 *
 * @param {string} markdown 付け替える前のMarkdown
 * @param {string} dirFromRepoRoot 今の起点。リポジトリ直下からの相対で、区切りは `/`
 * @returns {string} 指し先を付け替えたMarkdown
 */
export function linksRebasedToRepoRoot(markdown, dirFromRepoRoot) {
  return markdown.replace(linkPattern(), (whole, file, anchor) => {
    if (!isPathTarget(file)) return whole;
    return `](${posix.join(dirFromRepoRoot, file)}${anchor ?? ''})`;
  });
}
