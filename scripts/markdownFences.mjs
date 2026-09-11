/**
 * Markdownの、コードフェンスの外に在る行。
 *
 * 文書が**何を宣言しているか**を見る側（見出し・確定度の印と、その射程の本文）はここを読む。
 * フェンスの中に在る `#` や `【確定】` は規約が見せている書式そのもので、拾うと**書式を説明した
 * 文書が、印を持つ文書になる。**
 *
 * **閉じるのは、開いたのと同じ長さ以上のバッククォートだけの行**（Markdownの規則）。長さを見ないと、
 * 囲みの中で例に挙げた ``` が外側の ```` を閉じたことになり、**例示の続きが本文として出てくる。**
 *
 * **改行を割るのはここだけで、`\r` は行に残さない。** 作業ツリーがCRLFのとき、行末の `\r` は
 * `.` にも `$` にも一致しないので、行末を見る判定が**全部**空振りする（issue #867）。
 *
 * @param {string} markdown
 * @returns {{ line: number; raw: string }[]} 原文での行番号（1始まり）と、原文のままの行
 */
export function linesOutsideFence(markdown) {
  /** @type {{ line: number; raw: string }[]} */
  const kept = [];
  /** 開いているフェンスのバッククォート。閉じているあいだは null。 */
  let fence = null;
  markdown.split(/\r?\n/).forEach((raw, index) => {
    const marker = /^\s*(`{3,})/.exec(raw);
    if (fence === null) {
      if (marker !== null) fence = marker[1];
      else kept.push({ line: index + 1, raw });
    } else if (marker !== null && marker[1].length >= fence.length && /^\s*`+\s*$/.test(raw)) {
      fence = null;
    }
  });
  return kept;
}
