import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { promptBody } from '../../scripts/daemon/prompt-body.mjs';

/**
 * 周期の係が、諾否を受ける issue の本文へ置く**印**の検査
 * （[`board-design.md`](../../agent-ops/board-design.md) 2.17.2）。
 *
 * 答えを issue のチェックで受ける係は、前の周の1本が開いている間は何もせずに終わる。**その判定を
 * 題の綴りに乗せると、人が同じ語で始めた issue で黙る周が出る**ので、判定は係が自分で置いた印が
 * 持つ。印が届かなければ、係は次の周から自分の1本を見分けられない。
 *
 * 見るのは、印が**届く形で置かれているか**の2点。
 *
 * - **囲みの中に在る。** セッションへ渡るのは囲みの中身だけ（`scripts/daemon/prompt-body.mjs`）なので、
 *   説明の側に書いた印は係の手には**渡らない**。渡らない印は、書いていないのと同じ。
 * - **係ごとに違う。** 同じ綴りを2つの係が使うと、**互いの1本を自分のものと読んで、どちらも永久に
 *   黙る**。ひな形を写して係を足すと、いちばん起きやすい壊れ方がこれ。
 *
 * **綴りそのものはひな形が持つ**ので、ここへは書き写さない（写すと、綴りを変えるたびに両方の
 * 書き換えが要り、漏れたほうが黙って嘘になる）。
 */

const ROOT = resolve(__dirname, '../..');
const PROMPTS = join(ROOT, 'agent-ops', 'prompts');

/**
 * 印の行の形。**綴り（1つ目の組）だけを係から受け取る。**
 *
 * HTMLのコメントにしてあるのは、**ユーザーの画面へ出さないため**——諾否の issue はスマホから読まれる
 * ので、機械のための行が本文の頭に見えていると、答える手前に読むものが1行増える。
 */
const MARK = /<!-- 周期の係の印: ([A-Za-z0-9-]+)[^>]*-->/g;

/**
 * 印を持つ係のひな形。**ここに無いひな形が印を持っていたら落とす**——足した係が検査の外へ出ると、
 * 綴りが重なっていても誰も気づかない。
 */
const BALLOT_PROMPTS = ['policy-cycle-prompt.md', 'dig-prompt.md'] as const;

function read(file: string): string {
  return readFileSync(join(PROMPTS, file), 'utf-8');
}

/** その中身に現れる印の綴り。 */
function marksIn(markdown: string): string[] {
  return [...markdown.matchAll(MARK)].map((found) => found[1]);
}

/** ひな形のうち、セッションへ渡る側。 */
function bodyOf(file: string): string {
  const body = promptBody(read(file));
  if (body === null) throw new Error(`${file} に囲みが無い`);
  return body;
}

describe('諾否の issue に置く印', () => {
  it.each(BALLOT_PROMPTS)('%s の印は、1つの綴りで囲みの中に在る', (file) => {
    const all = marksIn(read(file));
    expect(all, '印が無い').not.toEqual([]);
    expect([...new Set(all)], '綴りが揃っていない').toHaveLength(1);
    expect(marksIn(bodyOf(file)), '囲みの外に在る印は、係の手に渡らない').toEqual(all);
  });

  it('係どうしで印の綴りが違う', () => {
    const spellings = BALLOT_PROMPTS.map((file) => marksIn(bodyOf(file))[0]);

    expect([...new Set(spellings)]).toHaveLength(spellings.length);
  });

  it('印を持つひな形は、上の一覧に載っている', () => {
    const marked = readdirSync(PROMPTS)
      .filter((file) => file.endsWith('-prompt.md'))
      .filter((file) => marksIn(read(file)).length > 0);

    expect([...marked].sort()).toEqual([...BALLOT_PROMPTS].sort());
  });
});
