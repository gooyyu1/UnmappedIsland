// ひな形（`.claude/*-prompt.md`）から、セッションへ渡す本体を取り出す。
//
//   node scripts/agent/prompt-body.mjs <ひな形のパス>   本体を標準出力へ（囲みが無ければ何も出さない）

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
 * **どこまでが本体かを決めるのはここ1つ。** 渡す本文として読む側
 * （[`prompt-template.sh`](prompt-template.sh)）と、名前で引ける節の範囲として読む側
 * （`tests/docs/docReferences.test.ts`）が同じものを本体と呼ぶ。別々に持つと、**渡る本文と、
 * 節を引ける範囲が黙ってずれる。**
 *
 * @param {string} markdown ひな形の中身
 * @returns {string | null} 本体の中身（囲みの行は含まない。各行が `\n` で終わる）。囲みが無ければ null
 */
export function promptBody(markdown) {
  /** @type {string[]} */
  const body = [];
  /** 本体の囲みの綴り。開くまでは null。 */
  let fence = null;
  /** 読み飛ばしているラベル付きの囲みの綴り。 */
  let skipping = null;
  for (const line of markdown.split(/\r?\n/)) {
    if (fence !== null) {
      if (line === fence) break;
      body.push(line);
    } else if (skipping !== null) {
      if (line === skipping) skipping = null;
    } else if (/^`{3,}$/.test(line)) {
      fence = line;
    } else {
      const labeled = /^`{3,}/.exec(line);
      if (labeled !== null) skipping = labeled[0];
    }
  }
  return fence === null ? null : body.map((line) => `${line}\n`).join('');
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = process.argv[2];
  if (path === undefined) {
    console.error('ひな形のパスを渡す');
    process.exit(2);
  }
  process.stdout.write(promptBody(readFileSync(path, 'utf-8')) ?? '');
}
