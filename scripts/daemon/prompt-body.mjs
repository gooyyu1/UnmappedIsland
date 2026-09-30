// ひな形（`agent-ops/prompts/*-prompt.md`）から、セッションへ渡す本体を取り出す。**リンクの起点は
// リポジトリ直下へ揃え、デーモンの手元の置き場を埋めて出す**（{@link promptBodyForSession}）。
//
//   node scripts/daemon/prompt-body.mjs <ひな形のパス>            本体を標準出力へ
//   node scripts/daemon/prompt-body.mjs <ひな形のパス> <節の名前>  その節の中の本体だけを見る
//
// 取り出せなければ何も出さない（**空かどうかで判定する側が居る**——`prompt-template.sh`）。

import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { linksRebasedToRepoRoot } from '../markdownLinks.mjs';
import { boardState, daemonLog } from './board-state.mjs';

/** このファイルから見たリポジトリ直下。渡す本体の起点を出すのに要る（{@link promptBodyForSession}）。 */
const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../..');

/** `## <節の名前> …` の見出しの行か。名前は `##` の後の最初の語。 */
function headsSection(line, section) {
  const found = /^##\s+(\S+)/.exec(line);
  return found !== null && found[1] === section;
}

/**
 * ひな形の中身から、本体として渡す囲みの中身を取り出す。
 *
 * **囲みの綴りはひな形が決める。** バッククォートだけを並べた行（3つ以上）が最初に現れたところが
 * 始まりで、同じ行が閉じる。中に ``` を含むひな形は ```` で囲めばよく、読む側は綴りを知らなくて
 * よい。**前置きのラベル付きの囲み（` ```bash ` など）は丸ごと読み飛ばす**——飛ばさないと、その
 * 閉じの行が本体の始まりに見え、**中身の違う本体が黙って渡る。**
 *
 * **本体の中のさらなる囲みは、本体の一部**（閉じで切るのは同じ綴りの行だけ）。
 *
 * **閉じないまま尽きた囲みは本体ではない。** そこまでを返すと、ひな形の閉じ忘れが**中身の違う
 * 本体**として、しかも空ではないので呼び手の関門（[`prompt-template.sh`](prompt-template.sh)）にも
 * 掛からずに渡る。
 *
 * **`section` を渡すと、その見出しより後だけを見る**（理由ごとに本文を持つひな形
 * [`resume-prompt.md`](../../agent-ops/prompts/resume-prompt.md) が在る）。見出しに当たるまでの
 * 囲みは、綴りに関わらず丸ごと読み飛ばす——前の節の本体の中に同じ形の行が在っても、節の見つけ方が
 * 変わらないようにする。**その節が囲みを持たないまま次の見出しに当たったら、そこで終わる**
 * ——続けると、**後ろの節の本文がその節のものとして黙って渡る。**
 *
 * **どこまでが本体かを決めるのはここ1つ。** 渡す本文として読む側
 * （[`prompt-template.sh`](prompt-template.sh)）と、名前で引ける節の範囲として読む側
 * （`tests/docs/docReferences.test.ts`）が同じものを本体と呼ぶ。別々に持つと、**渡る本文と、
 * 節を引ける範囲が黙ってずれる。**
 *
 * @param {string} markdown ひな形の中身
 * @param {string | null} [section] 読み始める節の名前。渡さなければひな形の先頭から
 * @returns {string | null} 本体の中身（囲みの行は含まない。各行が `\n` で終わる）。閉じた囲みが
 *   見つからなければ null
 */
export function promptBody(markdown, section = null) {
  /** @type {string[]} */
  const body = [];
  /** 本体の囲みの綴り。開くまでは null。 */
  let fence = null;
  /** 閉じの行に当たったか。 */
  let closed = false;
  /** 読み飛ばしている囲みの綴り。 */
  let skipping = null;
  /** まだ見つけていない節の名前。渡されていないか、見つけた後は null。 */
  let seeking = section;
  /** 節を渡されたか。見つけた後、次の見出しで終わるかの判定に要る。 */
  const bounded = section !== null;
  for (const line of markdown.split(/\r?\n/)) {
    if (fence !== null) {
      if (line === fence) {
        closed = true;
        break;
      }
      body.push(line);
    } else if (skipping !== null) {
      if (line === skipping) skipping = null;
    } else {
      const opened = /^`{3,}/.exec(line);
      if (opened !== null) {
        if (seeking !== null || opened[0] !== line) skipping = opened[0];
        else fence = line;
      } else if (seeking !== null) {
        if (headsSection(line, seeking)) seeking = null;
      } else if (bounded && /^##\s/.test(line)) {
        break;
      }
    }
  }
  return closed ? body.map((line) => `${line}\n`).join('') : null;
}

/**
 * そのひな形が渡しうる本体を、**どれも同じ取り出しで拾えるように**並べた読み始めの節。先頭の囲みが
 * `null`、以降が `## <名前>` の節。
 *
 * **先頭の囲みだけでは足りない。** 理由ごとに本文を持つひな形
 * （[`resume-prompt.md`](../../agent-ops/prompts/resume-prompt.md)）は節を指定して読まれるので、
 * 先頭だけを本体と呼ぶと、**セッションへは渡るのに節としては引けない本文**ができる。
 *
 * @param {string} markdown ひな形の中身
 * @returns {(string | null)[]} 読み始める節の名前
 */
function bodySections(markdown) {
  return [null, ...[...markdown.matchAll(/^##\s+(\S+)/gm)].map((found) => found[1])];
}

/**
 * そのひな形が**渡しうる本体すべて**。先頭の囲みと、`## <名前>` の節ごとの囲みを集める。
 *
 * 節を持たないひな形では先頭と節ごとの取り出しが同じものを返すので、重なりは畳む。
 *
 * @param {string} markdown ひな形の中身
 * @returns {string[]} 本体の中身。1つも無ければ空
 */
export function promptBodies(markdown) {
  const bodies = bodySections(markdown).map((section) => promptBody(markdown, section));
  return [...new Set(bodies)].filter((body) => body !== null);
}

/**
 * そのひな形が在る場所の、リポジトリ直下から見た相対（区切りは `/`）。
 *
 * **リポジトリの外に在るひな形（検査が一時フォルダへ書くもの）では空を返す**——揃える先の直下が
 * 無いので、指し先は動かさないのが正しい。返さずに測ると、リポジトリを抜けるぶんの `../` が指し先へ
 * 付いて、**壊れた指し先が黙って出る。**
 */
function dirFromRepoRoot(templatePath) {
  const fromRoot = relative(REPO_ROOT, resolve(templatePath));
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) return '';
  return dirname(fromRoot).split(sep).join('/');
}

/**
 * セッションへ渡す形の本体。囲みの中身を取り出したうえで、**リンクの起点をリポジトリ直下へ
 * 揃える。**
 *
 * **起点が2つに割れるのをここで畳む。** 書き手はどの文書とも同じく自分のファイルからの相対で書き
 * （docs/DocumentStyle.md 5節）、参照の検査もそう読む。一方、囲みの中身を受け取ったセッションは
 * リポジトリ直下で読むので、ひな形の位置から書いた `../../` はそのままでは開けない。**揃えるのは
 * ここ1つ**——書き手の側で先回りして揃えると、ひな形の頁から開けないリンクが、検査の緑のまま残る。
 *
 * @param {string} templatePath ひな形のパス。相対なら今のフォルダから解決する
 * @param {string} markdown ひな形の中身
 * @param {string | null} [section] 読み始める節の名前。渡さなければひな形の先頭から
 * @returns {string | null} 渡す本体。囲みが見つからなければ null
 */
export function promptBodyForSession(templatePath, markdown, section = null) {
  const body = promptBody(markdown, section);
  return body === null ? null : withPlaces(linksRebasedToRepoRoot(body, dirFromRepoRoot(templatePath)));
}

/**
 * ひな形が `{{<名前>}}` と書いて指す、**デーモンの手元の置き場。** 投入するプロセスはデーモンの
 * 環境変数を継いでいるので、ここで引いた値がデーモンの読み書きする先と一致する。
 *
 * **セッションの側で引かせない。** ブリッジのセッションはデーモンから環境変数を受け取らないので、
 * デーモンが `BOARD_STATE` で置き場を移していると、セッションは既定の置き場を読み書きする
 * （`agent-ops/board-design.md` 2.21.4節）。
 */
export const SESSION_PLACES = { BOARD_STATE: boardState, DAEMON_LOG: daemonLog };

/**
 * `{{<名前>}}` を {@link SESSION_PLACES} の値で埋める。**区切りは `/` へ揃える**——受け取った
 * セッションは Windows でも bash で打つので、`\` はそのままでは通らない。知らない名前は残す
 * （ひな形の側の綴りは `tests/scripts/patrolRecord.test.ts` が見ている）。
 */
function withPlaces(body) {
  return body.replace(/\{\{(\w+)\}\}/g, (found, name) =>
    Object.hasOwn(SESSION_PLACES, name) ? SESSION_PLACES[name]().replaceAll('\\', '/') : found,
  );
}

/**
 * そのひな形が渡しうる本体すべてを、{@link promptBodyForSession 渡す形}で。
 *
 * @param {string} templatePath ひな形のパス。相対なら今のフォルダから解決する
 * @param {string} markdown ひな形の中身
 * @returns {string[]} 渡す本体。1つも無ければ空
 */
export function promptBodiesForSession(templatePath, markdown) {
  const bodies = bodySections(markdown).map((section) =>
    promptBodyForSession(templatePath, markdown, section),
  );
  return [...new Set(bodies)].filter((body) => body !== null);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [path, section] = process.argv.slice(2);
  if (path === undefined) {
    console.error('ひな形のパスを渡す');
    process.exit(2);
  }
  process.stdout.write(promptBodyForSession(path, readFileSync(path, 'utf-8'), section ?? null) ?? '');
}
