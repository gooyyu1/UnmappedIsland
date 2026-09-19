// 識別子の出現のうち、**値を読んでいるもの**だけをファイル単位で数えた索引。
//
// `declarationInventory.mjs` の参照の数え方（識別子の出現）は書きと読みを区別しないので、
// **書かれてはいるが誰も読まないフィールド**を「使われている」と数える。`MotionPlan.discards` は
// 宣言と、返り値のオブジェクトリテラルのキーで自分のファイルに2回現れるのに、読み手は1人も
// 居なかった。ここが除くのはその2つ——**宣言の名前と、書き込みの位置**。
//
// 型解決ではなく名前の一致で数える粗いもので、ずれは両向きに出る。同じ名前の無関係な識別子を
// 読み手に数え（過大）、`obj['name']` のような文字列での読みは数えない（過小）。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/** そのファイルの構文木。ファイル名にはリポジトリ相対のパスを載せる（索引がこれを持つ）。 */
function parseSource(root, file) {
  const text = readFileSync(path.join(root, file), 'utf8');
  return ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
}

/** その識別子が、宣言そのものの名前か。 */
function isDeclarationName(node, parent) {
  const declarations = [
    ts.isPropertyDeclaration,
    ts.isPropertySignature,
    ts.isMethodDeclaration,
    ts.isMethodSignature,
    ts.isGetAccessor,
    ts.isSetAccessor,
    ts.isEnumMember,
    ts.isParameter,
    ts.isVariableDeclaration,
    ts.isFunctionDeclaration,
    ts.isClassDeclaration,
    ts.isInterfaceDeclaration,
    ts.isTypeAliasDeclaration,
    ts.isEnumDeclaration,
    ts.isModuleDeclaration,
  ];
  return declarations.some((is) => is(parent)) && parent.name === node;
}

/**
 * その識別子が、値を読んでいる位置に在るか。
 *
 * 読みでないのは3つ——**宣言の名前**（`readonly discards: readonly C[]`）、**オブジェクト
 * リテラルのキー**（`{ discards: ... }`・`{ discards }`）、**代入の左辺のプロパティ**
 * （`this.discards = ...`）。分割代入（`const { discards } = plan`）は読み。
 */
function isReadPosition(node) {
  const parent = node.parent;
  if (parent === undefined) return true;
  if (isDeclarationName(node, parent)) return false;
  if ((ts.isPropertyAssignment(parent) || ts.isShorthandPropertyAssignment(parent)) && parent.name === node)
    return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
    const assignment = parent.parent;
    if (
      ts.isBinaryExpression(assignment) &&
      assignment.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      assignment.left === parent
    )
      return false;
  }
  return true;
}

/**
 * 名前ごとに、**その名前を読んでいるファイル**を集めた索引。宣言と同じファイルからの読みも数える
 * ——問うているのは「誰かが読んでいるか」で、どこから読んでいるかではない。
 */
export function buildReadIndex(root, files) {
  const reads = new Map();
  for (const file of files) {
    const walk = (node) => {
      if ((ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) && isReadPosition(node)) {
        const seen = reads.get(node.text) ?? new Set();
        seen.add(file);
        reads.set(node.text, seen);
      }
      ts.forEachChild(node, walk);
    };
    ts.forEachChild(parseSource(root, file), walk);
  }
  return reads;
}
