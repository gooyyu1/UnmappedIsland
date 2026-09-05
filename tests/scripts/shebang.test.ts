import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `scripts/**\/*.mjs` の先頭にシェバングを置かないことの検査。
 *
 * **CRLFの作業ツリーでは、シェバング付きの `.mjs` を Vitest から `import` できない。** Vite の
 * 前処理がシェバングを剥がすときに `\r` を残し、構文誤り（`Invalid or unexpected token`）になる。
 * CIはLFでチェックアウトするので緑のままで、**Windowsで `npm test` を走らせた者にしか見えない。**
 *
 * どのスクリプトも `node scripts/….mjs` として呼ばれ（`package.json` か、隣のシェルの入口から）、
 * 実行ビットも立っていないので、シェバングは1度も使われていない。
 */

const SCRIPTS = resolve(__dirname, '../../scripts');

/** 下の階層まで見る。**`import` される側は増える**ので、視野を直下に留めると番人だけが古くなる。 */
const modules = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return modules(path);
    return name.endsWith('.mjs') ? [path.slice(SCRIPTS.length + 1)] : [];
  });

const MODULES = modules(SCRIPTS);

describe('scripts/ のモジュール', () => {
  it('検査する対象が在る', () => {
    expect(MODULES.length).toBeGreaterThan(0);
  });

  it.each(MODULES)('%s がシェバングで始まっていない', (name) => {
    const head = readFileSync(join(SCRIPTS, name), 'utf-8').slice(0, 2);
    expect(head, `${name} の先頭にシェバングが在る`).not.toBe('#!');
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
