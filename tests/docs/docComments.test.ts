import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ソースのdocコメントが、その直下の宣言と対応しているかの検査。
 *
 * **`/** ... *&#47;` が隙間なく2つ続いていたら、上は説明する相手を失っている。** 宣言を動かしたり
 * 消したりしたときに説明だけが取り残された跡で、リポジトリ全体で14件見つかった（今は無いメソッドの
 * 説明・別のフィールドの説明・矛盾する2つの説明）。読み手にもTypeDocにも、上のブロックが直下の
 * 宣言の説明として見えてしまう。
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

describe('docコメント', () => {
  it('宣言を失った説明が残っていない', () => {
    const orphans: string[] = [];
    for (const rel of sourcesIn('src')) {
      const lines = readFileSync(join(ROOT, rel), 'utf-8').split('\n');
      for (let i = 0; i < lines.length - 1; i++) {
        const ends = lines[i].trimEnd().endsWith('*/');
        const starts = lines[i + 1].trimStart().startsWith('/**');
        if (ends && starts) orphans.push(`${rel}:${i + 2}`);
      }
    }

    expect(orphans, 'docコメントが隙間なく2つ続いている（上が説明する相手を失っている）').toEqual([]);
  });
});
