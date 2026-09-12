import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 文書が、置かれたフォルダの `README.md` からリンクされているかの検査。
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

/** そのフォルダに置かれた文書と、それを収めるべき一覧。 */
interface Filing {
  /** `docs/` からの相対パス。 */
  readonly doc: string;
  /** 同じフォルダの `README.md`（リポジトリルートからの相対パス）。 */
  readonly index: string;
}

function listFilings(dir: string): Filing[] {
  const result: Filing[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, entry);
    if (statSync(join(ROOT, rel)).isDirectory()) {
      result.push(...listFilings(rel));
    } else if (entry.endsWith('.md') && entry !== INDEX) {
      result.push({ doc: rel, index: join(dir, INDEX) });
    }
  }
  return result;
}

const FILINGS = listFilings('docs');

/** Markdownリンクの行き先。題名の側は見ない（指しているのはリンクの先だから）。 */
const LINK_TARGET = /\]\(([^)\s]+)\)/g;

function linkedNames(index: string): Set<string> {
  const text = readFileSync(join(ROOT, index), 'utf-8');
  const names = new Set<string>();
  for (const [, target] of text.matchAll(LINK_TARGET)) {
    names.add(basename(target.split('#')[0]));
  }
  return names;
}

describe('docs/ の文書は、置かれたフォルダのREADMEが指している', () => {
  it.each(FILINGS)('$doc を $index が指している', ({ doc, index }) => {
    expect(linkedNames(index)).toContain(basename(doc));
  });
});
