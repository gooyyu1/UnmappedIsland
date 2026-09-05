// 盤面の1周。**引き、手を1つ打つ。** 待つことと二重に立たないことは
// [`daemon.sh`](daemon.sh)、盤面を組むのは [`board-read.mjs`](board-read.mjs)、手を決めるのは
// [`board-move.mjs`](board-move.mjs)。ここがやるのは**打つこと**と、その記録だけ。
//
//   node scripts/agent/board-round.mjs         # 1周。引けなければ終了コード1
//   DRY_RUN=1 node scripts/agent/board-round.mjs
//
// ## 打つのは1周に1手
//
// マージが1本入れば他のPRのコンフリクトや `blockedBy` が動くので、盤面は打つたびに変わる。
// **同じ周に2手目を打つと、変わる前の盤面で決めた手を打つことになる。**
//
// 上から順に、**打てた最初の1手**で切り上げる。打てなかった手（手綱で止まっている・相手が
// 動き出した）で周ごと止めると、止まっている種類と関係のない手まで巻き添えになる。
//
// ## 1周をプロセス1つに収める
//
// 引く・決める・打つを1つの node の中で済ませるのは、**Windowsではプロセス生成が1回10〜30ms
// かかる**ため（#1545 の実測）。デーモンは1周ごとにここを通るので、境界の数がそのまま常時の
// 固定費になる。**外へ出るのは、外の道具を叩くときだけ**——`gh` と、隣のスクリプト。
//
// 外を触る手（`runScript`・`gh`・一覧）と、出す先（`log`・`echo`）を引数で受けるのは、**実物を
// 起こさずに検査するため**。既定は本物なので、コマンドとして呼ぶ側は何も渡さなくてよい。

import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { busySession, moves } from './board-move.mjs';
import { readBoard } from './board-read.mjs';
import { formatLive, liveSessions } from './live-sessions.mjs';
import { gh as runGh, posix, runBash } from './spawn.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** 打った手を、そのとき盤面がどう見えていたか（指紋）とともに残す台帳。 */
const ledgerPath = (stateDir) => join(stateDir, 'taken.json');

/**
 * ぶつかった実績の帳面（1行1件のJSON。`.claude/board-design.md` 3.1）。**盤面は同じファイルを書く
 * issue を並べて投入する**ので、実際にぶつかった組を控えておかないと、`area:` の錠を足すべき資源が
 * 後から分からない。**手ではない**——打つ手が何であっても、見えたものをその周のうちに書く。
 */
const conflictsPath = (stateDir) => join(stateDir, 'conflicts.jsonl');

const stamp = (date = new Date()) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * ログは1行1件で、頭に時刻が付く（`daemon.sh` と同じ形）。**書き込みは同期で行う**——叩いた
 * スクリプトの出力はこちらの標準出力へ直に流れるので、非同期に貯めると打った手とその結果が
 * 入れ替わって並ぶ。
 */
const defaultLog = (line) => writeSync(1, `${stamp()} ${line}\n`);
const defaultEcho = (text) => writeSync(1, text);
const defaultWarn = (line) => writeSync(2, `${line}\n`);

/** 隣のスクリプトを1本叩く。 */
const defaultRunScript = (name, args, options) => runBash(join(HERE, name), args, options);

function readLedger(stateDir) {
  try {
    return JSON.parse(readFileSync(ledgerPath(stateDir), 'utf8'));
  } catch {
    return {};
  }
}

function writeLedger(stateDir, taken) {
  writeFileSync(ledgerPath(stateDir), `${JSON.stringify(taken, undefined, 2)}\n`);
}

/** 帳面に既に載っている `<PR>:<先頭コミット>`。読めない周は空（帳面がまだ無い周と同じ）。 */
function writtenConflicts(stateDir) {
  let text;
  try {
    text = readFileSync(conflictsPath(stateDir), 'utf8');
  } catch {
    return new Set();
  }
  const keys = new Set();
  for (const line of text.split('\n')) {
    if (line === '') continue;
    // 壊れた行は無かったことにする。**取りこぼす害は同じ組を二度書くことだけ**なので、
    // 帳面ごと諦めるより軽い。
    try {
      const record = JSON.parse(line);
      keys.add(`${record.pr}:${record.head}`);
    } catch {
      continue;
    }
  }
  return keys;
}

/** [`describe-conflict.sh`](describe-conflict.sh) の出力。調べられなければ `undefined`。 */
function describeConflict(runScript, number) {
  const out = runScript('describe-conflict.sh', [String(number)], { capture: true });
  if (out.status !== 0) return undefined;
  const files = [];
  const rivals = [];
  for (const line of out.stdout.split(/\r?\n/)) {
    if (line.startsWith('FILE ')) files.push(line.slice('FILE '.length));
    else if (line.startsWith('WITH ')) rivals.push(Number(line.slice('WITH '.length)));
  }
  return { files, with: rivals };
}

/**
 * この周で新しく見えたコンフリクトの記録。**同じ差分は一度だけ**——押し返されるまで盤面は
 * `CONFLICTING` を返し続けるので、`<PR>:<先頭コミット>` を控えて突き合わせる（打つ手の指紋と同じ形）。
 *
 * `describe` は「そのPRが何のファイルで・どのPRとぶつかったか」を返す
 * （[`describe-conflict.sh`](describe-conflict.sh)）。**調べられなかったものは書かない**——次の周に
 * 調べ直せるよう、指紋を埋めずに残す。
 *
 * **併合し直せてしまったものは、空のまま書く。** GitHub の `mergeable` は `main` が動くたびに
 * 古くなるので、`CONFLICTING` と言われた差分が手元では綺麗に併合できることがある。**これは調べた
 * 結果であって失敗ではない**ので、指紋を埋めて次の周から見ない（`ARCHIVE` の `KEPT` と同じ形）。
 */
export function newConflicts(prs, written, describe, at) {
  const records = [];
  for (const pr of prs) {
    if (pr.mergeable !== 'CONFLICTING') continue;
    // **他のPRの上に積まれたPRは数えない。** GitHub が見ているのはその base との衝突で、
    // `describe-conflict.sh` が調べる `main` との衝突とは別物。
    if ((pr.baseRefName ?? 'main') !== 'main') continue;
    const head = pr.headRefOid;
    if (written.has(`${pr.number}:${head}`)) continue;
    const found = describe(pr.number);
    if (found === undefined) continue;
    records.push({ at, pr: pr.number, head, files: found.files, with: found.with });
  }
  return records;
}

/** 消えたPR・畳まれたセッションの記録は捨てる。残すと、番号が回り込んだときに古い指紋が効く。 */
export function pruneTaken(taken, board) {
  const ids = new Set(board.sessions.map((session) => session.id));
  const numbers = new Set(board.prs.map((pr) => String(pr.number)));
  const kept = {};
  for (const [key, mark] of Object.entries(taken)) {
    const lives =
      (key.startsWith('resume:') && ids.has(key.slice('resume:'.length))) ||
      (key.startsWith('review:') && numbers.has(key.slice('review:'.length))) ||
      (key.startsWith('archive:') && ids.has(key.slice('archive:'.length))) ||
      (key.startsWith('idle:') && ids.has(key.slice('idle:'.length)));
    if (lives) kept[key] = mark;
  }
  return kept;
}

/**
 * **手が空いたのはいつからか**を覚える（`board-move.mjs` の `STALL_MINUTES`）。停滞を「空いて
 * いること」で読むと、手番の切れ目ごとに空くワーカーを毎回停滞と読む——盤面はそれで、押し切る
 * 寸前の作業を人へ返して畳んだ（2026-09-06、issue #1506）。
 *
 * **動き出したら、覚えも「起こしたが動かなかった」の記録も消す。** 動いた時点でどちらも嘘に
 * なるので、残すと**次に空いた瞬間に、起こす手順を飛ばして人へ返す**ことになる。
 */
export function trackIdle(taken, board, now) {
  const marked = { ...taken };
  for (const session of board.sessions) {
    const idle = `idle:${session.id}`;
    const resume = `resume:${session.id}`;
    if (busySession(session)) {
      delete marked[idle];
      if ((marked[resume] ?? '').startsWith('stall:')) delete marked[resume];
      continue;
    }
    marked[idle] ??= now;
  }
  return marked;
}

/**
 * 人へ返すときに issue へ置くコメント。**1行目が返却の宣言**で、ここを読んでラベルを動かすのは
 * [`board-labels.yml`](../../.github/workflows/board-labels.yml)——**ワーカーが自分で返すときと同じ道**
 * （`.claude/board-design.md` 2.15）。ラベルを盤面から直に触らないので、返す経路が2つに割れない。
 */
const returnBody = (session, issue) =>
  `[返却] 起こしても手が動かなかった

担当していたセッション（\`${session}\`）は、PRを出さないまま手が空いた状態が続き、盤面が一度
起こしても何も出てきませんでした。**返却の宣言は届いていません**——止まった理由はここには書けません。

同じ内容でもう一度投入するなら、この issue（#${issue}）から \`判断待ち\` を外してください。
`;

/** 1手打つ。打てたら `true`、打たなかったら `false`（呼び手は次の手へ進む）。 */
export function play(kind, args, { runScript, gh, remember, log, echo }) {
  const [a = '', b = '', c = '', d = ''] = args;
  switch (kind) {
    case 'MERGE': {
      // 終了コード2は「マージはできたが後始末が残った」。手は打てているので、次の周は別の手へ進む。
      const code = runScript('merge-and-close.sh', [a]).status;
      return code === 0 || code === 2;
    }
    case 'RESUME': {
      if (runScript('resume-session.sh', [a, b, c]).status !== 0) return false;
      remember(`resume:${a}`, d);
      return true;
    }
    case 'RETURN': {
      // 本文は複数行なので、引数ではなくファイルで渡す。**`gh` は Windows のバイナリ**なので、
      // そのパスは `posix()` を通さない生のまま（あれはシェルへ渡すときの作法）。
      const work = mkdtempSync(join(tmpdir(), 'board-round-'));
      try {
        const body = join(work, 'return.md');
        writeFileSync(body, returnBody(b, a));
        if (gh(['issue', 'comment', a, '--body-file', body]) === undefined) return false;
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
      remember(`resume:${b}`, c);
      return true;
    }
    case 'REVIEW': {
      if (runScript('dispatch-review.sh', [a]).status !== 0) return false;
      remember(`review:${a}`, b);
      return true;
    }
    case 'ARCHIVE': {
      // 畳んでよいかの判定は [`archive-session.sh`](archive-session.sh) が持つ。**終了コードは見ない**
      // ——あちらは1件ずつの結果を行で返す。`--keep-untagged` は、ここへ来る相手が必ずワーカーか
      // レビューであること（盤面の側の約束）を、畳む手前でもう一度確かめるため。
      const out = runScript('archive-session.sh', ['--keep-untagged', 'task-,review-'], {
        input: `${a}\n`,
        capture: true,
      });
      if (out.status !== 0) return false;
      echo(`${out.stdout.replace(/\n+$/, '')}\n`);

      const verdicts = out.stdout.split(/\r?\n/);
      if (verdicts.includes(`ARCHIVED ${a}`)) return true;
      // `KEPT` は「畳んではいけない」という**安定した答え**（ブリッジのもの・素性を引けなかったもの）。
      // 指紋を残さないと、**1周1手のうちの1手がこれで埋まり続ける。** `UNARCHIVED` は失敗なので残さず、
      // 次の周にもう一度試す。
      if (verdicts.includes(`KEPT ${a}`)) remember(`archive:${a}`, b);
      return false;
    }
    case 'TASK': {
      // **補足は無い。** 書けるのはモデルだけで、デーモンには書くものが無い——issue 本文が全部を持つ
      // （`dispatch-task.sh`「書くことが無いなら、空のファイルでよい」）。
      //
      // 投入先は盤面が決めて引数の形で寄越す（2.16）。**どの `env:` がどこを指すかはここには無い**
      // ——知っているのは盤面だけで、こちらはそれをそのまま渡す。
      const work = mkdtempSync(join(tmpdir(), 'board-round-'));
      try {
        const supplement = join(work, 'supplement.md');
        writeFileSync(supplement, '');
        const where = b === '' ? [] : [b];
        return runScript('dispatch-task.sh', [a, posix(supplement), ...where]).status === 0;
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    }
    default:
      log(`知らない手なので打たない: ${kind} ${a} ${b} ${c}`);
      return false;
  }
}

/** 1周。盤面を引けたら `true`、引けなかったら `false`（呼び手はその周を捨てる）。 */
export function round({
  runScript = defaultRunScript,
  gh = runGh,
  sessions = liveSessions,
  log = defaultLog,
  echo = defaultEcho,
  warn = defaultWarn,
  now = () => new Date(),
  stateDir = process.env.BOARD_STATE ?? `${process.env.USERPROFILE ?? process.env.HOME}/.claude/board-state`,
  // チェックが1本も登録されないPRを緑と読むまでの猶予。登録の途中と見分けが付かないので待つ。
  settleMinutes = Number(process.env.SETTLE_MINUTES || 10),
  dryRun = (process.env.DRY_RUN ?? '') !== '',
} = {}) {
  // **一覧はこの周に1回だけ引く**（`board-design.md` 1.7）。要る側は4つあり、それぞれが自分で
  // 引くと同じ答えを4回買うことになる——`list_sessions` の上限は1時間あたりで数えるので、その
  // 回数がそのまま盤面の回る速さの天井になる。引いたものはファイルへ置き、叩くスクリプトへは
  // 環境変数で在り処だけを渡す。**この周のうちに立ったセッションは、次の周の一覧に載る。**
  let live;
  try {
    live = sessions();
  } catch (error) {
    // **理由を言えるのは投げた側だけ**なので、その言葉をそのまま出す。
    warn(error instanceof Error ? error.message : String(error));
    return false;
  }
  const livePath = join(stateDir, 'live-sessions.tsv');
  writeFileSync(livePath, live.map((session) => `${formatLive(session)}\n`).join(''));
  // **在り処は、叩く相手にだけ渡す。** `process.env` を書き換えると、同じプロセスで動く他の呼び手
  // にも見える（`spawn.mjs`）。
  const runScriptHere = (name, args, options) =>
    runScript(name, args, { ...options, env: { LIVE_SESSIONS_TSV: livePath } });

  const spent = runScriptHere('usage-record.sh', [], { capture: true });
  if (spent.status !== 0) log('使用量を引けなかった');
  for (const line of spent.stdout.split(/\r?\n/)) {
    if (line !== '') log(`消費 ${line}`);
  }

  const taken = readLedger(stateDir);
  const at = now();
  const board = readBoard({ gh, sessions: () => live, log, now: at, settleMinutes, taken });
  if (board === undefined) return false;

  const remaining = trackIdle(pruneTaken(taken, board), board, at.toISOString());
  writeLedger(stateDir, remaining);
  board.taken = remaining;
  const remember = (key, mark) => {
    remaining[key] = mark;
    writeLedger(stateDir, remaining);
  };

  // **ぶつかった実績を控える**（3.1）。手を決める前に置くのは、**打った手で周が終わっても
  // 書き終わっているようにする**ため——記録は手ではないので、1周1手の勘定には入らない。
  for (const record of newConflicts(
    board.prs,
    writtenConflicts(stateDir),
    (number) => describeConflict(runScript, number),
    stamp(now()),
  )) {
    appendFileSync(conflictsPath(stateDir), `${JSON.stringify(record)}\n`);
    if (record.files.length === 0) {
      log(`PR #${record.pr} は手元では併合できた（GitHub の \`mergeable\` が古い）`);
      continue;
    }
    const rivals = record.with.map((number) => `#${number}`).join(' ');
    log(`ぶつかった: PR #${record.pr} ${record.files.join(' ')}${rivals === '' ? '' : ` … ${rivals}`}`);
  }

  const lines = moves(board);
  for (const line of lines) {
    if (line.startsWith('NOTE ')) log(`覚え書き: ${line.slice('NOTE '.length)}`);
  }

  const played = lines.filter((line) => !line.startsWith('NOTE '));
  if (dryRun) {
    for (const line of played) log(`打たない手: ${line}`);
    return true;
  }

  for (const line of played) {
    const [kind, ...args] = line.split(' ');
    const [a = '', b = '', c = ''] = args;
    log(`打つ: ${kind} ${a} ${b} ${c}`);
    if (play(kind, args, { runScript: runScriptHere, gh, remember, log, echo })) {
      log(`打てた: ${kind} ${a}`);
      return true;
    }
    log(`打てなかった: ${kind} ${a}`);
  }
  return true;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(round() ? 0 : 1);
  } catch (error) {
    // 呼び手（`daemon.sh`）が終了コードから言えるのは「引けなかった」だけ。**引けなかった以外で
    // 落ちたことは、ここで言わないと誰も言わない**——引き続き諦める側へ倒すが、手掛かりは残す。
    defaultWarn(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(1);
  }
}
