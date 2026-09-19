import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commentsOnly } from '../../scripts/codeComments.mjs';
import {
  COMMENTED_EXTENSIONS,
  isProseData,
  isVerbatimRecord,
  trackedDocs,
  trackedFiles,
} from '../../scripts/docScope.mjs';

/**
 * 説明が挙げる名前が、今も在るものを指しているかの検査。**説明だけが古い名前で取り残される**
 * ——メソッドを畳んだり改名したりしたときに、それを指していた別ファイルの説明は型検査にも
 * lintにも掛からない。初回の全数調査では、既に無いメソッドを指す説明がコメントに8件・
 * `docs/` に10件見つかった。
 *
 * **読む先はどちらの見方も {@link PROSE} の1つ**——コメントを書ける形式のソース全部と、文書の全文。
 * 見方は2つあり、どちらが赤くなったかで直す場所が変わるので `it` を分けてある。
 *
 * 1. **`Xxx.yyy`・`Xxx.Yyy` の形**（下の「今は無い名前を指していない」）。判定は
 *    「**その所有者を宣言しているファイルの中に**その語が
 *    無いなら、指す先が無い」（hasMember）——**型ではなくファイルの単位**で、同居する別の型のメンバー
 *    でも「在る」になる。読み手が辿れることだけを見るので、公開・非公開は問わない。
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
 *    普通の英単語なので、一律に見ると誤検知になる。ただし説明が `Foo.ts` とその中身を並べて書いて
 *    いる箇所なら、**指す先のファイルが決まっている**ので裸のままでも判定できる。
 *    **名前でないものを「の」で続けると、この形に読める**（`Foo.mjs` の issue #867）——そこは
 *    並びを崩して書く（`DocumentStyle.md` 5節）。
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

/** `.md` は全体が説明。コードフェンスの中の例も、実在の名前を指しているなら同じに見る。 */
function allLines(text: string): ProseLine[] {
  return text.split('\n').map((raw, index) => ({ line: index + 1, text: raw }));
}

/**
 * コメントを取り除いた本文（文字列リテラルはそのまま残す——名前を文字列で持つ宣言もあるため）。
 *
 * **モジュールの指定だけは落とす。** パスはそのファイルが何を読むかを言うだけで、**そこに挙がった
 * 語がメンバーとして在る証拠にはならない**——`PlayScene` が `from './ui/cardEdges'` を読むだけで、
 * `PlayScene` の `cardEdges` を指す説明が在ることになり、この検査が黙る。
 */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\b(?:from|import)\s*\(?\s*'[^']*'/g, ' ');
}

/**
 * 参照の書き方。所有者もメンバーも大文字始まりでよい——型も定数も参照になる
 * （`PlayScreenView.ObjectWindowView`・`SitePlacer.ISLAND_RADIUS`）。**メンバーを小文字に限ると、
 * 小文字始まりへ改名された後も大文字のまま残っている名前が、丸ごと網から外れる。**
 */
const REFERENCE = /\b([A-Z][A-Za-z0-9]*)\.([A-Za-z][A-Za-z0-9_]*)\b\.?/g;

/**
 * 宣言を読む側。**所有者がこのリポジトリのものか**（{@link ownedHere}）と**その所有者がそのメンバーを
 * 持つか**（{@link hasMember}）は、ここに在る宣言だけで決まる——答えられるのは型を読める形式だけで、
 * 説明を書ける形式はもっと広い（{@link COMMENTED_SOURCES}）。
 */
const TYPED_SOURCES = [...filesIn('src', '.ts'), ...filesIn('tests', '.ts')];

/**
 * 説明が書かれているソース。**コメントを書ける形式なら、追跡しているものは全部入る**
 * ——`tools/**` の Python が `Card.ts` の定数を名指ししていても、`.ts` だけを見ていた間は
 * 指し先が消えても赤くならなかった（#2190）。
 *
 * **形式の一覧を持っているのは [`docScope.mjs`](../../scripts/docScope.mjs)**（`COMMENTED_EXTENSIONS`）
 * ——コメントのリンクを見る `docReferences.test.ts` も同じ1つから作る。別に持つと、片方だけが
 * 新しい綴りを知らないまま緑になる。**在り処では絞らない**——フォルダを数え上げると、足した日にしか
 * 更新されない一覧が射程を決めることになる。
 */
const COMMENTED_SOURCES = trackedFiles(ROOT).filter((rel) =>
  COMMENTED_EXTENSIONS.some((ext) => rel.endsWith(ext)),
);

/**
 * 宣言の値へ散文を置いているデータ（{@link isProseData}）。**コメントを書けない形式なので、
 * 落ちるのは「コメントを書ける形式」で絞った側**だが、書いてある主張は同じ
 * ——`tools/comfyui/recipes/*.json` は、生成の寸法を合わせる相手として `Card.ts` の定数を挙げている。
 */
const PROSE_DATA = trackedFiles(ROOT).filter(isProseData);

/**
 * 名前を挙げている文書。**射程は `docs/` に閉じない**——`agent-ops/**` の係の本文もルートの
 * `CLAUDE.md` も `Xxx.yyy` の形で実装を指しており、畳めば同じように嘘になる。**どこまで掛かるかを
 * 決めるのは [`docScope.mjs`](../../scripts/docScope.mjs)**——同じ規約（`DocumentStyle.md` 5節）を
 * 課す `docReferences.test.ts` と同じ1つ。
 */
const DOCUMENTS = trackedDocs(ROOT).filter((rel) => !isVerbatimRecord(rel));

/**
 * 説明を読む先。**どちらの見方も同じここを読む**——片方だけが狭いと、そこへ書いた主張は形を
 * 満たしていても誰も見ていない。
 *
 * `fenced` は、コードフェンスで囲みの中と外が切り替わる形式か。**Markdownだけ**——コメントの中の
 * 行は、囲みの中に在っても説明の一部として書かれている。
 */
const PROSE: readonly {
  readonly files: readonly string[];
  readonly proseOf: (rel: string) => ProseLine[];
  readonly fenced: boolean;
}[] = [
  {
    files: COMMENTED_SOURCES,
    proseOf: (rel) => allLines(commentsOnly(read(rel), rel)),
    fenced: false,
  },
  { files: PROSE_DATA, proseOf: (rel) => allLines(read(rel)), fenced: false },
  { files: DOCUMENTS, proseOf: (rel) => allLines(read(rel)), fenced: true },
];

const CODE = TYPED_SOURCES.map((rel) => codeOnly(read(rel))).join('\n');
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

const TRACKED = new Set(TRACKED_PATHS);

/**
 * 名前（ディレクトリを除いた最後の部分）から、それを持つ唯一のファイルへ。複数のファイルで
 * 重なっている名前は、どれを指すか決まらないので引けない（`null`）。
 *
 * **パスと同じ表に入れない。** 混ぜると、リポジトリ直下のファイルは名前がパスと同じ字面なので、
 * **自分自身と重なって必ず引けなくなる**（`CLAUDE.md`・`package.json` がその形で落ちていた）。
 */
const FILE_BY_NAME = new Map<string, string | null>();
for (const path of TRACKED_PATHS) {
  const name = basename(path);
  FILE_BY_NAME.set(name, FILE_BY_NAME.has(name) ? null : path);
}

/**
 * 文書に書かれたファイル参照から、実ファイルの相対パスへ。パス全体でも名前だけでも引ける。
 *
 * **候補を拡張子で絞らない**——追跡しているファイルそのものが候補で、引けたものがファイル参照。
 * `.ts` だけで組んでいた間、`scripts/**` の `.mjs` を挙げた主張は括弧で名前を並べていても丸ごと
 * 素通しになっていた（#2077）。**一覧で絞ると、形式が増えた日に誰も気づかないまま同じ穴が開く。**
 */
function fileOf(reference: string): string | null {
  if (TRACKED.has(reference)) return reference;
  return FILE_BY_NAME.get(basename(reference)) ?? null;
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
for (const rel of TYPED_SOURCES) {
  for (const [, name] of contentOf(rel, 'code').matchAll(DECLARATION)) {
    DECLARING_FILE.set(name, !DECLARING_FILE.has(name) || DECLARING_FILE.get(name) === rel ? rel : null);
  }
}

/**
 * **所有者を宣言しているファイルの中に、その語が在るか。** 所有者のファイルが決まるなら、その中だけを
 * 見る——コード全体では、別の型が持つ同名のメンバーや、無関係な文字列に同じ語が在るだけで素通りする
 * （在りもしない `AxisDef` の `Range` が、別のテストの `describe` に渡した文字列の中の `Range` で
 * 在ることにされていた）。
 *
 * **絞り込めるのはファイルまでで、型までではない。** 1つのファイルに複数の型が同居していれば
 * （`PassiveEffectGate` と `PassiveEffect` が同じ `PassiveEffect.ts`）、**隣の型のメンバーでも
 * 「在る」になる**。所有者ごとに範囲を切るには宣言の構文を読む必要があり、ここはコメントも含めた
 * 散文を相手にするので、そこまでは降りない。
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
  const file = DECLARING_FILE.get(owner) ?? fileOf(`${owner}.ts`);
  return file === null ? appearsInCode(member) : appearsIn(file, member, 'code');
}

/** 文書がファイルと並べて挙げた名前と、その指す先。 */
type FileMember = { readonly file: string; readonly name: string };

/**
 * ファイル参照として読む字面。**拡張子は書かない**——どれが実ファイルかは {@link fileOf} が
 * 追跡しているファイルと突き合わせて決めるので、ここで綴りを列挙すると射程が二重になる。
 */
const FILE_PATH = String.raw`[\w./-]+\.\w+`;

/**
 * ファイル参照が始まってよい位置。**途中から切り出さない**——パスを構成する字が前に在るなら、
 * そこはもっと長い綴りの一部で、切り出した先頭はその綴りが指すファイルではない
 * （`~/.claude/settings.json` の末尾だけを見ると、このリポジトリの `.claude/settings.json` に
 * すり替わる）。
 */
const FILE_STARTS = String.raw`(?<![\w~./-])`;

/** ファイルを単独で置いた括弧。並んでいる名前は、括弧の直前に接しているもの。 */
const NAME_THEN_FILE = new RegExp(String.raw`\`([^\`]+)\`\s*[（(]\s*\`(${FILE_PATH})\`\s*[）)]`, 'g');
/** ファイルに続けて中身を挙げる括弧。並んでいる名前は、括弧の中のもの。 */
const FILE_THEN_NAMES = new RegExp(String.raw`\`(${FILE_PATH})\`\s*[（(]([^）)]*)[）)]`, 'g');
/**
 * 名前として並ぶ字面。**囲みの有無は問わない**——囲みは「これは識別子だ」を表す記法にすぎず、
 * 付いていなくても**ファイルと並べた名前は同じ主張**になる。囲みを条件にすると、素の字面で書いた
 * 名指しがまとめて見張りの外へ落ち、しかも**落ちていることが緑と見分けられない**。囲みを要求して
 * 書き手に直させる道も無い——囲みは主張の一部ではないので、無いことを咎める根拠が検査に無い。
 */
const LISTED_NAME = String.raw`\`[^\`]+\`|[A-Za-z_][A-Za-z0-9_]*`;

/**
 * 括弧を使わず「の」で続ける書き方（`Card.ts` の `PAPER_INSET`）。並んでいる名前は、その直後のもの。
 *
 * **区切りの記号だけで続けた並びは、どれも同じファイルのもの**（`Card.ts` の `PAPER_INSET` /
 * `PAPER_RADIUS`）。先頭だけを採ると、**1つの主張のうち2つ目から先が見張りの外**になる
 * ——寸法を揃える相手を挙げる場所は、揃える定数が複数あるのが普通。語（`と`・`や`）を挟んだ先は
 * 別の所有者の話でありうるので、採るのは記号で続く間だけ。
 */
const FILE_OF_NAMES = new RegExp(
  String.raw`${FILE_STARTS}\`?(${FILE_PATH})\`?\s*の\s*((?:${LISTED_NAME})(?:\s*[/・、]\s*(?:${LISTED_NAME}))*)`,
  'g',
);
const LISTED_NAMES = new RegExp(LISTED_NAME, 'g');
/** 図の1行の末尾に、空白で切り離して置かれたファイル。並んでいる名前は、その行が呼んでいるもの。 */
const CALL_THEN_FILE = new RegExp(String.raw`^(.*?\S)\s\s+(${FILE_PATH})\b`);
const QUOTED = /`([^`]+)`/g;
const NAME = /[A-Za-z_][A-Za-z0-9_]*/;

/**
 * 名前として見るのは最初の識別子だけ（`placeSites(scope)` なら `placeSites`）。引数や添字を指し先へ
 * 突き合わせないための割り切りで、**囲みの中に式を書いた名指し**（`` `PAPER_INSET + FRAME_SIDE_WIDTH` ``）
 * も同じ扱いになる——**先頭以外は見張りの外**。どこまでが名指しでどこからが式かを囲みの中身から
 * 決められない以上、拾う側を広げると引数の名前まで指し先に要求することになる。
 */
function nameIn(text: string): string | null {
  return NAME.exec(text)?.[0] ?? null;
}

/**
 * バッククォートの中身のうち、名前を挙げているもの。ファイル参照そのものは名前ではない。
 *
 * **英字の語を空白で並べたものも名前ではない**（`npm test`）。囲みは「これは識別子だ」だけを表す
 * 記法ではなく、打つコマンドにも付くので、**先頭の語だけを取ると、その行が挙げていない名前を指し先へ
 * 突き合わせることになる**（`npm test`（`Foo.test.ts`）で `npm` が `Foo.test.ts` のメンバーとして
 * 挙がる）。
 *
 * **続くのが英字か `-`・`_` のときだけ落とす。** `-` が要るのは、打つコマンドの2語目が旗になる形
 * （`bash -lc`）を同じ規則で落とすため。和文を続けた言及（`placeSites を呼ぶ`）は名前を挙げている
 * ので残す——落とすと、**指し先が消えても気づけない箇所が言い回しの数だけ増える。** 引数の並びは
 * 空白で切れないので、どちらの規則でも残る。
 */
function quotedName(quoted: string): string | null {
  if (quoted.includes('/') || /\.[A-Za-z]+$/.test(quoted)) return null;
  if (/^[A-Za-z_][A-Za-z0-9_]*\s+[A-Za-z_-]/.test(quoted)) return null;
  return nameIn(quoted);
}

/**
 * 並びの1つが挙げている名前。**囲んであれば囲みの規則で読み**（{@link quotedName}）、素の字面なら
 * それ自体が識別子——打つコマンドも引数の並びも、囲みが無ければ区切りの記号で切れている。
 */
function listedName(token: string): string | null {
  return token.startsWith('`') ? quotedName(token.slice(1, -1)) : token;
}

/** セル全体が1つのファイル参照になっているとき、その実ファイル。 */
const CELL_IS_FILE = new RegExp(String.raw`^\s*\`(${FILE_PATH})\`\s*$`);
function cellFile(cell: string): string | null {
  const only = CELL_IS_FILE.exec(cell);
  return only === null ? null : fileOf(only[1]);
}

/**
 * その行がファイルと名前を並べて書いている組。並べ方は、括弧で注釈する（散文・見出し）・「の」で
 * 続ける（`Card.ts` の `PAPER_INSET`）・表の同じ行に置く（索引の表）・図の行末に添える
 * （呼び出し関係の図）。
 */
function fileMembersOn(text: string, insideFence: boolean): FileMember[] {
  const found: FileMember[] = [];
  const add = (file: string | null, name: string | null): void => {
    if (file !== null && name !== null) found.push({ file, name });
  };

  if (insideFence) {
    const annotated = CALL_THEN_FILE.exec(text);
    if (annotated !== null) add(fileOf(annotated[2]), nameIn(annotated[1]));
    return found;
  }

  for (const match of text.matchAll(NAME_THEN_FILE)) {
    add(fileOf(match[2]), quotedName(match[1]));
  }
  for (const match of text.matchAll(FILE_THEN_NAMES)) {
    const file = fileOf(match[1]);
    for (const quoted of match[2].matchAll(QUOTED)) add(file, quotedName(quoted[1]));
  }
  for (const match of text.matchAll(FILE_OF_NAMES)) {
    const file = fileOf(match[1]);
    for (const token of match[2].matchAll(LISTED_NAMES)) add(file, listedName(token[0]));
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
    for (const { files, proseOf } of PROSE) {
      for (const rel of files) {
        for (const { line, text } of proseOf(rel)) {
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
    for (const { files, proseOf, fenced } of PROSE) {
      for (const rel of files) {
        let insideFence = false;
        for (const { line, text } of proseOf(rel)) {
          if (fenced && text.trim().startsWith('```')) {
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
    }

    expect(
      missing,
      '説明がファイルと並べて挙げた名前が、そのファイルに無い（名前を挙げているつもりが無いなら、' +
        `並びを崩して主張に読めなくする——DocumentStyle.md 5節）:\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  it('追跡しているファイルは、どれも指し先として引ける', () => {
    // 指し先の候補を `.ts` で絞っていた間、`scripts/**` の `.mjs` を挙げた主張は、括弧で名前を
    // 並べていても丸ごと素通しになっていた（#2077）。**引けない先が在っても、そこを挙げた主張が
    // 壊れる日までは緑のまま**なので、文書の中身ではなく引ける範囲そのものをここで見る。
    const unresolved = TRACKED_PATHS.filter((path) => fileOf(path) !== path);

    expect(
      unresolved,
      `追跡しているのに指し先として引けないファイル:\n${unresolved.join('\n')}`,
    ).toEqual([]);
  });

  it('`docs/` の外の文書も、走査に入っている', () => {
    // 走査を `docs/` だけにすると、`agent-ops/**` の係の本文が挙げる名前を誰も見ない（#1948）。
    // `docs/` の文書だけで数は足りるので、外側が落ちても上の検査は緑になる。
    const outside = DOCUMENTS.filter((rel) => !rel.startsWith(`docs${sep}`));
    expect(outside, '走査が `docs/` の中だけへ戻っている').not.toEqual([]);
  });

  it('`.ts` 以外のコメントも、宣言へ書いた散文も、走査に入っている', () => {
    // `.ts` と `.md` だけを見ていた間、`tools/comfyui/**` が `Card.ts` の定数を名指ししていても、
    // 指し先が消えたことは誰も見ていなかった（#2190）。`.ts` と `.md` の主張だけで数は足りるので、
    // 他の置き場が落ちても上の検査は緑になる。
    const others = COMMENTED_SOURCES.filter((rel) => !rel.endsWith('.ts'));
    expect(others, '走査が `.ts` の中だけへ戻っている').not.toEqual([]);
    expect(PROSE_DATA, '宣言の値へ書いた散文が、走査から落ちている').not.toEqual([]);
  });

  it('囲みが無くても、ファイルと並んだ名前を採る', () => {
    // 囲みは「これは識別子だ」を表す記法で、主張の一部ではない。要求すると、素の字面で書いた
    // 名指しが見張りの外に落ちたまま緑になる。
    const named = (text: string) => fileMembersOn(text, false).map(({ name }) => name);

    expect(named('SitePlacer.ts の placeSites')).toEqual(['placeSites']);
    expect(named('`SitePlacer.ts` の `placeSites` / `ISLAND_RADIUS`')).toEqual([
      'placeSites',
      'ISLAND_RADIUS',
    ]);
    expect(named('SitePlacer.ts の placeSites / ISLAND_RADIUS')).toEqual([
      'placeSites',
      'ISLAND_RADIUS',
    ]);
    // 区切りの記号で続く間だけが同じファイルのもの。語を挟んだ先は別の所有者の話でありうる。
    expect(named('SitePlacer.ts の placeSites と ISLAND_RADIUS')).toEqual(['placeSites']);
  });

  it('パスの途中から切り出したものは、ファイル参照ではない', () => {
    // 末尾だけを見ると、リポジトリの外を指す綴りが同じ名前のファイルへすり替わる。
    const named = (text: string) => fileMembersOn(text, false).map(({ name }) => name);

    expect(named('`.claude/settings.json` の `autoCompactWindow`')).toEqual(['autoCompactWindow']);
    expect(named('`~/.claude/settings.json` の `autoCompactWindow`')).toEqual([]);
  });

  it('囲みの中が名前か句かで、ファイルと並んだ組を採る／採らない', () => {
    // 句の先頭の語を名前として採ると、その行が挙げていない名前が指し先へ突き合わされる。一方、
    // 和文を続けた言及は名前を挙げているので、落とすと指し先が消えても気づけなくなる。
    const named = (text: string) => fileMembersOn(text, false).map(({ name }) => name);

    expect(named('`placeSites`（`SitePlacer.ts`）')).toEqual(['placeSites']);
    expect(named('`placeSites を呼ぶ`（`SitePlacer.ts`）')).toEqual(['placeSites']);
    expect(named('`npm test`（`SitePlacer.ts`）')).toEqual([]);
  });
});
