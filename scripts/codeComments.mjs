/**
 * ソースの、コメントだけを残した本文。落とした行は空行にして**行番号を原文と揃える**。
 *
 * コードの中のMarkdownリンクを検査する側が読む（`tests/docs/docReferences.test.ts`）。コードの
 * `](` は、**リンクではないものが字面で見分けられない**——正規表現のリテラル（`['"]([^'"]+)['"]`）・
 * ジェネレータの宣言（`*[Symbol.iterator]()`）・文字列に入れた例が同じ形で現れるので、
 * **コメントの中かどうか**で先に切る。
 *
 * **見分けるのは行頭の印だけ。** 行の途中から始まるコメント（`const x = 1; // …`）は落とす
 * ——コードの側を読まずに `//` や `#` の位置を決めると、文字列・正規表現の中のそれを拾って
 * **コードがコメントとして検査に入る**（リンクではない `](` が赤くなる）。落とすほうの代償は
 * 「見張られない場所が残る」だけで、赤くはならない。
 *
 * **`\r` は行に残す。** 返すのは原文の行そのもので、リンクの指し先（`[^)\s]+`）は `\r` を含まない。
 *
 * @param {string} source
 * @param {string} rel 拡張子を見るためのパス。JS・TSはブロックと行、それ以外は `#` の行。
 * @returns {string} コメント以外を空行に置き換えた本文
 */
export function commentsOnly(source, rel) {
  const blockLanguage = /\.[mc]?[jt]s$/.test(rel);
  const lineMarker = blockLanguage ? '//' : '#';
  let inBlock = false;
  return source
    .split('\n')
    .map((raw) => {
      const trimmed = raw.trim();
      if (inBlock) {
        const end = raw.indexOf('*/');
        if (end < 0) return raw;
        inBlock = false;
        return raw.slice(0, end);
      }
      if (blockLanguage && trimmed.startsWith('/*')) {
        const end = raw.indexOf('*/', raw.indexOf('/*') + 2);
        inBlock = end < 0;
        return inBlock ? raw : raw.slice(0, end);
      }
      return trimmed.startsWith(lineMarker) ? raw : '';
    })
    .join('\n');
}
