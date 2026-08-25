import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 説明の中の「`Xxx.yyy`」が、今も在るものを指しているかの検査。
 *
 * **説明だけが古い名前で取り残される**——メソッドを畳んだり改名したりしたときに、それを指していた
 * 別ファイルの説明は型検査にもlintにも掛からない。初回の全数調査では、既に無いメソッドを指す説明が
 * コメントに8件・`docs/` に10件見つかった。
 *
 * 見るのは `src`・`tests` の `.ts` のコメントと、`docs/` の `.md` の全文。判定は「その名前がコード
 * （コメント以外）に一度も出てこないなら、指す先が無い」。読み手が辿れることだけを見るので、
 * 公開・非公開は問わない。
 *
 * **ファイル名は参照ではない。** `ClimateSystem.md` のような書き方が `docs/` の大半を占めるので、
 * リポジトリに在るファイルの名前と一致するものを除く。拡張子の一覧では弾かない——一覧のほうが
 * 古びて、増えた拡張子に気づけないまま素通しになる。
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

/** git の管理下にあるファイルの名前（ディレクトリを除いた最後の部分）。 */
const FILE_NAMES = new Set(
  execSync('git ls-files', { cwd: ROOT, encoding: 'utf-8' })
    .split('\n')
    .map((path) => basename(path.trim())),
);

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
            if (!appearsInCode(owner) || appearsInCode(member)) continue;
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
});
