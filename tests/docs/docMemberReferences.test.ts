import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isVerbatimRecord, trackedDocs, trackedFiles } from '../../scripts/docScope.mjs';

/**
 * 説明が挙げる名前が、今も在るものを指しているかの検査。**説明だけが古い名前で取り残される**
 * ——メソッドを畳んだり改名したりしたときに、それを指していた別ファイルの説明は型検査にも
 * lintにも掛からない。初回の全数調査では、既に無いメソッドを指す説明がコメントに8件・
 * `docs/` に10件見つかった。
 *
 * 見方は2つあり、どちらが赤くなったかで直す場所が変わるので `it` を分けてある。
 *
 * 1. **`Xxx.yyy`・`Xxx.Yyy` の形**（下の「今は無い名前を指していない」）。見るのは `src`・`tests` の `.ts` の
 *    コメントと、{@link DOCUMENTS} の全文。判定は「**その所有者が**そのメンバーを持っていないなら、
 *    指す先が無い」（hasMember）。読み手が辿れることだけを見るので、公開・非公開は問わない。
 *    この形で書けば今も在るものを指している、と読む——**過去に在ったものを語る箇所での書き方**は
 *    `DocumentStyle.md` 5節「今は無い名前」。
 *    **ファイル名は参照ではない。** `ClimateSystem.md` のような書き方が `docs/` の大半を占めるので、
 *    リポジトリに在るファイルの名前と一致するものを除く。拡張子の一覧では弾かない——一覧のほうが
 *    古びて、増えた拡張子に気づけないまま素通しになる。
 *    **所有者がこのリポジトリのものでなければ、何も言わない**（ownedHere）。`Node.js` の `js` も
 *    `Math.trunc` の `trunc` も、在るかどうかを決めているのはこのリポジトリではないので、
 *    「メンバーがコードに無い」は何の証拠にもならない。所有者が偶然コードに出てくるかどうかで
 *    判定が入れ替わるのを避ける——`ts.Node` を1箇所で使い始めた途端、文書の `Node.js` が
 *    参照として読まれた。
 * 2. **ファイルと名前が並んでいる形**（下の「ファイルと並べて挙げた名前が、そのファイルに在る」）。
 *    1 は所有者の無い裸の名前（`start`・`build`）を見られない——`docs/` の散文にいくらでも出てくる
 *    普通の英単語なので、一律に見ると誤検知になる。ただし文書が `Foo.ts` とその中身を並べて書いて
 *    いる箇所なら、**指す先のファイルが決まっている**ので裸のままでも判定できる。
 */

const ROOT = resolve(__dirname, '../..');

function filesIn(dir: string, extension: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) found.push(...filesIn(rel, extension));
    else if (entry.endsWith(extension)) found.push(rel);
  }
  return found;
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf-8');
}

/** 説明が書かれている行と、原文での行番号。 */
type ProseLine = { readonly line: number; readonly text: string };

/** `.ts` で説明が書かれているのはコメントの行だけ。 */
function commentLines(text: string): ProseLine[] {
  const kept: ProseLine[] = [];
  let inBlock = false;
  text.split('\n').forEach((raw, index) => {
    const trimmed = raw.trim();
    if (trimmed.startsWith('/*')) inBlock = true;
    const isComment = inBlock || trimmed.startsWith('//') || trimmed.startsWith('*');
    if (trimmed.includes('*/')) inBlock = false;
    if (isComment) kept.push({ line: index + 1, text: raw });
  });
  return kept;
}

/** `.md` は全体が説明。コードフェンスの中の例も、実在の名前を指しているなら同じに見る。 */
function allLines(text: string): ProseLine[] {
  return text.split('\n').map((raw, index) => ({ line: index + 1, text: raw }));
}

/** コメントを取り除いた本文（文字列リテラルはそのまま残す——名前を文字列で持つ宣言もあるため）。 */
function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * 参照の書き方。所有者もメンバーも大文字始まりでよい——型も定数も参照になる
 * （`PlayScreenView.ObjectWindowView`・`SitePlacer.ISLAND_RADIUS`）。**メンバーを小文字に限ると、
 * 小文字始まりへ改名された後も大文字のまま残っている名前が、丸ごと網から外れる。**
 */
const REFERENCE = /\b([A-Z][A-Za-z0-9]*)\.([A-Za-z][A-Za-z0-9_]*)\b\.?/g;

const SOURCES = [...filesIn('src', '.ts'), ...filesIn('tests', '.ts')];

/**
 * 名前を挙げている文書。**射程は `docs/` に閉じない**——`.claude/**` の係の本文もルートの
 * `CLAUDE.md` も `Xxx.yyy` の形で実装を指しており、畳めば同じように嘘になる。**どこまで掛かるかを
 * 決めるのは [`docScope.mjs`](../../scripts/docScope.mjs)**——同じ規約（`DocumentStyle.md` 5節）を
 * 課す `docReferences.test.ts` と同じ1つ。
 */
const DOCUMENTS = trackedDocs(ROOT).filter((rel) => !isVerbatimRecord(rel));
const TARGETS = [
  { files: SOURCES, proseOf: commentLines },
  { files: DOCUMENTS, proseOf: allLines },
];

const CODE = SOURCES.map((rel) => codeOnly(read(rel))).join('\n');
const foundInCode = new Map<string, boolean>();
function appearsInCode(name: string): boolean {
  const cached = foundInCode.get(name);
  if (cached !== undefined) return cached;
  const found = new RegExp(`\\b${name}\\b`).test(CODE);
  foundInCode.set(name, found);
  return found;
}

const TRACKED_PATHS = trackedFiles(ROOT);

/** git の管理下にあるファイルの名前（ディレクトリを除いた最後の部分）。 */
const FILE_NAMES = new Set(TRACKED_PATHS.map((path) => basename(path)));

/** 名前を宣言している語。この後ろに続く名前が、このリポジトリの持ち物。 */
const DECLARES = '(?:class|interface|type|enum|function|namespace|const|let|var)';

/**
 * その名前をこのリポジトリが持っているか——**宣言そのものか、モジュール**（`NewGame.startNewGame`
 * のように、ファイル名で呼ぶ書き方）。持っていない名前（Phaser・JSの組み込み・文書の例の`Foo`）の
 * メンバーが在るかは、このリポジトリが決めていないので答えられない。
 */
function ownedHere(name: string): boolean {
  return FILE_NAMES.has(`${name}.ts`) || new RegExp(`\\b${DECLARES}\\s+${name}\\b`).test(CODE);
}

/**
 * 文書に書かれたファイル参照から、実ファイルの相対パスへ。パス全体でも名前だけでも引ける。
 * 名前が複数のファイルで重なっているものは、どれを指すか決まらないので引けない（`null`）。
 */
const TS_FILE_BY_REFERENCE = new Map<string, string | null>();
for (const path of TRACKED_PATHS.filter((path) => path.endsWith('.ts'))) {
  TS_FILE_BY_REFERENCE.set(path, path);
  const name = basename(path);
  TS_FILE_BY_REFERENCE.set(name, TS_FILE_BY_REFERENCE.has(name) ? null : path);
}

function tsFileOf(reference: string): string | null {
  return TS_FILE_BY_REFERENCE.get(reference) ?? TS_FILE_BY_REFERENCE.get(basename(reference)) ?? null;
}

/** ファイルのどの面を見るか。`all` はコメントも含む全部、`code` はコメントを落とした残り。 */
type Face = 'all' | 'code';

/** その面のファイルの中身。面ごとに1度だけ読む。 */
const contentByFace = new Map<string, string>();
function contentOf(file: string, face: Face): string {
  const key = `${face} ${file}`;
  let content = contentByFace.get(key);
  if (content === undefined) {
    content = face === 'code' ? codeOnly(read(file)) : read(file);
    contentByFace.set(key, content);
  }
  return content;
}

/** その名前が、そのファイルのその面に現れるか。どの面で足りるかは、問いごとに呼び手が選ぶ。 */
function appearsIn(file: string, name: string, face: Face): boolean {
  return new RegExp(`\\b${name}\\b`).test(contentOf(file, face));
}

/**
 * その名前を宣言しているファイル。**1箇所に決まらないもの（同じ名前を複数のファイルが宣言して
 * いる）は持たない**——どれの持ち物かが決まらないので、メンバーが在るかも答えられない。
 */
const DECLARING_FILE = new Map<string, string | null>();
const DECLARATION = new RegExp(`\\b${DECLARES}\\s+([A-Z][A-Za-z0-9]*)\\b`, 'g');
for (const rel of SOURCES) {
  for (const [, name] of contentOf(rel, 'code').matchAll(DECLARATION)) {
    DECLARING_FILE.set(name, !DECLARING_FILE.has(name) || DECLARING_FILE.get(name) === rel ? rel : null);
  }
}

/**
 * **所有者がそのメンバーを持っているか。** 所有者のファイルが決まるなら、その中だけを見る
 * ——コード全体では、別の型が持つ同名のメンバーや、無関係な文字列に同じ語が在るだけで素通りする
 * （在りもしない `AxisDef` の `Range` が、別のテストの `describe` に渡した文字列の中の `Range` で
 * 在ることにされていた）。
 *
 * ファイルは**宣言の在り処**から引き、決まらなければ所有者と同名の `.ts` で引く——型の名前と
 * ファイル名は揃っていないことがあり（`PassiveEffectGate` は `PassiveEffect.ts`）、名前だけで
 * 引くと、揃っている所有者しか所有者として見られない。どちらでも決まらないときだけ、従来どおり
 * コード全体で足りるとする。
 *
 * 見る面はどちらもコメント以外。**コメントを含めると、改名前の名前を語っているコメントが同じ
 * ファイルに残っているだけで、消えたメンバーが在ることになる**——改名への追随はコメントのほうが
 * 遅れるので、そこを証拠にすると追随漏れどうしが互いを裏書きする。
 */
function hasMember(owner: string, member: string): boolean {
  const file = DECLARING_FILE.get(owner) ?? tsFileOf(`${owner}.ts`);
  return file === null ? appearsInCode(member) : appearsIn(file, member, 'code');
}

/** 文書がファイルと並べて挙げた名前と、その指す先。 */
type FileMember = { readonly file: string; readonly name: string };

/** ファイルを単独で置いた括弧。並んでいる名前は、括弧の直前に接しているもの。 */
const NAME_THEN_FILE = /`([^`]+)`\s*[（(]\s*`([\w./-]+\.ts)`\s*[）)]/g;
/** ファイルに続けて中身を挙げる括弧。並んでいる名前は、括弧の中のもの。 */
const FILE_THEN_NAMES = /`([\w./-]+\.ts)`\s*[（(]([^）)]*)[）)]/g;
/** 図の1行の末尾に、空白で切り離して置かれたファイル。並んでいる名前は、その行が呼んでいるもの。 */
const CALL_THEN_FILE = /^(.*?\S)\s\s+([\w./-]+\.ts)\b/;
const QUOTED = /`([^`]+)`/g;
const NAME = /[A-Za-z_][A-Za-z0-9_]*/;

/** 名前として見るのは最初の識別子だけ（`placeSites(scope)` なら `placeSites`）。 */
function nameIn(text: string): string | null {
  return NAME.exec(text)?.[0] ?? null;
}

/**
 * バッククォートの中身のうち、名前を挙げているもの。ファイル参照そのものは名前ではない。
 *
 * **語を空白で並べたものも名前ではない**（`npm test`）。囲みは「これは識別子だ」だけを表す記法では
 * なく、打つコマンドにも付くので、**先頭の語だけを取ると、その行が挙げていない名前を指し先へ
 * 突き合わせることになる**（`npm test`（`Foo.test.ts`）で `npm` が `Foo.test.ts` のメンバーとして
 * 挙がる）。引数の並びは空白で切れないので、ここで落ちるのは句だけ。
 */
function quotedName(quoted: string): string | null {
  if (quoted.includes('/') || /\.[A-Za-z]+$/.test(quoted)) return null;
  if (/^[A-Za-z_][A-Za-z0-9_]*\s/.test(quoted)) return null;
  return nameIn(quoted);
}

/** セル全体が1つのファイル参照になっているとき、その実ファイル。 */
function cellFile(cell: string): string | null {
  const only = /^\s*`([\w./-]+\.ts)`\s*$/.exec(cell);
  return only === null ? null : tsFileOf(only[1]);
}

/**
 * その行がファイルと名前を並べて書いている組。並べ方は、括弧で注釈する（散文・見出し）・表の同じ行に
 * 置く（索引の表）・図の行末に添える（呼び出し関係の図）の3つ。
 */
function fileMembersOn(text: string, insideFence: boolean): FileMember[] {
  const found: FileMember[] = [];
  const add = (file: string | null, name: string | null): void => {
    if (file !== null && name !== null) found.push({ file, name });
  };

  if (insideFence) {
    const annotated = CALL_THEN_FILE.exec(text);
    if (annotated !== null) add(tsFileOf(annotated[2]), nameIn(annotated[1]));
    return found;
  }

  for (const match of text.matchAll(NAME_THEN_FILE)) {
    add(tsFileOf(match[2]), quotedName(match[1]));
  }
  for (const match of text.matchAll(FILE_THEN_NAMES)) {
    const file = tsFileOf(match[1]);
    for (const quoted of match[2].matchAll(QUOTED)) add(file, quotedName(quoted[1]));
  }

  if (!text.trim().startsWith('|')) return found;
  const cells = text.split('|').slice(1, -1);
  const fileCells = cells.flatMap((cell, index) => (cellFile(cell) === null ? [] : [index]));
  // 1行に2つ以上のファイルが単独で置かれていたら、どちらが持つ名前かは決まらない。
  if (fileCells.length !== 1) return found;
  const file = cellFile(cells[fileCells[0]]);
  cells.forEach((cell, index) => {
    if (index === fileCells[0]) return;
    for (const quoted of cell.matchAll(QUOTED)) add(file, quotedName(quoted[1]));
  });
  return found;
}

describe('説明の参照', () => {
  it('今は無い名前を指していない', () => {
    const dangling: string[] = [];
    for (const { files, proseOf } of TARGETS) {
      for (const rel of files) {
        for (const { line, text } of proseOf(read(rel))) {
          for (const match of text.matchAll(REFERENCE)) {
            // `WorldCodex.schema.json`のように後ろが続くものはファイル名で、コードの中の名前ではない。
            if (match[0].endsWith('.')) continue;
            const [whole, owner, member] = match;
            if (FILE_NAMES.has(whole)) continue;
            if (!ownedHere(owner) || hasMember(owner, member)) continue;
            dangling.push(`${rel}:${line} ${whole}`);
          }
        }
      }
    }

    expect(
      dangling,
      '説明が指す名前を、その所有者が持っていない（過去に在ったものを語る箇所なら、所有者と' +
        `メンバーを切り離して書く——DocumentStyle.md 5節）:\n${dangling.join('\n')}`,
    ).toEqual([]);
  });

  it('ファイルと並べて挙げた名前が、そのファイルに在る', () => {
    const missing: string[] = [];
    for (const rel of DOCUMENTS) {
      let insideFence = false;
      for (const { line, text } of allLines(read(rel))) {
        if (text.trim().startsWith('```')) {
          insideFence = !insideFence;
          continue;
        }
        for (const { file, name } of fileMembersOn(text, insideFence)) {
          // **コメントも見る**——YAMLのプロパティ名（`ambient_brightness`）はそのファイルを説明する
          // コメントにしか現れないことがあり、それでも「そのファイルが扱っている」ことに変わりはない。
          // ここが見たいのは指す先が在るかで、名前がコードの語彙かどうかではない。
          if (appearsIn(file, name, 'all')) continue;
          missing.push(`${rel}:${line} ${name}（${file} に無い）`);
        }
      }
    }

    expect(
      missing,
      `文書がファイルと並べて挙げた名前が、そのファイルに無い:\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  it('`docs/` の外の文書も、走査に入っている', () => {
    // 走査が `docs/` だけだった頃、`.claude/**` の係の本文が挙げる名前は誰も見ていなかった
    // （#1948）。`docs/` の文書だけで数は足りるので、外側が落ちても上の検査は緑になる。
    const outside = DOCUMENTS.filter((rel) => !rel.startsWith(`docs${sep}`));
    expect(outside, '走査が `docs/` の中だけへ戻っている').not.toEqual([]);
  });

  it('囲みの中が名前か句かで、ファイルと並んだ組を採る／採らない', () => {
    // 句の先頭の語を名前として採ると、その行が挙げていない名前が指し先へ突き合わされる。
    const asName = fileMembersOn('`placeSites`（`SitePlacer.ts`）', false);
    expect(asName.map(({ name }) => name)).toEqual(['placeSites']);
    expect(fileMembersOn('`npm test`（`SitePlacer.ts`）', false)).toEqual([]);
  });
});
