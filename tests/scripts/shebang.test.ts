import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { trackedFiles } from '../../scripts/docScope.mjs';

/**
 * `.mjs` の先頭にシェバングを置かないことの検査。
 *
 * **CRLFの作業ツリーでは、シェバング付きの `.mjs` を Vitest から `import` できない。** Vite の
 * 前処理がシェバングを剥がすときに `\r` を残し、構文誤り（`Invalid or unexpected token`）になる。
 * CIはLFでチェックアウトするので緑のままで、**Windowsで `npm test` を走らせた者にしか見えない。**
 * **実行ビットが立っていればカーネルも1行目を読む**ので、そちらは `env: 'node\r'` で起動できない。
 *
 * どのモジュールも `node <path>.mjs` として呼ばれ（`package.json`・隣のシェルの入口・skill の手順から）、
 * 実行ビットも立っていないので、シェバングは1度も使われていない。
 *
 * **視野は追跡しているもの全部で、`scripts/` に閉じない**——`.claude/skills/**` にも `node` から
 * 呼ぶモジュールが在り、そこはこの検査の外だったのでシェバングが残っていた（issue #2171）。
 */

const ROOT = resolve(__dirname, '../..');

const MODULES = trackedFiles(ROOT, '*.mjs');

describe('リポジトリのモジュール', () => {
  it('検査する対象が在る', () => {
    expect(MODULES.length).toBeGreaterThan(0);
  });

  // 置き場を絞っていたせいで漏れた過去が在るので、`scripts/` の外も見ていることを見張る。
  it('`scripts/` の外のモジュールも見ている', () => {
    expect(MODULES.filter((rel) => !rel.startsWith(`scripts${sep}`))).not.toEqual([]);
  });

  it.each(MODULES)('%s がシェバングで始まっていない', (rel) => {
    const head = readFileSync(join(ROOT, rel), 'utf-8').slice(0, 2);
    expect(head, `${rel} の先頭にシェバングが在る`).not.toBe('#!');
  });
});

/**
 * 試験がPATHへ置く身代わりのシェバングを、直に書かないことの検査。理由と正しい書き方は
 * [`STUB_SHEBANG`](../support/stubShebang.ts)。
 *
 * **綴りを1つだけ禁じても、次は別の綴りで書かれる。** `#!` の直書きそのものを止めて、
 * 在り処を決める場所を1つに寄せる。
 */
describe('試験が書く身代わりのスクリプト', () => {
  const TESTS = resolve(__dirname, '..');
  /** 在り処を決める側と、禁じている綴りを説明のために持つ本テスト自身は対象外。 */
  const EXEMPT = new Set([__filename, resolve(TESTS, 'support', 'stubShebang.ts')]);
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return name.endsWith('.ts') && !EXEMPT.has(path) ? [path] : [];
    });

  // 集める側が黙って0件になると、**1つも見ていない状態と、全部が正しい状態が同じ緑**になる。
  it('検査する対象が在る', () => {
    expect(files(TESTS).length).toBeGreaterThan(0);
  });

  it('シェバングを直に書かず、`STUB_SHEBANG` から取る', () => {
    const found = files(TESTS).filter((path) => readFileSync(path, 'utf-8').includes('#!'));

    expect(found.map((path) => path.slice(TESTS.length + 1))).toEqual([]);
  });
});
