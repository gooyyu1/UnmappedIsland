import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../support/sourceFiles';

/**
 * 字面の差し替えの書き方の検査。
 *
 * **改行を含む字面リテラルで差し替えると、作業ツリーの改行コードに結果が依る。** 読んだファイルの
 * 改行は CRLF の作業ツリー——`.prettierrc` の `endOfLine: auto` が想定している状態（CLAUDE.md）——では
 * `\r\n` なので、`\n` を含む字面はどこにも当たらない。`String.replace` は当たらなくても投げずに
 * 元の文字列を返すため、**差し替えたつもりの入力が元のまま渡る。**
 *
 * **この破れは Linux では観測できない**（CI は LF なので通る）。踏むのは Windows の作業ツリーだけで、
 * しかも試験は「主張を破った入力」ではなく健全な入力を見たまま落ちるので、赤の理由も読めない
 * （issue #2125）。字面で見張る以外に、書いた時点で気づく手立てが無い。
 *
 * **見るのは追跡されている TypeScript・JavaScript のソースすべて。** 置き場で絞らないのは、絞った
 * 一覧が置き場の増減に追いつかず、**射程の外に居るものを誰も数えないまま**になるため
 * （`vite.config.ts` や `.github/` の下は、置き場を並べる書き方では入らなかった）。追跡されて
 * いないもの（生成物・他セッションの作業ツリー）は、この規約の宛先ではないので入らない。
 *
 * **取りこぼすのは2種類。** 改行を含まない差し替え——それは作業ツリーの改行コードに依らないので、
 * 当たった数を確かめる規則（`docs/CodingConventions.md`）だけが掛かる——と、字面リテラルの形で
 * 書かれていない差し替え（`'a' + '\n'` のように組み立てたもの、変数に入れてから渡したもの）。
 * 見えている形から倒す。
 */

/** 改行コードに依らない差し替えの入口（試験）。 */
const DOOR = 'tests/support/textEdit.ts';

/** TypeScript・JavaScript のソース。`.mjs`（`scripts`・`.claude`）と `.mts` も拾う。 */
const SOURCE = /\.[cm]?[jt]sx?$/;

/**
 * 置き場で絞っていないことの的。**これが挙がらなくなったら、射程が置き場の一覧へ戻っている**
 * ——`tests` の下から見える置き場だけを数える形では、ここに届かない。
 */
const OUTSIDE_EVERY_SOURCE_DIRECTORY = 'vite.config.ts';

/**
 * `replace`/`replaceAll` の第1引数の字面リテラル。引数が行をまたいで折れても当たるよう、字間は
 * `\s*` で受ける。正規表現リテラルを渡している呼び出しは、`\r?\n` で改行を受けられるので当たらない。
 */
const EDIT_WITH_LITERAL = /\.replace(?:All)?\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

/** 追跡されているソース（リポジトリ相対・`/`区切り）。 */
function trackedSources(): readonly string[] {
  const listed = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf-8' });
  return listed.split('\n').filter((rel) => SOURCE.test(rel));
}

const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf-8');

/**
 * 字面リテラルの中身が改行を含むか。
 *
 * 実際の改行（テンプレートリテラル）と、`\n` のエスケープの両方を見る。**円記号そのものを
 * エスケープした `\\n` は改行ではない**ので、`\n` の手前に並ぶ円記号が奇数個のときだけ数える。
 */
function containsNewline(literal: string): boolean {
  return literal.includes('\n') || /(?:^|[^\\])(?:\\\\)*\\n/.test(literal);
}

/** 改行を含む字面リテラルで差し替えている行（1始まり）。 */
function newlineLiteralLines(source: string): readonly number[] {
  const found: number[] = [];
  for (const match of source.matchAll(EDIT_WITH_LITERAL)) {
    if (!containsNewline(match[2])) continue;
    found.push(source.slice(0, match.index).split('\n').length);
  }
  return found;
}

describe('字面の差し替えの書き方', () => {
  const sources = trackedSources();

  it('改行を含む字面リテラルで差し替えている箇所が無い', () => {
    const offenders = sources.flatMap((rel) =>
      newlineLiteralLines(read(rel)).map((line) => `${rel}:${line}`),
    );

    expect(
      offenders,
      `読んだ側で改行をLFへ均し、差し替えは ${DOOR} の replaceAllOrFail を通す` +
        '（試験の外からは入口を使えないので、`\\r?\\n` を受ける正規表現で書く）',
    ).toEqual([]);
  });

  it('追跡されているソースを全部見ていて、入口が実在する', () => {
    // 射程が縮んだときに、検査が黙って通さないようにする。
    expect(sources, '追跡ソースの一覧が引けていない').not.toEqual([]);
    expect(sources, '射程が置き場の一覧へ戻っている').toContain(OUTSIDE_EVERY_SOURCE_DIRECTORY);

    expect(existsSync(join(ROOT, DOOR)), DOOR).toBe(true);
    expect(
      sources.filter((rel) => rel !== DOOR && read(rel).includes('support/textEdit')),
      `${DOOR} を通している検査が無い`,
    ).not.toEqual([]);
  });
});
