/**
 * 節番号の参照の読み方（`docs/DocumentStyle.md` 5節）。
 *
 * **読む側は1つではない**——指し先が実在するかを見る `tests/docs/docReferences.test.ts` と、指した先に
 * その話が書いてあるかを読む [`refAudit.mjs`](daemon/refAudit.mjs) が同じ形を拾う。綴りを別々に持つと、
 * **片方だけが新しい形を知らないまま緑になる**（列挙の先頭側を数えないのがその形だった）。
 */

/** 1つの節番号（`2`・`2.16`・`2.13.1`）。 */
const NUMBER = String.raw`\d+(?:\.\d+)*`;

/** 範囲で指した並び（`2〜4`）。 */
const RANGE = String.raw`${NUMBER}(?:\s*[〜～]\s*${NUMBER})?`;

/**
 * 節番号の**並び**。1つの番号のほか、範囲（`2〜4`）と列挙（`2.15・2.16`）を1つの並びとして読む。
 *
 * **末尾の「節」は並び全体に掛かる**（`6・7節` = 6節と7節）ので、拾う側は先頭の番号も同じに扱う。
 * 番号ごとに「節」を書く形（`6節・7節`）も、並びが1つずつに分かれるだけで同じに読める。
 */
export const SECTION_RUN = String.raw`${RANGE}(?:\s*[・、]\s*${RANGE})*`;

/**
 * 並びが挙げている節番号。範囲は両端を返す（間の番号は挙げていない）。
 *
 * @param {string} run {@link SECTION_RUN} に当たった綴り
 * @returns {string[]} 節番号
 */
export function sectionNumbersIn(run) {
  return run
    .split(/[〜～・、]/)
    .map((number) => number.trim())
    .filter((number) => number !== '');
}
