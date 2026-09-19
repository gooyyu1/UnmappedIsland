import { existsSync, readFileSync } from 'node:fs';
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

/**
 * 表の1行が挙げている、決着した宣言。
 *
 * @typedef {object} SettledDeclaration
 * @property {string} question どの問いで決着したか（節の見出し）。決着はその問いの中でだけ効く
 * @property {string} file 宣言の在り処（リポジトリ相対。区切りは `/`）
 * @property {string} name 宣言の名前（所属を書いた行は、その最後の部分）
 * @property {number} line 一覧の中の行番号。落ちたときに直す先を指す
 */

const HEADING = /^##\s+(\S.*?)\s*$/;
const QUOTED = /`([^`]+)`/g;

/**
 * 一覧が挙げている宣言。**形を外した行は読み飛ばさずに投げる**——読み飛ばすと、書いたつもりの決着が
 * 誰にも渡らないまま緑で通る。
 *
 * 所属を書いた名前（`ZipEntry.method`）は最後の部分だけを採る。**所属は読み手のためのもの**で、
 * 宣言と突き合わせるのは名前と在り処——所属が現物とずれていることは、説明の参照の検査
 * （`tests/docs/docMemberReferences.test.ts`）が別に見る。
 *
 * @param {string} root リポジトリの根
 * @returns {SettledDeclaration[]} 一覧に書かれた順
 */
export function settledDeclarations(root) {
  const text = readFileSync(join(root, SETTLED_LIST), 'utf-8');
  const found = [];
  let question;
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const heading = HEADING.exec(raw);
    if (heading !== null) {
      question = heading[1];
      return;
    }
    if (!raw.trimStart().startsWith('|')) return;
    const [cell] = raw.trim().slice(1).split('|');
    const quoted = [...cell.matchAll(QUOTED)].map((match) => match[1]);
    // 見出しの行と区切りの行には囲みが無い。
    if (quoted.length === 0) return;
    const where = `${SETTLED_LIST}:${line}`;
    if (question === undefined) throw new Error(`${where} どの問いの決着かが、節の見出しから引けない`);
    const [file, ...names] = quoted;
    if (!existsSync(join(root, ...file.split('/')))) throw new Error(`${where} ${file} が無い`);
    if (names.length === 0) throw new Error(`${where} ${file} の中の名前が挙がっていない`);
    for (const written of names) {
      const name = written.split('.').at(-1);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`${where} ${written} は名前ではない`);
      found.push({ question, file, name, line });
    }
  });
  if (found.length === 0) throw new Error(`${SETTLED_LIST} が1件も挙げていない`);
  return found;
}
