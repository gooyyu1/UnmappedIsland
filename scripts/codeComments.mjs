/**
 * 行ごとに「その行がコメントか」を決める実装。**コメントの行を見る検査はここを通す**——検査ごとに
 * 規則を持つと、どの検査が何を見ているかが検査ごとに変わる。行頭の印を `startsWith` で見る写しが
 * 外に生えたら `tests/scripts/codeComments.test.ts` が落ちる。コードからコメントを字単位で剥がす側
 * （行の途中のコメントも落とす）は別の問いで、{@link withoutComments} が答える。
 *
 * 行ごとの、コメントの部分。**コメントでない行は `null`**。
 *
 * **見分けるのは行頭の印と、ブロックの内外だけ。** ブロックの外で行頭が `*` の行（ジェネレータの
 * 宣言 `*[Symbol.iterator]()`）はコードで、ブロックの中なら印の無い行も本文。行の途中から始まる
 * コメント（`const x = 1; // …`）は落とす——コードの側を読まずに `//` や `#` の位置を決めると、
 * 文字列・正規表現の中のそれを拾って**コードがコメントとして検査に入る**。落とすほうの代償は
 * 「見張られない場所が残る」だけで、赤くはならない。
 *
 * **`\r` は行に残す。** 返すのは原文の行（ブロックが閉じる行は `*` `/` の手前まで）。
 *
 * @param {string} source
 * @param {string} rel 拡張子を見るためのパス。JS・TSはブロックと行、それ以外は `#` の行。
 * @returns {(string | null)[]} 原文の行と同じ長さ
 */
export function commentParts(source, rel) {
  const blockLanguage = /\.[mc]?[jt]s$/.test(rel);
  const lineMarker = blockLanguage ? '//' : '#';
  let inBlock = false;
  return source.split('\n').map((raw) => {
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
    return trimmed.startsWith(lineMarker) ? raw : null;
  });
}

/**
 * ソースの、コメントだけを残した本文。落とした行は空行にして**行番号を原文と揃える**。
 *
 * コードの中のMarkdownリンクを検査する側が読む（`tests/docs/docReferences.test.ts`）。コードの
 * `](` は、**リンクではないものが字面で見分けられない**——正規表現のリテラル（`['"]([^'"]+)['"]`）・
 * ジェネレータの宣言（`*[Symbol.iterator]()`）・文字列に入れた例が同じ形で現れるので、
 * **コメントの中かどうか**で先に切る。
 *
 * @param {string} source
 * @param {string} rel {@link commentParts} と同じ
 * @returns {string} コメント以外を空行に置き換えた本文
 */
export function commentsOnly(source, rel) {
  return commentParts(source, rel)
    .map((part) => part ?? '')
    .join('\n');
}

/**
 * ソースからコメントを字単位で剥がした、コードの本文。**行の途中から始まるコメントも落とす**
 * ——{@link commentParts} とは問いが逆で、こちらは「コードとして何が書かれているか」を見る検査が読む。
 * **コードの本文を見る検査はここを通す**——剥がす範囲が検査ごとにずれると、同じ説明が検査によって
 * コードに数えられる。剥がす正規表現の写しが外に生えたら `tests/scripts/codeComments.test.ts` が落ちる。
 *
 * - JS・TS: ブロックと、`:` の直後以外の `//` から行末まで（`https://…` の `//` は残す）。
 * - それ以外: 行頭か空白に続く `#` から行末まで（`${#arr}`・`'#fff'` のように語へ続く `#` は残す）。
 *
 * **字面だけで切る**ので、文字列・正規表現の中の `//` や ` #` からも落とす。行番号は原文と揃える
 * （ブロックの中の改行は残す）。CRLF でも LF と同じだけ落ちる。
 *
 * @param {string} source
 * @param {string} rel {@link commentParts} と同じ
 * @returns {string} コメントを剥がした本文
 */
export function withoutComments(source, rel) {
  if (/\.[mc]?[jt]s$/.test(rel)) {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]+/g, ' '))
      .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
  }
  return source.replace(/(^|[ \t])#[^\n]*/gm, '$1');
}
