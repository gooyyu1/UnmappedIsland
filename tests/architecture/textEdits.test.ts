import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
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
 * **取りこぼすのは、字面リテラルの形で書かれていない差し替え**——`'a' + '\n'` のように組み立てた
 * ものや、変数に入れてから渡したものは当たらない。見えている形から倒す。
 */

/** 改行コードに依らない差し替えの入口（試験）。 */
const DOOR = 'tests/support/textEdit.ts';

/** 字面を読む置き場。ここだけを見る（生成物や同梱の定義は差し替えの主体にならない）。 */
const SCANNED = ['tests', 'src', 'scripts'];

/**
 * `replace`/`replaceAll` の第1引数の字面リテラル。引数が行をまたいで折れても当たるよう、字間は
 * `\s*` で受ける。正規表現リテラルを渡している呼び出しは、`\r?\n` で改行を受けられるので当たらない。
 */
const EDIT_WITH_LITERAL = /\.replace(?:All)?\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

/** その置き場以下の、字面を持つソース（リポジトリ相対・`/`区切り）。 */
function sourcesUnder(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:ts|mts|mjs)$/.test(entry.name))
    .map((entry) => relative(ROOT, join(entry.parentPath, entry.name)).split(sep).join('/'));
}

const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf-8');

/** 改行を含む字面リテラルで差し替えている行（1始まり）。 */
function newlineLiteralLines(source: string): readonly number[] {
  const found: number[] = [];
  for (const match of source.matchAll(EDIT_WITH_LITERAL)) {
    const literal = match[2];
    if (!literal.includes('\n') && !literal.includes(String.raw`\n`)) continue;
    found.push(source.slice(0, match.index).split('\n').length);
  }
  return found;
}

describe('字面の差し替えの書き方', () => {
  const sources = SCANNED.flatMap(sourcesUnder);

  it('改行を含む字面リテラルで差し替えている箇所が無い', () => {
    const offenders = sources.flatMap((rel) =>
      newlineLiteralLines(read(rel)).map((line) => `${rel}:${line}`),
    );

    expect(
      offenders,
      `読んだ側で改行をLFへ均し、差し替えは ${DOOR} の replaceAllOrFail を通す` +
        '（`src`・`scripts` では `\\r?\\n` を受ける正規表現で書く）',
    ).toEqual([]);
  });

  it('検査対象の置き場と入口が実在する', () => {
    // 置き場が引っ越したときに、検査が黙って空を通さないようにする。
    for (const dir of SCANNED) expect(sourcesUnder(dir).length, dir).toBeGreaterThan(0);

    expect(existsSync(join(ROOT, DOOR)), DOOR).toBe(true);
    expect(
      sources.filter((rel) => rel !== DOOR && read(rel).includes('support/textEdit')),
      `${DOOR} を通している検査が無い`,
    ).not.toEqual([]);
  });
});
