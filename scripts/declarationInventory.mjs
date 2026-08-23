#!/usr/bin/env node
// src配下の全宣言（クラス・関数・変数・型・メンバー）を機械抽出して一覧にする。
//
// 定義位置のリファクタリング（review/placement/）で、**宣言がどこへ動いたかを差分で追う**ために使う。
// 既定の並びは所属と名前で、行番号では並べない——行番号で並べると、1つ移動させただけで後続が
// すべてずれて差分が読めなくなる。所属と名前で並べておけば、移動は1行の変化として出る。
//
// 参照数は既定では出さない。何かを1つ動かすと無関係な行の数字まで動いて差分が汚れるため、
// 調べたいときだけ --refs で足す。--refs は tests/ と scripts/ からの参照も数える
// （src だけで数えると、テストからしか使われていない公開を「未使用」と読み違える）。
//
// 使い方:
//   node scripts/declarationInventory.mjs            所属・名前順の一覧（差分向き）
//   node scripts/declarationInventory.mjs --summary  ディレクトリ別の件数
//   node scripts/declarationInventory.mjs --refs     参照ファイル数つき
//   node scripts/declarationInventory.mjs --json     JSON（他のスクリプトから読む用）

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 参照数を数えるときだけ見る、srcの外の置き場。 */
const REFERENCE_ROOTS = ['tests', 'scripts'];

/** 1行に載せるシグネチャの上限。これを超えると読み手が追えないので端を落とす。 */
const SIGNATURE_LIMIT = 200;

function listSources(dir, extensions) {
  const stdout = execFileSync('git', ['ls-files', '--', dir], { encoding: 'utf8' });
  return stdout
    .split('\n')
    .filter((file) => file !== '' && extensions.some((extension) => file.endsWith(extension)));
}

function parse(file) {
  const text = readFileSync(path.join(ROOT, file), 'utf8');
  return ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
}

/**
 * 識別子の出現をファイル単位で数えた索引。型解決ではなく名前の一致で数える粗いもので、
 * `name` や `update` のようなありふれた名前では過大に出る。**0件のほうが信用できる**。
 */
function buildOccurrenceIndex(files) {
  const occurrences = new Map();
  for (const file of files) {
    const walk = (node) => {
      if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
        const seen = occurrences.get(node.text) ?? new Set();
        seen.add(file);
        occurrences.set(node.text, seen);
      }
      ts.forEachChild(node, walk);
    };
    ts.forEachChild(parse(file), walk);
  }
  return occurrences;
}

function modifiersOf(node) {
  const keywords = {
    [ts.SyntaxKind.PrivateKeyword]: 'private',
    [ts.SyntaxKind.ProtectedKeyword]: 'protected',
    [ts.SyntaxKind.StaticKeyword]: 'static',
    [ts.SyntaxKind.ReadonlyKeyword]: 'readonly',
    [ts.SyntaxKind.ExportKeyword]: 'export',
    [ts.SyntaxKind.AbstractKeyword]: 'abstract',
  };
  const modifiers = ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : [];
  return modifiers.map((modifier) => keywords[modifier.kind]).filter((name) => name !== undefined);
}

function nameOf(node) {
  if (node.name === undefined) return '(無名)';
  return ts.isIdentifier(node.name) || ts.isPrivateIdentifier(node.name) || ts.isStringLiteral(node.name)
    ? node.name.text
    : node.name.getText();
}

/** 宣言の本文を落として、シグネチャだけを1行に畳む。 */
function signatureOf(source, node) {
  const members = node.members;
  const body = node.body ?? node.initializer;
  let end = node.end;
  if (members !== undefined) end = members.length > 0 ? members.pos : node.end;
  else if (body !== undefined && ts.isBlock(body)) end = body.pos;

  const text = source.text
    .slice(node.getStart(source), end)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[{(]\s*$/, '')
    .trim();
  return text.length > SIGNATURE_LIMIT ? `${text.slice(0, SIGNATURE_LIMIT - 3)}...` : text;
}

function visibilityOf(modifiers, name) {
  if (modifiers.includes('private') || name.startsWith('#')) return 'private';
  if (modifiers.includes('protected')) return 'protected';
  return 'public';
}

/**
 * その宣言に付いているドキュメントコメントの中身（1行に畳んだもの）。付いていなければ空。
 *
 * **見るのは直前の `/** ... *\/` 1つだけ。** 離れた場所の説明は、その宣言のものとは限らない。
 */
function docOf(source, node) {
  const text = source.getFullText();
  const ranges = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [];
  const last = [...ranges].reverse().find((range) => text.slice(range.pos, range.pos + 3) === '/**');
  if (last === undefined) return '';
  return text
    .slice(last.pos + 3, last.end - 2)
    .split('\n')
    .map((line) => line.replace(/^\s*\*?/, '').trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function memberKindOf(member) {
  if (ts.isPropertyDeclaration(member) || ts.isPropertySignature(member)) return 'field';
  if (ts.isMethodDeclaration(member) || ts.isMethodSignature(member)) return 'method';
  if (ts.isGetAccessor(member)) return 'getter';
  if (ts.isSetAccessor(member)) return 'setter';
  if (ts.isConstructorDeclaration(member)) return 'ctor';
  return undefined;
}

function collectMembers(source, file, owner, members, into) {
  for (const member of members) {
    const kind = memberKindOf(member);
    if (kind === undefined) continue;
    const name = kind === 'ctor' ? 'constructor' : nameOf(member);
    const modifiers = modifiersOf(member);
    into.push({
      file,
      owner,
      kind,
      name,
      visibility: visibilityOf(modifiers, name),
      modifiers,
      line: source.getLineAndCharacterOfPosition(member.getStart(source)).line + 1,
      signature: signatureOf(source, member),
      doc: docOf(source, member),
    });

    // 引数プロパティ（constructor(private readonly x: T)）はフィールドなので、同じ粒で並べる。
    if (kind !== 'ctor') continue;
    for (const parameter of member.parameters) {
      const parameterModifiers = modifiersOf(parameter);
      const isField = parameterModifiers.some((modifier) =>
        ['private', 'protected', 'readonly'].includes(modifier),
      );
      if (!isField) continue;
      into.push({
        file,
        owner,
        kind: 'field',
        name: nameOf(parameter),
        visibility: visibilityOf(parameterModifiers, nameOf(parameter)),
        modifiers: parameterModifiers,
        line: source.getLineAndCharacterOfPosition(parameter.getStart(source)).line + 1,
        signature: signatureOf(source, parameter),
        doc: docOf(source, parameter),
      });
    }
  }
}

function collect(file) {
  const source = parse(file);
  const declarations = [];
  const addTopLevel = (node, kind, name) => {
    const modifiers = modifiersOf(node);
    declarations.push({
      file,
      owner: '(モジュール)',
      kind,
      name,
      visibility: modifiers.includes('export') ? 'export' : 'module',
      modifiers,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      signature: signatureOf(source, node),
      doc: docOf(source, node),
    });
  };

  ts.forEachChild(source, (node) => {
    if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) {
      const name = nameOf(node);
      addTopLevel(node, ts.isClassDeclaration(node) ? 'class' : 'interface', name);
      collectMembers(source, file, name, node.members, declarations);
    } else if (ts.isTypeAliasDeclaration(node)) {
      const name = nameOf(node);
      addTopLevel(node, 'type', name);
      if (ts.isTypeLiteralNode(node.type)) {
        collectMembers(source, file, name, node.type.members, declarations);
      }
    } else if (ts.isEnumDeclaration(node)) {
      addTopLevel(node, 'enum', nameOf(node));
    } else if (ts.isFunctionDeclaration(node)) {
      addTopLevel(node, 'function', nameOf(node));
    } else if (ts.isVariableStatement(node)) {
      // 修飾子は宣言ではなく文に付くので、exportの判定は文のほうから取る。
      const modifiers = modifiersOf(node);
      for (const declaration of node.declarationList.declarations) {
        const initializer = declaration.initializer;
        const isFunction =
          initializer !== undefined &&
          (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer));
        declarations.push({
          file,
          owner: '(モジュール)',
          kind: isFunction ? 'function' : 'const',
          name: nameOf(declaration),
          visibility: modifiers.includes('export') ? 'export' : 'module',
          modifiers,
          line: source.getLineAndCharacterOfPosition(declaration.getStart(source)).line + 1,
          signature: signatureOf(source, declaration),
          // 説明は文（`const X = ...`）の上に書かれるので、宣言ではなく文の側から取る。
          doc: docOf(source, node),
        });
      }
    }
  });
  return declarations;
}

function withReferences(declarations, occurrences) {
  return declarations.map((declaration) => {
    const seen = occurrences.get(declaration.name.replace(/^#/, '')) ?? new Set();
    const elsewhere = [...seen].filter((file) => file !== declaration.file);
    return {
      ...declaration,
      referencingFiles: elsewhere.length,
      referencedOnlyByTests: elsewhere.length > 0 && elsewhere.every((file) => !file.startsWith('src/')),
    };
  });
}

function sortKey(declaration) {
  return `${declaration.owner} ${declaration.name} ${declaration.file}`;
}

function printSummary(declarations) {
  const counts = new Map();
  for (const declaration of declarations) {
    const dir = path.dirname(declaration.file);
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  for (const [dir, count] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(String(count).padStart(5), dir);
  }
  console.log(String(declarations.length).padStart(5), '合計');
}

function referenceNote(declaration) {
  const count = declaration.referencingFiles === 0 ? '参照なし' : `他${declaration.referencingFiles}ファイル`;
  return declaration.referencedOnlyByTests ? `${count}(テストのみ)` : count;
}

function printListing(declarations, showReferences) {
  const separator = '\t';
  for (const declaration of declarations) {
    const flags = declaration.modifiers.length > 0 ? ` [${declaration.modifiers.join(',')}]` : '';
    const columns = [
      `${declaration.owner}::${declaration.name}`,
      declaration.file,
      `${declaration.kind}${flags}`,
      ...(showReferences ? [referenceNote(declaration)] : []),
      declaration.signature,
    ];
    console.log(columns.join(separator));
  }
}

const options = new Set(process.argv.slice(2));
const sources = listSources('src', ['.ts']);
const showReferences = options.has('--refs') || options.has('--json');

let declarations = sources.flatMap(collect);
if (showReferences) {
  const outside = REFERENCE_ROOTS.flatMap((dir) => listSources(dir, ['.ts', '.mts']));
  declarations = withReferences(declarations, buildOccurrenceIndex([...sources, ...outside]));
}
declarations.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

if (options.has('--json')) console.log(JSON.stringify(declarations, undefined, 1));
else if (options.has('--summary')) printSummary(declarations);
else printListing(declarations, options.has('--refs'));
