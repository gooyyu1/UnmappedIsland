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

import { mkdtempSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { moves } from './board-move.mjs';
import { readBoard } from './board-read.mjs';
import { posix, runBash } from './spawn.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** 打った手を、そのとき盤面がどう見えていたか（指紋）とともに残す台帳。 */
const ledgerPath = (stateDir) => join(stateDir, 'taken.json');

const stamp = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

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

/** 消えたPR・畳まれたセッションの記録は捨てる。残すと、番号が回り込んだときに古い指紋が効く。 */
export function pruneTaken(taken, board) {
  const ids = new Set(board.sessions.map((session) => session.id));
  const numbers = new Set(board.prs.map((pr) => String(pr.number)));
  const kept = {};
  for (const [key, mark] of Object.entries(taken)) {
    const lives =
      (key.startsWith('resume:') && ids.has(key.slice('resume:'.length))) ||
      (key.startsWith('review:') && numbers.has(key.slice('review:'.length))) ||
      (key.startsWith('archive:') && ids.has(key.slice('archive:'.length)));
    if (lives) kept[key] = mark;
  }
  return kept;
}

/** 1手打つ。打てたら `true`、打たなかったら `false`（呼び手は次の手へ進む）。 */
export function play(kind, args, { runScript, remember, log, echo }) {
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
      // （`dispatch-task.sh`「重なりが無くて書くことが無いなら、空のファイルでよい」）。
      const work = mkdtempSync(join(tmpdir(), 'board-round-'));
      try {
        const supplement = join(work, 'supplement.md');
        writeFileSync(supplement, '');
        return runScript('dispatch-task.sh', [a, posix(supplement)]).status === 0;
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
  gh,
  sessions,
  log = defaultLog,
  echo = defaultEcho,
  warn = defaultWarn,
  now = () => new Date(),
  stateDir = process.env.BOARD_STATE ?? `${process.env.USERPROFILE ?? process.env.HOME}/.claude/board-state`,
  // チェックが1本も登録されないPRを緑と読むまでの猶予。登録の途中と見分けが付かないので待つ。
  settleMinutes = Number(process.env.SETTLE_MINUTES || 10),
  dryRun = (process.env.DRY_RUN ?? '') !== '',
} = {}) {
  const spent = runScript('usage-record.sh', [], { capture: true });
  if (spent.status !== 0) log('使用量を引けなかった');
  for (const line of spent.stdout.split(/\r?\n/)) {
    if (line !== '') log(`消費 ${line}`);
  }

  const taken = readLedger(stateDir);
  let board;
  try {
    board = readBoard({ gh, sessions, log, now: now(), settleMinutes, taken });
  } catch (error) {
    // 一覧を引けなかった周（`live-sessions.mjs`）。**理由を言えるのは投げた側だけ**なので、
    // その言葉をそのまま出す。
    warn(error instanceof Error ? error.message : String(error));
    return false;
  }
  if (board === undefined) return false;

  const remaining = pruneTaken(taken, board);
  writeLedger(stateDir, remaining);
  const remember = (key, mark) => {
    remaining[key] = mark;
    writeLedger(stateDir, remaining);
  };

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
    if (play(kind, args, { runScript, remember, log, echo })) {
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
