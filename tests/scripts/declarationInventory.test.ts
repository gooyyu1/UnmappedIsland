import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `npm run stats:declarations`（`scripts/declarationInventory.mjs`）が空を返していないかの検査。
 *
 * この道具は**宣言が1件も拾えなくなっても0行を返すだけ**で、正常に「何も無い」と言ったのと区別が
 * 付かない。定義位置の移動を差分で追う道具なので、空のまま気づかないと**移動が全部消えて見える**。
 *
 * 拾い方の当たり外れは、無名の型リテラルのメンバの所属の付け方だけを見る
 * （`scripts/declarationInventory.mjs` の `literalOwnerOf` と `collectMembers`）。
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

/** `--json` の1件。読むのはこの検査が使う分だけ。 */
interface Declaration {
  readonly file: string;
  readonly owner: string;
  readonly container?: string;
  readonly name: string;
  readonly referencedInOwnFileOutsideOwner?: boolean;
}

const REPORTED_JSON = JSON.parse(
  execFileSync('node', [join(ROOT, 'scripts/declarationInventory.mjs'), '--json'], {
    cwd: ROOT,
    encoding: 'utf-8',
    maxBuffer: MAX_OUTPUT_BYTES,
  }),
) as readonly Declaration[];

function reported(file: string, name: string): readonly Declaration[] {
  return REPORTED_JSON.filter((declaration) => declaration.file === file && declaration.name === name);
}

describe('srcの宣言の一覧', () => {
  it('宣言が1件も出ていない状態を通さない', () => {
    expect(REPORTED.length, '宣言が1件も拾えていない').toBeGreaterThan(0);
  });

  it('共用体の枝のメンバは、枝を載せる宣言の所属へ合流する', () => {
    // `CraftingInput` は無名の型リテラルの共用体で、どの枝も `kind` を持つ。
    const kinds = reported('src/analysis/CraftingStep.ts', 'kind').filter(
      (each) => each.owner !== 'CraftingStep',
    );

    expect(kinds.length, '枝の `kind` が一覧に出ていない').toBeGreaterThan(1);
    expect(kinds.map((each) => each.owner)).toEqual(kinds.map(() => 'CraftingInput'));
  });

  it('無名の型リテラルのメンバの読み手は、囲むトップレベル宣言の外かで見る', () => {
    // `PropertyRange.endOf` が返すリテラルの `inward` を読むのは、同じクラスの `inwardFrom` だけ。
    const [inward] = reported('src/domain/PropertyDef.ts', 'inward');

    expect(inward.owner).toBe('PropertyRange.endOf');
    expect(inward.container).toBe('PropertyRange');
    expect(inward.referencedInOwnFileOutsideOwner, '所属の名前（入れ子）と索引の粒を比べている').toBe(false);
  });
});
