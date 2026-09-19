/**
 * Markdownの各行を、それを囲んでいるコードフェンスの言い分（開き際の ` ```yaml ` の `yaml`）ごと。
 * **囲まれていない行は `language` が null**で、フェンスの開き・閉じの行そのものはどちらでもないので
 * 落とす。**フェンスを追うのはここ1箇所**——外を読む側と中を読む側で数え方が割れると、同じ文書の
 * 同じ行が、片方では中・片方では外になる。
 *
 * **閉じるのは、開いたのと同じ長さ以上のバッククォートだけの行**（Markdownの規則）。長さを見ないと、
 * 囲みの中で例に挙げた ``` が外側の ```` を閉じたことになり、**例示の続きが本文として出てくる。**
 *
 * **`\r` は行に残さない。** 作業ツリーがCRLFのとき、行末の `\r` は `.` にも `$` にも一致しないので、
 * 行末を見る判定が**全部**空振りする（issue #867）。
 *
 * @param {string} markdown
 * @returns {{ line: number; raw: string; language: string | null }[]} 原文での行番号（1始まり）と、原文のままの行
 */
function linesWithFence(markdown) {
  /** @type {{ line: number; raw: string; language: string | null }[]} */
  const walked = [];
  /** 開いているフェンスのバッククォート。閉じているあいだは null。 */
  let fence = null;
  /** 開いているフェンスの言い分（無印の囲みなら空文字）。 */
  let language = '';
  markdown.split(/\r?\n/).forEach((raw, index) => {
    const marker = /^\s*(`{3,})\s*(\S*)/.exec(raw);
    if (fence === null) {
      if (marker !== null) {
        fence = marker[1];
        language = marker[2];
      } else walked.push({ line: index + 1, raw, language: null });
    } else if (marker !== null && marker[1].length >= fence.length && /^\s*`+\s*$/.test(raw)) {
      fence = null;
    } else walked.push({ line: index + 1, raw, language });
  });
  return walked;
}

/**
 * Markdownの、コードフェンスの外に在る行。
 *
 * 文書が**何を宣言しているか**を見る側（見出し・確定度の印と、その射程の本文）はここを読む。
 * フェンスの中に在る `#` や `【確定】` は規約が見せている書式そのもので、拾うと**書式を説明した
 * 文書が、印を持つ文書になる。**
 *
 * @param {string} markdown
 * @returns {{ line: number; raw: string }[]} 原文での行番号（1始まり）と、原文のままの行
 */
export function linesOutsideFence(markdown) {
  return linesWithFence(markdown)
    .filter(({ language }) => language === null)
    .map(({ line, raw }) => ({ line, raw }));
}

/**
 * Markdownの、その言い分を掲げたコードフェンスの中に在る行。
 *
 * 文書が**書き方の見本として見せている中身**を見る側はここを読む。言い分で絞るので、`bash` の囲みに
 * 出てくる同じ綴りは入らない。
 *
 * @param {string} markdown
 * @param {string} language フェンスの開き際の言い分（`yaml` など）
 * @returns {{ line: number; raw: string }[]} 原文での行番号（1始まり）と、原文のままの行
 */
export function linesInsideFence(markdown, language) {
  return linesWithFence(markdown)
    .filter((entry) => entry.language === language)
    .map(({ line, raw }) => ({ line, raw }));
}
