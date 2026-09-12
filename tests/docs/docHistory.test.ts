import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 経緯を主題としない文書に、過去の姿を語る記述が生えていないかの検査
 * （[`docs/DocumentStyle.md`](../../docs/DocumentStyle.md) 9.1節）。
 *
 * **書いてよい文書の別は、9.1節の表からだけ引く。** ここへ写すと、表を増やしたときに2箇所が
 * ずれる。表に無い文書で「かつて」「以前は」と書き始めた記述は、旧仕様を知らない読み手には
 * 要らないものになる（issue #1936）。
 */

const ROOT = resolve(__dirname, '../..');

const DOCUMENT_STYLE = 'docs/DocumentStyle.md';

/**
 * 過去の姿を語り出す印。**「かつて」「以前は」のように、過去の姿を指すことがその語の意味である
 * ものだけを挙げる。** 単なる過去形（「〜でした」）は測定の報告にも使うので、見ない。
 */
const MARKERS = ['かつて', '以前は', 'ていた頃', 'だった頃', '時期があ'];

/** 9.1節の表が挙げる文書を、リポジトリルートからの相対パスで返す。 */
function documentsAllowedToTellHistory(): Set<string> {
  const text = readFileSync(join(ROOT, DOCUMENT_STYLE), 'utf-8');
  const section = /\n### 9\.1 [^\n]*\n([\s\S]*?)(?=\n#{2,3} |$)/.exec(text);
  if (section === null) throw new Error(`${DOCUMENT_STYLE} に 9.1 節が無い`);
  const allowed = new Set<string>();
  for (const [, target] of section[1].matchAll(/^\| \[[^\]]+\]\(([^)\s]+)\)/gm)) {
    allowed.add(join('docs', target.split('#')[0]));
  }
  if (allowed.size === 0) throw new Error(`${DOCUMENT_STYLE} 9.1 節の表から文書を引けない`);
  return allowed;
}

function docsIn(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) found.push(...docsIn(rel));
    else if (entry.endsWith('.md')) found.push(rel);
  }
  return found;
}

const ALLOWED = documentsAllowedToTellHistory();

// 9.1節そのものを持つ文書は、どこに経緯を書いてよいかを決める側なので対象から外す。
const SUBJECTS = docsIn('docs').filter((doc) => !ALLOWED.has(doc) && doc !== DOCUMENT_STYLE);

describe('経緯を主題としない文書は、過去の姿を語らない', () => {
  it.each(SUBJECTS)('%s', (doc) => {
    const lines = readFileSync(join(ROOT, doc), 'utf-8').split('\n');
    const found: string[] = [];
    lines.forEach((line, index) => {
      for (const marker of MARKERS) {
        if (line.includes(marker)) found.push(`${doc}:${index + 1} 「${marker}」 ${line.trim()}`);
      }
    });
    expect(found).toEqual([]);
  });
});
