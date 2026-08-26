import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `npm run stats:lines`（`scripts/countLines.mjs`）が空を返していないかの検査。
 *
 * この道具は**全部0になっても表の形は保たれる**ので、壊れたことが表から読み取れない（同じ形で
 * 5週間気づかれなかったのが issue #867）。`npm test` から呼ばれていないと、誰も気づかない。
 *
 * 見るのは**集計が空になっていないことだけ**で、値の妥当性は見ない——重ねて見ると、赤くなった
 * ときにどちらの意味か決まらなくなる。
 *
 * 道具を関数として読み込まずに子プロセスとして動かすのは、落ちるのが数え方ではなく**集める側**
 * （`git ls-files` での列挙・バイナリ判定・行の割り方）だから。出力までを通して見る。
 */

const ROOT = resolve(__dirname, '../..');

interface Counted {
  readonly files: number;
  readonly total: number;
}

/**
 * 拡張子で引ける形にした表。桁は空白で揃えてあり、**どの桁にも空白は入らない**ので空白で割れる。
 * 見出し・区切り線・末尾の但し書きは、桁数か数値でないことで落ちる。
 */
function tableOf(stdout: string): Map<string, Counted> {
  const rows = new Map<string, Counted>();
  for (const line of stdout.split(/\r?\n/)) {
    const cells = line.trim().split(/\s+/);
    if (cells.length !== 5 || !/^\d+$/.test(cells[1])) continue;
    rows.set(cells[0], { files: Number(cells[1]), total: Number(cells[2]) });
  }
  return rows;
}

/** `npm run stats:lines` と同じ経路で数えたもの。 */
const REPORTED = tableOf(
  execFileSync('node', [join(ROOT, 'scripts/countLines.mjs')], { cwd: ROOT, encoding: 'utf-8' }),
);

describe('gitの追跡ファイルの行数の集計', () => {
  // `.ts` と `.md` は、この検査自身とこのコメントが在る限り必ず存在する。
  it.each(['合計', '.ts', '.md'])('%s の行が空になっていない', (extension) => {
    const counted = REPORTED.get(extension);
    expect(counted, `表に「${extension}」の行が無い:\n${[...REPORTED.keys()].join(' ')}`).toBeDefined();
    expect(counted?.files ?? 0, `${extension} のファイル数が0`).toBeGreaterThan(0);
    expect(counted?.total ?? 0, `${extension} の総行数が0`).toBeGreaterThan(0);
  });
});
