import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ソースのdocコメントが、その直下の宣言と対応しているかの検査。
 *
 * **docコメントの次が（空行だけを挟んで）またdocコメントなら、上は説明する相手を失っている。**
 * 宣言を動かしたり消したりしたときに説明だけが取り残された跡で、リポジトリ全体で14件見つかった
 * （今は無いメソッドの説明・別のフィールドの説明・矛盾する2つの説明）。読み手にもTypeDocにも、
 * 上のブロックが直下の宣言の説明として見えてしまう。
 *
 * 説明を消すか、対応する宣言の直上へ戻すか、どちらかで直す。
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

/** その行がコメントの一部か（ブロックの途中も含む）。 */
function isComment(line: string): boolean {
  return line.startsWith('/*') || line.startsWith('*');
}

describe('docコメント', () => {
  it('宣言を失った説明が残っていない', () => {
    const orphans: string[] = [];
    for (const rel of sourcesIn('src')) {
      const lines = readFileSync(join(ROOT, rel), 'utf-8').split('\n');
      // ファイル冒頭の「モジュールの説明 → 空行 → 最初の宣言の説明」は正しい形。空行を挟む並びは、
      // 宣言が1つでも出た後でだけ取り残しとみなす。
      let afterDeclaration = false;
      let inImport = false;
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i].trim();
        if (line.startsWith('import ')) inImport = !line.endsWith(';');
        else if (inImport) inImport = !line.endsWith(';');
        else if (line !== '' && !line.startsWith('//') && !isComment(line)) afterDeclaration = true;
        if (!lines[i].trimEnd().endsWith('*/')) continue;

        let next = i + 1;
        while (next < lines.length && lines[next].trim() === '') next++;
        if (next > i + 1 && !afterDeclaration) continue;
        if (lines[next]?.trimStart().startsWith('/**')) orphans.push(`${rel}:${next + 1}`);
      }
    }

    expect(orphans, 'docコメントが隙間なく2つ続いている（上が説明する相手を失っている）').toEqual([]);
  });
});
