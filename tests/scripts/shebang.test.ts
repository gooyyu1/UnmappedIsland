import { readFileSync, readdirSync } from 'node:fs';
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
