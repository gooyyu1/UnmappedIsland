import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * コメントの中の「`Xxx.yyy`」が、今も在るものを指しているかの検査。
 *
 * **説明だけが古い名前で取り残される**——メソッドを畳んだり改名したりしたときに、それを指していた
 * 別ファイルのコメントは型検査にもlintにも掛からない。初回の全数調査では、既に無いメソッドを指す
 * 説明が8件見つかった。
 *
 * 判定は「その名前がコード（コメント以外）に一度も出てこないなら、指す先が無い」。読み手が辿れる
 * ことだけを見るので、公開・非公開は問わない。
 */

const ROOT = resolve(__dirname, '../..');

function sourcesIn(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) found.push(...sourcesIn(rel));
    else if (entry.endsWith('.ts')) found.push(rel);
  }
  return found;
}

/** コメントを取り除いた本文（文字列リテラルはそのまま残す——名前を文字列で持つ宣言もあるため）。 */
function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 参照の書き方。所有者は大文字始まり、メンバーは小文字始まり（型名とファイル名を除くため）。 */
const REFERENCE = /\b([A-Z][A-Za-z0-9]*)\.([a-z][A-Za-z0-9_]*)\b\.?/g;

const FILES = [...sourcesIn('src'), ...sourcesIn('tests')];
const TEXTS = new Map(FILES.map((rel) => [rel, readFileSync(join(ROOT, rel), 'utf-8')]));
const CODE = [...TEXTS.values()].map(codeOnly).join('\n');

const appearsInCode = (name: string): boolean => new RegExp(`\\b${name}\\b`).test(CODE);

describe('コメントの参照', () => {
  it('今は無い名前を指していない', () => {
    const dangling: string[] = [];
    for (const [rel, text] of TEXTS) {
      const comments = text.split('\n');
      let inBlock = false;
      comments.forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('/*')) inBlock = true;
        const isComment = inBlock || trimmed.startsWith('//') || trimmed.startsWith('*');
        if (trimmed.includes('*/')) inBlock = false;
        if (!isComment) return;

        for (const match of line.matchAll(REFERENCE)) {
          // `WorldCodex.schema.json`のように後ろが続くものはファイル名で、コードの中の名前ではない。
          if (match[0].endsWith('.')) continue;
          const [, owner, member] = match;
          if (!appearsInCode(owner) || appearsInCode(member)) continue;
          dangling.push(`${rel}:${index + 1} ${owner}.${member}`);
        }
      });
    }

    expect(dangling, 'コメントが指す名前がコードのどこにも無い').toEqual([]);
  });
});
