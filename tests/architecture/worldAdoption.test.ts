import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * worldの包みを作ったら、そのworldインスタンスを生成したセッションへ結び付ける（WorldSession.adoptWorld）。
 *
 * 結び付けずに包むと、worldインスタンスは時計を持たないセッションに属したままになり、そこから
 * 辿った `session.world` が `undefined` を返す。型も実行時も止めないので、ここで書き方を見る。
 * 包みの生成と結び付けは隣り合って書く（間に別の処理を挟まない）。
 */

const ROOT = resolve(__dirname, '../..');

/** worldの包みの生成。**この綴りがこのファイル自身に現れない書き方**にしてある。 */
const WRAP = /\bnew World\(/;
const ADOPT = /\.adoptWorld\(/;

/** 包みを作った行から、結び付けを探す行数（その行を含む）。 */
const ADOPT_WINDOW_LINES = 4;

/** そのディレクトリ以下の.tsファイル（リポジトリ相対）。 */
function filesIn(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) found.push(...filesIn(rel));
    else if (entry.endsWith('.ts')) found.push(rel);
  }
  return found;
}

function unadoptedWraps(rel: string): string[] {
  const lines = readFileSync(join(ROOT, rel), 'utf-8').split(/\r?\n/);
  return lines.flatMap((line, i) =>
    WRAP.test(line) && !lines.slice(i, i + ADOPT_WINDOW_LINES).some((l) => ADOPT.test(l))
      ? [`${rel}:${i + 1}`]
      : [],
  );
}

describe('worldの包み', () => {
  it('作ったらすぐ、worldインスタンスのセッションへ結び付けている', () => {
    const found = [...filesIn('src'), ...filesIn('tests')].flatMap(unadoptedWraps);

    expect(found).toEqual([]);
  });
});
