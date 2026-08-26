import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `npm run stats:declarations`（`scripts/declarationInventory.mjs`）が空を返していないかの検査。
 *
 * この道具は**宣言が1件も拾えなくなっても0行を返すだけ**で、正常に「何も無い」と言ったのと区別が
 * 付かない。定義位置の移動を差分で追う道具なので、空のまま気づかないと**移動が全部消えて見える**。
 *
 * 見るのは**空でないことだけ**で、拾い方の当たり外れは見ない。
 *
 * 子プロセスとして動かす理由は `countLines.test.ts` と同じ——落ちるのは `git ls-files` での列挙の
 * ような、集める側。
 */

const ROOT = resolve(__dirname, '../..');

/** 出力は`src`の量に比例して伸びるので、既定の上限（1MB）には頼らない。 */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/** `npm run stats:declarations` と同じ経路で拾ったもの。 */
const REPORTED = execFileSync('node', [join(ROOT, 'scripts/declarationInventory.mjs')], {
  cwd: ROOT,
  encoding: 'utf-8',
  maxBuffer: MAX_OUTPUT_BYTES,
})
  .split(/\r?\n/)
  .filter((line) => line !== '');

describe('srcの宣言の一覧', () => {
  it('宣言が1件も出ていない状態を通さない', () => {
    expect(REPORTED.length, '宣言が1件も拾えていない').toBeGreaterThan(0);
  });
});
