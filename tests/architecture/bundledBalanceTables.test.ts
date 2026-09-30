import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { ROOT, sourcesIn } from '../support/sourceFiles';

/**
 * 同梱の定義から収支表を組む場所の見張り（`bundledBalanceTables` の断り、tests/support/worldCodexFiles.ts）。
 *
 * 1回の組み立てが1件あたりの上限（`vite.config.ts` の `testTimeout`）の4割ほどを使うので、検査の
 * 本体で組むと、混んだ回に**どの検査が越えるかが回ごとに変わる**（issue #2358・#2446）。越えた検査へ
 * 上限を名乗らせて回っても、次に数パーセント遅くなる変更で別の検査が落ちる。
 */

/** 最も外側の呼び先の名前（`describe.each(...)(...)` なら `describe`）。 */
function rootCalleeName(call: ts.CallExpression): string | undefined {
  let callee: ts.Expression = call.expression;
  for (;;) {
    if (ts.isIdentifier(callee)) return callee.text;
    if (ts.isPropertyAccessExpression(callee)) callee = callee.expression;
    else if (ts.isCallExpression(callee)) callee = callee.expression;
    else return undefined;
  }
}

/** `describe` の本体として渡された関数か。**本体は収集の時に走る**ので、どの検査の上限にも掛からない。 */
function isDescribeBody(fn: ts.Node): boolean {
  const parent = fn.parent;
  return ts.isCallExpression(parent) && parent.arguments.includes(fn as ts.Expression)
    ? rootCalleeName(parent) === 'describe'
    : false;
}

/** その呼び出しを囲む関数（内側から）。 */
function enclosingFunctions(node: ts.Node): ts.FunctionLikeDeclaration[] {
  const found: ts.FunctionLikeDeclaration[] = [];
  for (let current = node.parent; !ts.isSourceFile(current); current = current.parent) {
    if (ts.isFunctionLike(current)) found.push(current as ts.FunctionLikeDeclaration);
  }
  return found;
}

interface Call {
  readonly file: string;
  readonly line: number;
  readonly call: ts.CallExpression;
}

/** 名前で呼んでいる箇所（`tests/` 以下の全部）。 */
function callsOf(name: string): Call[] {
  const found: Call[] = [];
  for (const rel of sourcesIn('tests')) {
    const source = readFileSync(join(ROOT, rel), 'utf-8');
    if (!source.includes(name)) continue;
    const file = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true);
    const walk = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name)
        found.push({
          file: rel,
          line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
          call: node,
        });
      ts.forEachChild(node, walk);
    };
    walk(file);
  }
  return found;
}

const where = ({ file, line }: Call): string => `${file}:${line}`;

describe('同梱の定義の収支表を組む場所', () => {
  it('同梱の定義を読むファイルが、収支表を自分で組んでいない', () => {
    // 覚え込みの中身そのもの（`bundledBalanceTables` の本体）は除く。
    const readsBundled = new Set(callsOf('bundledCodex').map((call) => call.file));
    const offenders = callsOf('buildBalanceTables').filter(
      (call) =>
        readsBundled.has(call.file) &&
        !enclosingFunctions(call.call).some(
          (fn) => ts.isFunctionDeclaration(fn) && fn.name?.text === 'bundledBalanceTables',
        ),
    );

    expect(offenders.map(where), '`bundledBalanceTables()` を使う').toEqual([]);
  });

  it('共有の収支表を、モジュールか `describe` の直下で受け取っている', () => {
    const offenders = callsOf('bundledBalanceTables').filter(
      (call) => !enclosingFunctions(call.call).every(isDescribeBody),
    );

    expect(
      offenders.map(where),
      '`it`・フック・補助関数の中で呼ぶと、ワーカーで最初に呼んだ検査が組み立てを丸ごと払う',
    ).toEqual([]);
  });
});
