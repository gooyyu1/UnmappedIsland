import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 試験が `bash` を起こす道の検査。
 *
 * bash へ渡すパスは `/` 区切りへ直さないと、渡されたスクリプトが `${BASH_SOURCE[0]%/*}` で自分の
 * 置き場を出せず、隣のファイルをカレントから探しに行く（理由は `tests/support/runScript.ts`）。
 * その約束を持つのは `runScript` / `spawnScript` / `pathForBash` だけなので、**試験が直に `bash` を
 * 起こした時点で約束の外へ出る。**
 *
 * **この破れは Linux では観測できない**——区切りが元から `/` なので、`\` 区切りのパスを渡す書き方でも
 * CI は緑のまま通る。踏むのは Windows の作業ツリーだけで、しかも叩く先が隣のファイルを読み始めた日に
 * 初めて落ちる。字面で見張る以外に、書いた時点で気づく手立てが無い。
 */

const ROOT = resolve(__dirname, '../..');

/** 約束を持つ入口。`bash` へスクリプトの在り処を渡し、区切りを直してよいのはここだけ。 */
const DOOR = 'tests/support/runScript.ts';

/** この検査そのもの（見張る字面を自分で持つので、自分自身は数えない）。 */
const SELF = 'tests/architecture/bashFromTests.test.ts';

/**
 * `bash` へ**在り処を渡して**起こしている呼び出し。`bash -c` はパスを渡さないので当たらない
 * （`tests/support/stubShebang.ts` が bash 自身の在り処を引くのに使う）。
 *
 * 引数が行をまたいで折れても当たるよう、字間は `\s*` で受ける。
 */
const SPAWNS_PATH = /\b(?:execFile|spawn)(?:Sync)?\(\s*'bash',\s*\[\s*(?!'-c')/;

/** 区切りを手で直している式。`pathForBash` を通さずに書くと、直す理由が読める場所から離れる。 */
const CONVERTS = String.raw`replace(/\\/g, '/')`;

/** そのディレクトリ以下の `.ts`（リポジトリ相対）。 */
function sourcesIn(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) found.push(...sourcesIn(rel));
    else if (entry.endsWith('.ts')) found.push(rel);
  }
  return found;
}

const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf-8');

describe('試験が bash を起こす道', () => {
  const outside = sourcesIn('tests').filter((rel) => rel !== DOOR && rel !== SELF);

  it('bash へパスを渡すのは runScript / spawnScript だけ', () => {
    expect(
      outside.filter((rel) => SPAWNS_PATH.test(read(rel))),
      `bash を直に起こさず ${DOOR} を通す`,
    ).toEqual([]);
  });

  it('区切りを直すのは pathForBash だけ', () => {
    expect(
      outside.filter((rel) => read(rel).includes(CONVERTS)),
      `手で直さず ${DOOR} の pathForBash を通す`,
    ).toEqual([]);
  });

  it('入口が実在して、約束を持っている', () => {
    // 入口が引っ越したときに、検査が黙って空を通さないようにする。
    expect(outside.length).toBeGreaterThan(0);
    expect(read(DOOR)).toContain(CONVERTS);
  });
});
