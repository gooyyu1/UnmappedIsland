// ひな形（`agent-ops/prompts/*-prompt.md`）から、セッションへ渡す本体を取り出す。
//
//   node scripts/daemon/prompt-body.mjs <ひな形のパス>            本体を標準出力へ
//   node scripts/daemon/prompt-body.mjs <ひな形のパス> <節の名前>  その節の中の本体だけを見る
//
// 取り出せなければ何も出さない（**空かどうかで判定する側が居る**——`prompt-template.sh`）。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `## <節の名前> …` の見出しの行か。名前は `##` の後の最初の語。 */
function headsSection(line, section) {
  const found = /^##\s+(\S+)/.exec(line);
  return found !== null && found[1] === section;
}

/**
 * ひな形の中身から、本体として渡す囲みの中身を取り出す。
 *
 * **囲みの綴りはひな形が決める。** バッククォートだけを並べた行（3つ以上）が最初に現れたところが
 * 始まりで、同じ行が閉じる。中に ``` を含むひな形は ```` で囲めばよく、読む側は綴りを知らなくて
 * よい。**前置きのラベル付きの囲み（` ```bash ` など）は丸ごと読み飛ばす**——飛ばさないと、その
 * 閉じの行が本体の始まりに見え、**中身の違う本体が黙って渡る。**
 *
 * **本体の中のさらなる囲みは、本体の一部**（閉じで切るのは同じ綴りの行だけ）。
 *
 * **閉じないまま尽きた囲みは本体ではない。** そこまでを返すと、ひな形の閉じ忘れが**中身の違う
 * 本体**として、しかも空ではないので呼び手の関門（[`prompt-template.sh`](prompt-template.sh)）にも
 * 掛からずに渡る。
 *
 * **`section` を渡すと、その見出しより後だけを見る**（理由ごとに本文を持つひな形
 * [`resume-prompt.md`](../../agent-ops/prompts/resume-prompt.md) が在る）。見出しに当たるまでの
 * 囲みは、綴りに関わらず丸ごと読み飛ばす——前の節の本体の中に同じ形の行が在っても、節の見つけ方が
 * 変わらないようにする。**その節が囲みを持たないまま次の見出しに当たったら、そこで終わる**
 * ——続けると、**後ろの節の本文がその節のものとして黙って渡る。**
 *
 * **どこまでが本体かを決めるのはここ1つ。** 渡す本文として読む側
 * （[`prompt-template.sh`](prompt-template.sh)）と、名前で引ける節の範囲として読む側
 * （`tests/docs/docReferences.test.ts`）が同じものを本体と呼ぶ。別々に持つと、**渡る本文と、
 * 節を引ける範囲が黙ってずれる。**
 *
 * @param {string} markdown ひな形の中身
 * @param {string | null} [section] 読み始める節の名前。渡さなければひな形の先頭から
 * @returns {string | null} 本体の中身（囲みの行は含まない。各行が `\n` で終わる）。閉じた囲みが
 *   見つからなければ null
 */
export function promptBody(markdown, section = null) {
  /** @type {string[]} */
  const body = [];
  /** 本体の囲みの綴り。開くまでは null。 */
  let fence = null;
  /** 閉じの行に当たったか。 */
  let closed = false;
  /** 読み飛ばしている囲みの綴り。 */
  let skipping = null;
  /** まだ見つけていない節の名前。渡されていないか、見つけた後は null。 */
  let seeking = section;
  /** 節を渡されたか。見つけた後、次の見出しで終わるかの判定に要る。 */
  const bounded = section !== null;
  for (const line of markdown.split(/\r?\n/)) {
    if (fence !== null) {
      if (line === fence) {
        closed = true;
        break;
      }
      body.push(line);
    } else if (skipping !== null) {
      if (line === skipping) skipping = null;
    } else {
      const opened = /^`{3,}/.exec(line);
      if (opened !== null) {
        if (seeking !== null || opened[0] !== line) skipping = opened[0];
        else fence = line;
      } else if (seeking !== null) {
        if (headsSection(line, seeking)) seeking = null;
      } else if (bounded && /^##\s/.test(line)) {
        break;
      }
    }
  }
  return closed ? body.map((line) => `${line}\n`).join('') : null;
}

/**
 * そのひな形が**渡しうる本体すべて**。先頭の囲みと、`## <名前>` の節ごとの囲みを集める。
 *
 * **先頭の囲みだけでは足りない。** 理由ごとに本文を持つひな形
 * （[`resume-prompt.md`](../../agent-ops/prompts/resume-prompt.md)）は節を指定して読まれるので、
 * 先頭だけを本体と呼ぶと、**セッションへは渡るのに節としては引けない本文**ができる。
 *
 * 節を持たないひな形では先頭と節ごとの取り出しが同じものを返すので、重なりは畳む。
 *
 * @param {string} markdown ひな形の中身
 * @returns {string[]} 本体の中身。1つも無ければ空
 */
export function promptBodies(markdown) {
  const bodies = [promptBody(markdown)];
  for (const found of markdown.matchAll(/^##\s+(\S+)/gm)) bodies.push(promptBody(markdown, found[1]));
  return [...new Set(bodies)].filter((body) => body !== null);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [path, section] = process.argv.slice(2);
  if (path === undefined) {
    console.error('ひな形のパスを渡す');
    process.exit(2);
  }
  process.stdout.write(promptBody(readFileSync(path, 'utf-8'), section ?? null) ?? '');
}
