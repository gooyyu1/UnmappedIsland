import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isAnalysisRecord, trackedDocs, trackedRefSources } from '../docScope.mjs';
import { linesOutsideFence } from '../markdownFences.mjs';
import { SECTION_RUN, sectionNumbersIn } from '../sectionRefs.mjs';

/**
 * 節番号の参照を、**この周はどこまで読むか**を決める1つ（`agent-ops/prompts/refs-prompt.md`）。
 *
 * `tests/docs/docReferences.test.ts` が見るのは**指し先の節が実在するか**だけで、指した先にその話が
 * 書いてあるかは機械では見ていない。読むのは係（モデル）で、ここが渡すのは**読む範囲**だけ。
 *
 * ## 選び方は2段
 *
 * - **変わった分** … 台帳（{@link LEDGER}）の `検めた時点` から今の `HEAD` までに変わったもの。
 *   **書き足された行に在る参照**（主張が変わった）と、**番号の指す先が動いた節を、その番号で
 *   指している参照**（指し先がずれた）。後者が要るのは、**節番号の繰り上げが実在の検査をすり抜ける**
 *   から——番号を1つ繰り上げると、**ずれた先の番号も実在する**ので緑のまま通る（#2263）。
 * - **掃く分** … 追跡しているファイルの並びを、台帳の `到達点` の次から予算に届くまで。既に在る
 *   参照は誰も読んでいないので、変わった分だけを追っても減らない。
 *
 * **どちらも「ファイルが変わったか」では引かない。** 1行の直しでそのファイルの参照を全部積むと、
 * 1日ぶんで参照数千件になる（実測・2026-09-18: 5本のPRぶんで2632件）——予算に収まらない量を毎周
 * 出すと、**読みきれなかったぶんが窓から落ちるか、掃く分が永久に進まない**かのどちらかになる。
 *
 * **「番号の指す先が動いた」は、番号ごとに見出しの字面を突き合わせて出す。** 繰り上げは番号を
 * 消さずに中身だけを入れ替えるので、**節が消えた場合より見つけにくい**（リンクは切れない）。
 *
 * **裸の `N節` が `GameElementDefinition.md` へ落ちる経路は、変わった分では引かない。** コード・
 * YAML の既定（`docs/DocumentStyle.md` 5節）だが、そこまで引くと**あの文書の節が動くたびに数百の
 * ファイルが1周に積まれる**。そちらは掃く分が拾う。
 *
 * ## 台帳が持つのは2つの値だけ
 *
 * どこまで読んだかは**リポジトリの側**に置く（{@link LEDGER}）——係はクラウドで立つので、デーモンの
 * 台帳（`taken.json`）に控えても手元に届かない。
 */

/** どこまで読んだかを持つ台帳。**係が書き換える先**でもある。 */
export const LEDGER = 'agent-ops/ref-audit.md';

/** 台帳の値が「まだ無い」ことを表す綴り。 */
export const UNSET = 'なし';

/**
 * 1周で読む参照の数。**予算が掛かるのは掃く分だけ**——変わった分は、読まずに `検めた時点` を
 * 進めると窓から落ちるので、絞ったうえで全部を出す。
 *
 * 数そのものに根拠は無い（1本のセッションが節を開いて突き合わせられる量の見積もり）。**動かすなら
 * ここだけ**で、ひな形にも文書にも書き写さない。
 */
export const BUDGET = 40;

/**
 * 節番号の参照。捕獲するのは番号の並び（範囲・列挙を含む）で、**綴りは
 * [`sectionRefs.mjs`](../sectionRefs.mjs) が持つ**——別に持つと、こちらだけが列挙の先頭側を
 * 数え落とす。
 */
const REF_TOKEN = new RegExp(String.raw`(${SECTION_RUN})\s*節`, 'g');

/** 見出しの先頭に付く節番号。 */
const HEADING_NUMBER = /^(\d+(?:\.\d+)*)[.\s]/;

/** そこに在る節番号の参照の数。 */
function countRefs(text) {
  return [...text.matchAll(REF_TOKEN)].length;
}

/** そこに在る節番号の参照が挙げている番号（範囲指しは両端、列挙は全部）。 */
function refNumbers(text) {
  return [...text.matchAll(REF_TOKEN)].flatMap((found) => sectionNumbersIn(found[1]));
}

/** 台帳から引いた、前の周の到達点。どちらも「まだ無い」なら `null`。 */
function parseLedger(text) {
  const value = (label) => {
    const found = new RegExp(`^- ${label}: \`(.*)\`\\s*$`, 'm').exec(text);
    if (found === null) throw new Error(`${LEDGER} に「${label}」の行が無い`);
    return found[1] === UNSET ? null : found[1];
  };
  return { through: value('到達点'), commit: value('検めた時点') };
}

/**
 * 台帳の中身。**読めなければ投げる**——「まだ無い」（`なし`）と「台帳が壊れている」は別で、
 * 後者を前者に畳むと**掃き終えた分をもう一度最初から読み直す**ことになる。
 *
 * @param {string} root リポジトリの根
 */
export function readLedger(root) {
  return parseLedger(readFileSync(resolve(root, LEDGER), 'utf-8'));
}

/** パスの表記を `/` 区切りへ。台帳と git は `/`、`trackedFiles` はそのプラットフォームの区切り。 */
function posix(rel) {
  return rel.split(sep).join('/');
}

/**
 * この係が読む側のファイル。**指し先が実在するかの検査と同じ射程**（{@link trackedRefSources}）
 * **から、その回の観測の記録を引く**——あれは当時を書いたもので、今と食い違っていても直す先では
 * ない（{@link isAnalysisRecord}）。並びは掃く順そのもの。
 *
 * **台帳自身も外す。** 係は毎周ここを書き換えるので、射程に入れると**その書き換えが次の周の
 * 「変わった分」になり、係が自分で自分を起こし続ける。**
 */
function auditSources(root) {
  return trackedRefSources(root)
    .map(posix)
    .filter((rel) => rel !== LEDGER && !isAnalysisRecord(rel.split('/').join(sep)))
    .sort();
}

/** **標準エラーは飲む。** 無い指紋・無いパスは呼び手が `null` で受けるので、端末へ出す先が無い。 */
function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** 今の `HEAD` の指紋。 */
export function head(root) {
  return git(root, ['rev-parse', 'HEAD']).trim();
}

/**
 * `commit` から `HEAD` までに変わったファイル（`/` 区切り）。**その指紋を引けない檻では `null`**
 * ——浅いクローンでは前の周の指紋が手元に無い。空（＝1件も変わっていない）と混ぜない。
 */
function changedSince(root, commit) {
  try {
    git(root, ['cat-file', '-e', `${commit}^{commit}`]);
  } catch {
    return null;
  }
  return git(root, ['diff', '--name-only', commit, 'HEAD'])
    .split('\n')
    .filter((line) => line !== '');
}

/**
 * `commit` 以降に**書き足された行**（今の側の行番号付き）。消えた行は見ない——読む先が無い。
 */
function addedLines(root, commit, rel) {
  const added = [];
  let at = 0;
  for (const line of git(root, ['diff', '-U0', commit, 'HEAD', '--', rel]).split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk !== null) {
      at = Number(hunk[1]);
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      added.push({ line: at, text: line.slice(1) });
      at += 1;
    }
  }
  return added;
}

/** 見出しの行（囲みの中は節ではない）。 */
function headingsOf(markdown) {
  return linesOutsideFence(markdown)
    .map(({ raw }) => /^#{1,6}\s+(.*)$/.exec(raw)?.[1])
    .filter((heading) => heading !== undefined);
}

/** 節番号 → 見出しの字面。番号を持たない見出しは入らない。 */
function numberedHeadings(markdown) {
  const byNumber = new Map();
  for (const heading of headingsOf(markdown)) {
    const found = HEADING_NUMBER.exec(heading);
    if (found !== null) byNumber.set(found[1], heading);
  }
  return byNumber;
}

/**
 * **その番号が指す先が動いた**節の番号。消えた・増えた・同じ番号の見出しが別物になった、のどれか。
 *
 * 見出しの字面で突き合わせるのは、**繰り上げが番号を残したまま中身を入れ替える**から。番号の有無
 * だけを見ると、繰り上げのずれは前後どちらの番号でも実在するので何も出ない。
 */
function movedNumbers(before, after) {
  const was = numberedHeadings(before);
  const now = numberedHeadings(after);
  const moved = new Set();
  for (const [num, heading] of was) if (now.get(num) !== heading) moved.add(num);
  for (const [num, heading] of now) if (was.get(num) !== heading) moved.add(num);
  return moved;
}

/** その指紋の時点での中身。その時点に無かったファイルなら `null`。 */
function contentAt(root, commit, rel) {
  try {
    return git(root, ['show', `${commit}:${rel}`]);
  } catch {
    return null;
  }
}

/**
 * この周に読む参照の範囲。
 *
 * @param {string} root リポジトリの根
 * @param {{ budget?: number, ledger?: object }} [options] 掃く分に掛ける予算（既定は {@link BUDGET}）と、
 *   前の周の到達点（**渡せるのは、台帳を書き換えずに検めるため**。既定は実物）
 */
export function refAuditBatch(root, { budget = BUDGET, ledger = readLedger(root) } = {}) {
  const now = head(root);
  const sources = auditSources(root);
  const bodies = new Map();
  for (const rel of sources) bodies.set(rel, readFileSync(resolve(root, rel), 'utf-8'));

  const changed = [];
  const changedFiles = ledger.commit === null ? [] : changedSince(root, ledger.commit);
  if (changedFiles !== null && changedFiles.length > 0) {
    const found = new Map();
    const add = (rel, refs, why, where) => {
      if (refs === 0) return;
      // **同じファイルが両方の理由で挙がる周がある**（指し先の節を動かしたPRが、指す側の行も
      // 書き足している）。**多いほうを残す**——少ないほうで上書きすると、読む範囲が黙って縮む。
      const kept = found.get(rel);
      if (kept !== undefined && kept.refs >= refs) return;
      if (kept !== undefined) changed.splice(changed.indexOf(kept), 1);
      const entry = { file: rel, refs, why, where };
      found.set(rel, entry);
      changed.push(entry);
    };
    for (const rel of changedFiles.filter((rel) => bodies.has(rel))) {
      const lines = addedLines(root, ledger.commit, rel).filter(({ text }) => countRefs(text) > 0);
      const refs = lines.reduce((total, { text }) => total + countRefs(text), 0);
      add(rel, refs, '書き足された行に参照が在る', `行 ${lines.map(({ line }) => line).join('・')}`);
    }
    // **番号の指す先が動いた文書だけが、指している側を引く。** 本文だけの直しで引くと、活発な文書を
    // 指す全員が毎周積まれて、掃く分の予算が永久に空かない。
    const docs = new Set(trackedDocs(root).map(posix));
    for (const rel of changedFiles.filter((rel) => docs.has(rel))) {
      const before = contentAt(root, ledger.commit, rel);
      const after = contentAt(root, now, rel);
      if (before === null || after === null) continue;
      const moved = movedNumbers(before, after);
      if (moved.size === 0) continue;
      const base = rel.split('/').pop();
      for (const [source, text] of bodies) {
        if (source !== rel && !text.includes(base)) continue;
        const hits = refNumbers(text).filter((num) => moved.has(num));
        add(source, hits.length, `${rel} の節が動いた`, `節 ${[...new Set(hits)].join('・')}`);
      }
    }
    changed.sort((a, b) => (a.file < b.file ? -1 : 1));
  }

  // **掃くのは到達点の次から。** 前の周に読んだファイルが消えていても、並びの位置は動かない。
  const rest = sources.filter(
    (rel) => (ledger.through === null || rel > ledger.through) && countRefs(bodies.get(rel)) > 0,
  );
  const sweep = [];
  let spent = 0;
  for (const rel of rest) {
    const refs = countRefs(bodies.get(rel));
    // **予算を超えても、1ファイルは必ず出す。** 予算より参照の多いファイルで止めると、そこから
    // 先へ二度と進まない。
    if (sweep.length > 0 && spent + refs > budget) break;
    sweep.push({ file: rel, refs, why: '未読', where: 'すべて' });
    spent += refs;
  }
  return {
    ledger,
    head: now,
    /** 前の周の指紋を引けなかったか。引けない周は、変わった分を1件も出せない。 */
    lostWindow: ledger.commit !== null && changedFiles === null,
    changed,
    sweep,
    /** 掃く分が末尾まで届いたか。**変わった分はここに入らない**（あちらは尽きる先が無い）。 */
    swept: rest.length === sweep.length,
  };
}

/**
 * この周に読むものが在るか。**読むのは係の `due`**（[`board-move.mjs`](board-move.mjs) の
 * `CYCLES`）。
 *
 * **2つを別の細かさで見る。**
 *
 * - **掃き残し** … {@link refAuditBatch} が掃く分を選ぶのと**同じ見方**（参照を持つファイルだけを
 *   数える）。**並びの末尾に参照を持たないファイルが在る**ので、「到達点より後ろが在るか」だけで
 *   見ると、**係が掃き終えても真のまま戻らない**——毎周、範囲が空のセッションが立ち続ける。
 *   読むのは到達点より後ろだけで、**1つ見つかった時点で打ち切る**ので、掃き始めの周は1ファイル、
 *   掃き終えた後は末尾の数ファイルしか開かない。
 * - **変わった分** … **中身を開かず、射程のファイルが変わったかだけ**を見る。`due` は周回ごとに
 *   引かれるので、ここで差分を1つずつ読むと盤面の速さがリポジトリの大きさで決まる。**そのぶん、
 *   変わった行に参照が1つも無い周も立つ**（係は読むものが無かったと書いて終わる）。
 *
 * @param {string} root リポジトリの根
 * @returns {boolean}
 */
export function hasRefAuditWork(root, { ledger = readLedger(root) } = {}) {
  const sources = auditSources(root);
  const unread = sources.filter((rel) => ledger.through === null || rel > ledger.through);
  if (unread.some((rel) => countRefs(readFileSync(resolve(root, rel), 'utf-8')) > 0)) return true;
  if (ledger.commit === null) return true;
  const changed = changedSince(root, ledger.commit);
  // 前の周の指紋を引けない周は、変わった分を出せない＝読むものが無い（掃き終えた後の話）。
  return changed !== null && changed.some((rel) => sources.includes(rel));
}

function total(entries) {
  return entries.reduce((sum, entry) => sum + entry.refs, 0);
}

/**
 * 係へ渡す範囲を端末へ出す口（`node scripts/daemon/refAudit.mjs`）。**ひな形は範囲を自分で数えない**
 * ——数え方を2つ持つと、係が読んだ範囲と台帳へ書く到達点がずれる。
 */
function printBatch() {
  const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
  const batch = refAuditBatch(root);
  const lines = [`検めた時点: ${batch.ledger.commit ?? UNSET} → 現在: ${batch.head}`];
  lines.push(`到達点: ${batch.ledger.through ?? UNSET}`);
  if (batch.lostWindow) {
    lines.push('前の周の指紋をこの檻から引けない（変わった分は出せない。掃く分だけ読むこと）');
  }
  for (const [title, entries] of [
    ['変わった分', batch.changed],
    ['掃く分', batch.sweep],
  ]) {
    lines.push('', `## ${title}（${entries.length}ファイル・参照${total(entries)}件）`);
    for (const entry of entries) {
      lines.push(`${entry.file}\t${entry.refs}\t${entry.why}\t${entry.where}`);
    }
  }
  lines.push(
    '',
    batch.sweep.length === 0
      ? '掃く分は尽きている（到達点は書き換えない）'
      : `掃く分を読み終えたら 到達点: ${batch.sweep[batch.sweep.length - 1].file}`,
  );
  if (batch.swept && batch.sweep.length > 0) lines.push('これで末尾まで掃き終わる');
  process.stdout.write(`${lines.join('\n')}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  printBatch();
