import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 文書が、置かれたフォルダの `README.md` からリンクされているかの検査
 * （[`docs/DocumentStyle.md`](../../docs/DocumentStyle.md) 1節）。
 *
 * `docs/` は扱っている領域でフォルダを分け、領域に閉じないものだけを直下へ置く
 * （[`docs/README.md`](../../docs/README.md)）。**置き場を決めた跡は、そのフォルダの `README.md` が
 * その文書を指しているかどうかにしか残らない**——置き場が合っていない文書は、そのフォルダの分類の
 * どこにも収まらないので、一覧から落ちたまま誰にも気づかれない
 * （`CodingConventions.md` が engine の一覧に無いまま `docs/engine/` に居た。issue #1956）。
 */

const ROOT = resolve(__dirname, '../..');

/** フォルダの分類を持つ文書。この文書自身は、どこからも指されなくてよい。 */
const INDEX = 'README.md';

/** そのフォルダに置かれた文書と、それを収めるべき一覧。どちらもリポジトリルートからの相対パス。 */
interface Filing {
  readonly doc: string;
  readonly index: string;
}

const DIRECTORIES: string[] = [];
const FILINGS: Filing[] = [];

function walk(dir: string): void {
  DIRECTORIES.push(dir);
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, entry);
    if (statSync(join(ROOT, rel)).isDirectory()) {
      walk(rel);
    } else if (entry.endsWith('.md') && entry !== INDEX) {
      FILINGS.push({ doc: rel, index: join(dir, INDEX) });
    }
  }
}

walk('docs');

/** Markdownリンクの行き先。題名の側は見ない（指しているのはリンクの先だから）。 */
const LINK_TARGET = /\]\(([^)\s]+)\)/g;

/**
 * 一覧が指している文書を、リポジトリルートからの相対パスで返す。
 *
 * **綴りではなくパスで持つ。** `docs/engine/README.md` は隣のフォルダの `../CodeStructure.md` も
 * 指しており、綴りだけで照合すると、同じ名前の文書が engine に生えたとき指されていなくても通る。
 */
function linkedDocs(index: string): Set<string> {
  if (!existsSync(join(ROOT, index))) return new Set();
  const from = dirname(index);
  const docs = new Set<string>();
  for (const [, target] of readFileSync(join(ROOT, index), 'utf-8').matchAll(LINK_TARGET)) {
    const [path] = target.split('#');
    if (path === '' || /^[a-z][a-z0-9+.-]*:/i.test(path)) continue;
    docs.add(join(from, path));
  }
  return docs;
}

describe('docs/ の文書は、置かれたフォルダのREADMEが指している', () => {
  it.each(DIRECTORIES)('%s が分類を持つ（README.md が在る）', (dir) => {
    expect(existsSync(join(ROOT, dir, INDEX))).toBe(true);
  });

  it.each(FILINGS)('$doc を $index が指している', ({ doc, index }) => {
    expect([...linkedDocs(index)]).toContain(doc);
  });
});
