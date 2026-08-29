import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 説明が挙げる名前が、今も在るものを指しているかの検査。**説明だけが古い名前で取り残される**
 * ——メソッドを畳んだり改名したりしたときに、それを指していた別ファイルの説明は型検査にも
 * lintにも掛からない。初回の全数調査では、既に無いメソッドを指す説明がコメントに8件・
 * `docs/` に10件見つかった。
 *
 * 見方は2つあり、どちらが赤くなったかで直す場所が変わるので `it` を分けてある。
 *
 * 1. **`Xxx.yyy` の形**（下の「今は無い名前を指していない」）。見るのは `src`・`tests` の `.ts` の
 *    コメントと、`docs/` の `.md` の全文。判定は「その名前がコード（コメント以外）に一度も出て
 *    こないなら、指す先が無い」。読み手が辿れることだけを見るので、公開・非公開は問わない。
 *    **ファイル名は参照ではない。** `ClimateSystem.md` のような書き方が `docs/` の大半を占めるので、
 *    リポジトリに在るファイルの名前と一致するものを除く。拡張子の一覧では弾かない——一覧のほうが
 *    古びて、増えた拡張子に気づけないまま素通しになる。
 *    **所有者がこのリポジトリのものでなければ、何も言わない**（ownedHere）。`Node.js` の `js` も
 *    `Math.trunc` の `trunc` も、在るかどうかを決めているのはこのリポジトリではないので、
 *    「メンバーがコードに無い」は何の証拠にもならない。所有者が偶然コードに出てくるかどうかで
 *    判定が入れ替わるのを避ける——`ts.Node` を1箇所で使い始めた途端、文書の `Node.js` が
 *    参照として読まれた。
 * 2. **ファイルと名前が並んでいる形**（下の「ファイルと並べて挙げた名前が、そのファイルに在る」）。
 *    1 は所有者の無い裸の名前（`start`・`build`）を見られない——`docs/` の散文にいくらでも出てくる
 *    普通の英単語なので、一律に見ると誤検知になる。ただし文書が `Foo.ts` とその中身を並べて書いて
 *    いる箇所なら、**指す先のファイルが決まっている**ので裸のままでも判定できる。
 */

const ROOT = resolve(__dirname, '../..');

function filesIn(dir: string, extension: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) found.push(...filesIn(rel, extension));
    else if (entry.endsWith(extension)) found.push(rel);
  }
  return found;
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf-8');
}

/** 説明が書かれている行と、原文での行番号。 */
type ProseLine = { readonly line: number; readonly text: string };

/** `.ts` で説明が書かれているのはコメントの行だけ。 */
function commentLines(text: string): ProseLine[] {
  const kept: ProseLine[] = [];
  let inBlock = false;
  text.split('\n').forEach((raw, index) => {
    const trimmed = raw.trim();
    if (trimmed.startsWith('/*')) inBlock = true;
    const isComment = inBlock || trimmed.startsWith('//') || trimmed.startsWith('*');
    if (trimmed.includes('*/')) inBlock = false;
    if (isComment) kept.push({ line: index + 1, text: raw });
  });
  return kept;
}

/** `.md` は全体が説明。コードフェンスの中の例も、実在の名前を指しているなら同じに見る。 */
function allLines(text: string): ProseLine[] {
  return text.split('\n').map((raw, index) => ({ line: index + 1, text: raw }));
}

/** コメントを取り除いた本文（文字列リテラルはそのまま残す——名前を文字列で持つ宣言もあるため）。 */
function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 参照の書き方。所有者は大文字始まり、メンバーは小文字始まり（型名を除くため）。 */
const REFERENCE = /\b([A-Z][A-Za-z0-9]*)\.([a-z][A-Za-z0-9_]*)\b\.?/g;

const SOURCES = [...filesIn('src', '.ts'), ...filesIn('tests', '.ts')];
const DOCUMENTS = filesIn('docs', '.md');
const TARGETS = [
  { files: SOURCES, proseOf: commentLines },
  { files: DOCUMENTS, proseOf: allLines },
];

const CODE = SOURCES.map((rel) => codeOnly(read(rel))).join('\n');
const foundInCode = new Map<string, boolean>();
function appearsInCode(name: string): boolean {
  const cached = foundInCode.get(name);
  if (cached !== undefined) return cached;
  const found = new RegExp(`\\b${name}\\b`).test(CODE);
  foundInCode.set(name, found);
  return found;
}

const TRACKED_PATHS = execSync('git ls-files', { cwd: ROOT, encoding: 'utf-8' })
  .split('\n')
  .map((path) => path.trim())
  .filter((path) => path !== '');

/** git の管理下にあるファイルの名前（ディレクトリを除いた最後の部分）。 */
const FILE_NAMES = new Set(TRACKED_PATHS.map((path) => basename(path)));

/**
 * その名前をこのリポジトリが持っているか——**宣言そのものか、モジュール**（`NewGame.startNewGame`
 * のように、ファイル名で呼ぶ書き方）。持っていない名前（Phaser・JSの組み込み・文書の例の`Foo`）の
 * メンバーが在るかは、このリポジトリが決めていないので答えられない。
 */
function ownedHere(name: string): boolean {
  return (
    FILE_NAMES.has(`${name}.ts`) ||
    new RegExp(`\\b(?:class|interface|type|enum|function|namespace|const|let|var)\\s+${name}\\b`).test(
      CODE,
    )
  );
}

/**
 * 文書に書かれたファイル参照から、実ファイルの相対パスへ。パス全体でも名前だけでも引ける。
 * 名前が複数のファイルで重なっているものは、どれを指すか決まらないので引けない（`null`）。
 */
const TS_FILE_BY_REFERENCE = new Map<string, string | null>();
for (const path of TRACKED_PATHS.filter((path) => path.endsWith('.ts'))) {
  TS_FILE_BY_REFERENCE.set(path, path);
  const name = basename(path);
  TS_FILE_BY_REFERENCE.set(name, TS_FILE_BY_REFERENCE.has(name) ? null : path);
}

function tsFileOf(reference: string): string | null {
  return TS_FILE_BY_REFERENCE.get(reference) ?? TS_FILE_BY_REFERENCE.get(basename(reference)) ?? null;
}

/**
 * その名前がそのファイルに現れるか。**コメントも見る**——YAMLのプロパティ名（`ambient_brightness`）は
 * そのファイルを説明するコメントにしか現れないことがあり、それでも「そのファイルが扱っている」ことに
 * 変わりはない。ここが見たいのは指す先が在るかで、名前がコードの語彙かどうかではない。
 */
const textByFile = new Map<string, string>();
function appearsIn(file: string, name: string): boolean {
  let text = textByFile.get(file);
  if (text === undefined) {
    text = read(file);
    textByFile.set(file, text);
  }
  return new RegExp(`\\b${name}\\b`).test(text);
}

/** 文書がファイルと並べて挙げた名前と、その指す先。 */
type FileMember = { readonly file: string; readonly name: string };

/** ファイルを単独で置いた括弧。並んでいる名前は、括弧の直前に接しているもの。 */
const NAME_THEN_FILE = /`([^`]+)`\s*[（(]\s*`([\w./-]+\.ts)`\s*[）)]/g;
/** ファイルに続けて中身を挙げる括弧。並んでいる名前は、括弧の中のもの。 */
const FILE_THEN_NAMES = /`([\w./-]+\.ts)`\s*[（(]([^）)]*)[）)]/g;
/** 図の1行の末尾に、空白で切り離して置かれたファイル。並んでいる名前は、その行が呼んでいるもの。 */
const CALL_THEN_FILE = /^(.*?\S)\s\s+([\w./-]+\.ts)\b/;
const QUOTED = /`([^`]+)`/g;
const NAME = /[A-Za-z_][A-Za-z0-9_]*/;

/** 名前として見るのは最初の識別子だけ（`placeSites(scope)` なら `placeSites`）。 */
function nameIn(text: string): string | null {
  return NAME.exec(text)?.[0] ?? null;
}

/** バッククォートの中身のうち、名前を挙げているもの。ファイル参照そのものは名前ではない。 */
function quotedName(quoted: string): string | null {
  if (quoted.includes('/') || /\.[A-Za-z]+$/.test(quoted)) return null;
  return nameIn(quoted);
}

/** セル全体が1つのファイル参照になっているとき、その実ファイル。 */
function cellFile(cell: string): string | null {
  const only = /^\s*`([\w./-]+\.ts)`\s*$/.exec(cell);
  return only === null ? null : tsFileOf(only[1]);
}

/**
 * その行がファイルと名前を並べて書いている組。並べ方は、括弧で注釈する（散文・見出し）・表の同じ行に
 * 置く（索引の表）・図の行末に添える（呼び出し関係の図）の3つ。
 */
function fileMembersOn(text: string, insideFence: boolean): FileMember[] {
  const found: FileMember[] = [];
  const add = (file: string | null, name: string | null): void => {
    if (file !== null && name !== null) found.push({ file, name });
  };

  if (insideFence) {
    const annotated = CALL_THEN_FILE.exec(text);
    if (annotated !== null) add(tsFileOf(annotated[2]), nameIn(annotated[1]));
    return found;
  }

  for (const match of text.matchAll(NAME_THEN_FILE)) {
    add(tsFileOf(match[2]), quotedName(match[1]));
  }
  for (const match of text.matchAll(FILE_THEN_NAMES)) {
    const file = tsFileOf(match[1]);
    for (const quoted of match[2].matchAll(QUOTED)) add(file, quotedName(quoted[1]));
  }

  if (!text.trim().startsWith('|')) return found;
  const cells = text.split('|').slice(1, -1);
  const fileCells = cells.flatMap((cell, index) => (cellFile(cell) === null ? [] : [index]));
  // 1行に2つ以上のファイルが単独で置かれていたら、どちらが持つ名前かは決まらない。
  if (fileCells.length !== 1) return found;
  const file = cellFile(cells[fileCells[0]]);
  cells.forEach((cell, index) => {
    if (index === fileCells[0]) return;
    for (const quoted of cell.matchAll(QUOTED)) add(file, quotedName(quoted[1]));
  });
  return found;
}

describe('説明の参照', () => {
  it('今は無い名前を指していない', () => {
    const dangling: string[] = [];
    for (const { files, proseOf } of TARGETS) {
      for (const rel of files) {
        for (const { line, text } of proseOf(read(rel))) {
          for (const match of text.matchAll(REFERENCE)) {
            // `WorldCodex.schema.json`のように後ろが続くものはファイル名で、コードの中の名前ではない。
            if (match[0].endsWith('.')) continue;
            const [whole, owner, member] = match;
            if (FILE_NAMES.has(whole)) continue;
            if (!ownedHere(owner) || appearsInCode(member)) continue;
            dangling.push(`${rel}:${line} ${whole}`);
          }
        }
      }
    }

    expect(
      dangling,
      `説明が指す名前がコードのどこにも無い:\n${dangling.join('\n')}`,
    ).toEqual([]);
  });

  it('ファイルと並べて挙げた名前が、そのファイルに在る', () => {
    const missing: string[] = [];
    for (const rel of DOCUMENTS) {
      let insideFence = false;
      for (const { line, text } of allLines(read(rel))) {
        if (text.trim().startsWith('```')) {
          insideFence = !insideFence;
          continue;
        }
        for (const { file, name } of fileMembersOn(text, insideFence)) {
          if (appearsIn(file, name)) continue;
          missing.push(`${rel}:${line} ${name}（${file} に無い）`);
        }
      }
    }

    expect(
      missing,
      `文書がファイルと並べて挙げた名前が、そのファイルに無い:\n${missing.join('\n')}`,
    ).toEqual([]);
  });
});
