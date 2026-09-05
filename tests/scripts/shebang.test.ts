import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `scripts/*.mjs` の先頭にシェバングを置かないことの検査。
 *
 * **CRLFの作業ツリーでは、シェバング付きの `.mjs` を Vitest から `import` できない。** Vite の
 * 前処理がシェバングを剥がすときに `\r` を残し、構文誤り（`Invalid or unexpected token`）になる。
 * CIはLFでチェックアウトするので緑のままで、**Windowsで `npm test` を走らせた者にしか見えない。**
 *
 * どのスクリプトも `package.json` から `node scripts/....mjs` として呼ばれ、実行ビットも立って
 * いないので、シェバングは1度も使われていない。
 */

const SCRIPTS = resolve(__dirname, '../../scripts');

const MODULES = readdirSync(SCRIPTS).filter((name) => name.endsWith('.mjs'));

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
 * 試験がPATHへ置く身代わりのシェバングは `#!/bin/bash`。**`#!/usr/bin/env bash` にすると、身代わりを
 * 呼ぶたびに `env` のプロセスが1つ余分に起きる。**
 *
 * これらの試験は1件で外部プロセスを数十個起こし、Windowsではその生成が1回10〜30msかかる。`env` の
 * 1段だけで `tests/scripts/**` 全体が1割ほど遅くなっていた。本物のスクリプトは可搬性のために
 * `#!/usr/bin/env bash` のままでよい——身代わりは走る場所がこのリポジトリの試験しかない。
 */
describe('試験が書く身代わりのスクリプト', () => {
  const TESTS = resolve(__dirname, '..');
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      // 本テスト自身は、禁じている綴りを説明のために持つ。
      return name.endsWith('.test.ts') && path !== __filename ? [path] : [];
    });

  // 集める側が黙って0件になると、**1つも見ていない状態と、全部が正しい状態が同じ緑**になる。
  it('検査する対象が在る', () => {
    expect(files(TESTS).length).toBeGreaterThan(0);
  });

  it('`#!/usr/bin/env bash` で始まる身代わりを書かない', () => {
    const found = files(TESTS).filter((path) => readFileSync(path, 'utf-8').includes('#!/usr/bin/env bash'));

    expect(found.map((path) => path.slice(TESTS.length + 1))).toEqual([]);
  });
});
