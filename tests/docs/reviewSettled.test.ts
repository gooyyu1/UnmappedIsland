import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SETTLED_LIST, settledDeclarations } from '../../scripts/settledDeclarations.mjs';

/**
 * 棚卸しで今のままでよいと決めた宣言の一覧（[`review/settled.md`](../../review/settled.md)）が、
 * 今の `src/` を指しているかの検査。
 *
 * **この一覧が次の回の材料になるのは、印が採点する一覧へ載るから**（`review/README.md` 3節）。
 * 行が指す宣言が消えても、改名されても、**一覧はそのまま残って印だけが付かなくなる**——そこは
 * 誰も見ていないので、決着が渡らないまま次の回が同じ問いを立て直すことになる。
 *
 * 見るのは2つ。**行が指す宣言がちょうど1つ在って、そこに印が載っていること**と、**同じ宣言が同じ
 * 問いで2行に現れていないこと**（＝決着が渡らないまま再び挙がって、また決着したということ）。
 */

const ROOT = resolve(__dirname, '../..');

/** 出力は`src`の量に比例して伸びるので、既定の上限（1MB）には頼らない。 */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/** 印が載る面。**一覧を作る道具そのものを通す**——印の付け方を変えた日に、ここだけ緑で残らないように。 */
const INVENTORY: readonly {
  readonly file: string;
  readonly name: string;
  readonly settled?: readonly string[];
}[] = JSON.parse(
  execFileSync('node', [join(ROOT, 'scripts/declarationInventory.mjs'), '--json'], {
    cwd: ROOT,
    encoding: 'utf-8',
    maxBuffer: MAX_OUTPUT_BYTES,
  }),
);

const SETTLED = settledDeclarations(ROOT);

describe('棚卸しで決着した宣言の一覧', () => {
  it('挙げた宣言が今も在り、採点する一覧に印が載っている', () => {
    const broken = SETTLED.flatMap(({ question, file, name, line }) => {
      const found = INVENTORY.filter(
        (declaration) => declaration.file === file && declaration.name === name,
      );
      const where = `${SETTLED_LIST}:${line} ${file} の ${name}`;
      if (found.length === 0) return [`${where}（宣言が無い。改名か削除で決着が古びている）`];
      if (found.length > 1) return [`${where}（同じ名前が複数ある。所属まで書いても決まらない）`];
      return found[0].settled?.includes(question) === true
        ? []
        : [`${where}（一覧に ${question} の印が載っていない）`];
    });

    expect(
      broken,
      `決着した宣言が、次の回の材料に載っていない:\n${broken.join('\n')}`,
    ).toEqual([]);
  });

  it('同じ宣言を、同じ問いで2度決着させていない', () => {
    const seen = new Map<string, number>();
    const twice: string[] = [];
    for (const { question, file, name, line } of SETTLED) {
      const key = `${question}\t${file}\t${name}`;
      const first = seen.get(key);
      if (first === undefined) seen.set(key, line);
      else twice.push(`${SETTLED_LIST}:${line} ${file} の ${name}（${question}。${first} 行目と同じ）`);
    }

    expect(
      twice,
      '決着が渡らないまま、同じ宣言が次の回で再び挙がっている（片方を落として、渡らなかった理由を' +
        `その回の記録へ書く）:\n${twice.join('\n')}`,
    ).toEqual([]);
  });
});
