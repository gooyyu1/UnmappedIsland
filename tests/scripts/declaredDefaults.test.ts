import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { trackedFiles } from '../../scripts/docScope.mjs';

/**
 * モジュールの口が、隣の `.d.mts` と同じ呼び方を許していることの検査。
 *
 * **分割代入の引数に `= {}` の既定を持つ関数は、型でも引数を任意（`deps?:`）にする。逆も同じ。**
 * 型が必須で実装が既定を持つと、その既定は型の上から呼べず、既定で動くかを誰も確かめない
 * （`issueBody` は既定で呼ぶと、必須の `warn` が `undefined` のまま呼ばれて落ちる形だった。issue #1977）。
 * 型が任意で実装が既定を持たないと、型どおり引数を省いた呼び手が分割代入で落ちる。
 */

const ROOT = resolve(__dirname, '../..');

/** 分割代入の引数を1つ取る export 関数と、その引数に `= {}` の既定があるか。 */
function destructuringExports(source: string): { name: string; hasDefault: boolean }[] {
  const lines = source.split(/\r?\n/);
  const found: { name: string; hasDefault: boolean }[] = [];
  lines.forEach((line, index) => {
    const head = /^export (?:async )?function (\w+)\(\{(.*)$/.exec(line);
    if (head === null) return;
    const oneLine = /\}( = \{\})?\) \{$/.exec(head[2]);
    if (oneLine !== null) {
      found.push({ name: head[1], hasDefault: oneLine[0].startsWith('} = {}') });
      return;
    }
    const close = lines.slice(index + 1).find((next) => /^\}( = \{\})?\) \{$/.test(next));
    if (close === undefined) throw new Error(`${head[1]} の引数の閉じが見つからない`);
    found.push({ name: head[1], hasDefault: close.startsWith('} = {}') });
  });
  return found;
}

/** 型の宣言で、最初の引数が任意か。宣言が無ければ `undefined`。 */
function declaredOptional(types: string, name: string): boolean | undefined {
  const match = new RegExp(`export (?:declare )?function ${name}(?:<[^(]*>)?\\(\\s*(\\w+)(\\??):`).exec(
    types,
  );
  return match === null ? undefined : match[2] === '?';
}

const PAIRS = trackedFiles(ROOT, '*.mjs')
  .filter((rel) => existsSync(join(ROOT, rel.replace(/\.mjs$/, '.d.mts'))))
  .flatMap((rel) => {
    const types = readFileSync(join(ROOT, rel.replace(/\.mjs$/, '.d.mts')), 'utf-8');
    return destructuringExports(readFileSync(join(ROOT, rel), 'utf-8')).flatMap(({ name, hasDefault }) => {
      const optional = declaredOptional(types, name);
      return optional === undefined ? [] : [{ where: `${rel} の ${name}`, hasDefault, optional }];
    });
  });

describe('実装の既定と型', () => {
  // 読み取りの形が崩れて1件も拾えなくなると、下は全部黙って緑になる。
  it('突き合わせる口が在り、既定を持つものも持たないものも拾えている', () => {
    expect(PAIRS.some((pair) => pair.hasDefault)).toBe(true);
    expect(PAIRS.some((pair) => !pair.hasDefault)).toBe(true);
  });

  it.each(PAIRS)('$where は、既定の有無と型の任意が一致している', ({ hasDefault, optional }) => {
    expect(optional).toBe(hasDefault);
  });
});
