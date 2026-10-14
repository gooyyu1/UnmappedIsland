import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 棚卸し（`review/README.md`）で**今のままでよいと決めた宣言**の一覧を読む口。
 *
 * **読む側は1つではない**——次の回が採点する一覧へ印を載せる
 * [`declarationInventory.mjs`](declarationInventory.mjs) と、行が指す宣言が今も在るかを見る
 * `tests/docs/reviewSettled.test.ts` が同じここを読む。別々に持つと、**印の付かなくなった一覧を
 * 検査だけが緑で通す。**
 */

/** 決着の一覧。**置き場は1つ**——次の回が探す先が増えると、渡らない行がそこに溜まる。 */
export const SETTLED_LIST = join('review', 'settled.md');

/** モジュール直下の宣言の所属名。**一覧（`declarationInventory.mjs`）もこれを付ける**——字面が割れると突き合わせが外れる。 */
export const MODULE = '(モジュール)';

/**
 * 表の1行が挙げている、決着した宣言。
 *
 * @typedef {object} SettledDeclaration
 * @property {string} question どの問いで決着したか（節の見出し）。決着はその問いの中でだけ効く
 * @property {string} file 宣言の在り処（リポジトリ相対。区切りは `/`）
 * @property {string} owner 宣言の所属。所属を書かなかった行は {@link MODULE}
 * @property {string} name 宣言の名前（所属を書いた行は、その最後の部分）
 * @property {number} line 一覧の中の行番号。落ちたときに直す先を指す
 */

const HEADING = /^##\s+(\S.*?)\s*$/;
const QUOTED = /`([^`]+)`/g;
/** 表の見出しと本体を仕切る行のセル。ここだけが、宣言を挙げていなくてよい行。 */
const RULE = /^\s*:?-{3,}:?\s*$/;

/**
 * 一覧の本文が挙げている宣言。**形を外した行は読み飛ばさずに投げる**——読み飛ばすと、書いたつもりの
 * 決着が誰にも渡らないまま緑で通る。
 *
 * **飛ばしてよい行は名指しで決める**（見出しの行と、それを仕切る行）。「宣言を挙げていない行は
 * 飛ばす」で畳むと、**書き方を外した本物の行が仕切りの行と同じ扱いになる**——囲みを落とした行も、
 * 行の間の改行が落ちて2行が1行に潰れた後ろの行も、そこで黙って消える。
 *
 * 所属を書いた名前（`ZipEntry.method`）は、最後の部分を名前、その手前を所属として採る。**所属を
 * 書かない行はモジュール直下の宣言を指す**——在り処と名前だけでは、同じファイルの無名の型リテラルに
 * 並ぶ同じ名前（`DescriptionToken::text`）と見分けが付かない。**在り処と所属が実在するかは見ない**
 * ——リポジトリ直下から書いたパスは `tests/docs/docReferences.test.ts` が、指す宣言が在るかは
 * `tests/docs/reviewSettled.test.ts` が見る。
 *
 * @param {string} text 一覧の本文
 * @returns {SettledDeclaration[]} 一覧に書かれた順
 */
export function settledDeclarationsIn(text) {
  const found = [];
  let question;
  /** その表の見出しの列の数。表の外（見出しの行・空行の後）では未定。 */
  let columns;
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const row = raw.trim();
    const heading = HEADING.exec(raw);
    if (heading !== null) question = heading[1];
    if (!row.startsWith('|')) {
      columns = undefined;
      return;
    }
    const cells = row.replace(/^\|/, '').replace(/\|$/, '').split('|');
    const where = `${SETTLED_LIST}:${line}`;
    if (columns === undefined) {
      columns = cells.length;
      return;
    }
    if (cells.length !== columns) {
      throw new Error(`${where} 列の数が表の見出しと違う（${cells.length} と ${columns}）`);
    }
    if (cells.every((cell) => RULE.test(cell))) return;
    if (question === undefined) throw new Error(`${where} どの問いの決着かが、節の見出しから引けない`);
    const [file, ...names] = [...cells[0].matchAll(QUOTED)].map((match) => match[1]);
    if (file === undefined) throw new Error(`${where} 宣言を囲みで挙げていない`);
    if (names.length === 0) throw new Error(`${where} ${file} の中の名前が挙がっていない`);
    for (const written of names) {
      const parts = written.split('.');
      const name = parts.at(-1);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`${where} ${written} は名前ではない`);
      const owner = parts.length === 1 ? MODULE : parts.slice(0, -1).join('.');
      found.push({ question, file, owner, name, line });
    }
  });
  return found;
}

/**
 * 一覧（{@link SETTLED_LIST}）が挙げている宣言。
 *
 * @param {string} root リポジトリの根
 * @returns {SettledDeclaration[]} 一覧に書かれた順
 */
export function settledDeclarations(root) {
  return settledDeclarationsIn(readFileSync(join(root, SETTLED_LIST), 'utf-8'));
}
