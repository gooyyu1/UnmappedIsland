// デーモンが手元に置く台帳（`taken.json`）と、見回りの記録（`patrol.jsonl`）、**周の出来事の帳面**
// （`rounds.jsonl`）の読み書き、およびその置き場。
//
//   import { boardState, readLedger, writeLedger, UNREADABLE, readLastPatrol } from './board-state.mjs';
//
// **台帳を書くのは1周を回す側**（[`board-round.mjs`](board-round.mjs)）**だけ**で、ここは在り処と
// 形を持つ。**読む側は書く側とは別に居る**（[`board-publish.mjs`](board-publish.mjs) が
// `readUnreadable`・`readNotes`・`readPartialNotes` を通して人へ見せる）ので、置き場の綴りを
// 両方に書き写さないために分けてある。
//
// **見回りの記録を書くのは係のセッション**（[`patrol-prompt.md`](../../agent-ops/prompts/patrol-prompt.md)）で、
// 読むのは次の回の係と、人への書き出し（`board.mjs`）。
//
// **周の出来事を書くのも1周を回す側で、読むのは書き出す側**（`agent-ops/board-design.md` 2.20.3節）。
// 周（既定30秒）と書き出し（既定5分）は別の周期で走る別のプロセスなので、**周の出来事が人の見に来る
// 場所へ届く道は、ここを通るものしか無い。**

import {
  appendFileSync,
  closeSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

/**
 * **盤面を引けなくなった時刻**（ISO。引けているあいだは台帳に無い）。
 *
 * **読む側は人だけ。** 引けない周にデーモンが打てる手は無い——CCRが落ちていればセッションは1本も
 * 立たないので、直せるのは Claude Code 本体を触れる人だけ（`agent-ops/board-design.md` 2.21.1節）。
 * 常設の issue の本文へ出す（2.20）。
 *
 * **引けている周の不調はここに入らない。** 手が転んでいる・手が1つも出ない、といった形を見るのは
 * 見回る係（`board-move.mjs` の `CYCLES` の `patrol`）で、**係は印を見ずに毎回立つ**
 * ——印に掛からない壊れ方を拾うのがあちらの仕事だから（2.21.2）。
 *
 * **始まりだけを覚える。** 毎周書き直すと、続いた長さが出せない。
 */
export const UNREADABLE = 'unreadable:since';

/** その区間で**最後に引けなかった周**の時刻（ISO）。引けた周に区間を閉じるとき、終わりになる。 */
export const UNREADABLE_UNTIL = 'unreadable:until';

/** その区間で引けなかった**周の数**。**長さでは代えられない**——待つ間隔は環境変数で動く。 */
export const UNREADABLE_ROUNDS = 'unreadable:rounds';

/**
 * その区間で**道具が最後に言った理由**（`list_sessions: 失敗: HTTP 401 …` など）。
 *
 * **後から状態を見て推し量らない**（[`policies.md`](../../agent-ops/policies.md)「理由の持たせ方」）
 * ——引けなかった理由を言えるのは、引きに行った道具だけ。
 */
export const UNREADABLE_REASON = 'unreadable:reason';

/**
 * **配れない理由**（[`board-move.mjs`](board-move.mjs) の `NOTE`）が**出始めた時刻**を置く、台帳の
 * 鍵の頭。鍵の残りはその理由の本文そのもの。
 *
 * **始まりだけを覚えるのは `UNREADABLE` と同じ理由**——毎周書き直すと、同じ理由が何分続いているかが
 * 出せない。**読む人が知りたいのはそこ**で、1周ぶんの覚え書きは「今はやることが無い」と見分けが
 * 付かない（`agent-ops/board-design.md` 2.20.3節）。
 */
export const NOTE_PREFIX = 'note:';

/**
 * **この周の盤面が欠けている理由**（[`board-read.mjs`](board-read.mjs) の `sayIncomplete`）を置く、
 * 台帳の鍵の頭。鍵の残りはその断りの本文そのもの。
 *
 * **配れない理由（上の `NOTE_PREFIX`）とは別に持つ。** 読む人がすることが違う——あちらは**盤面が
 * 何かを待っている**ことで、こちらは**盤面がその周に全部を見られなかった**こと。1つの枠で兼ねると、
 * 待っているだけの周が「盤面が壊れている」に見える（[`policies.md`](../../agent-ops/policies.md)
 * 「数と印は、由来ごとに分ける」）。
 */
export const PARTIAL_PREFIX = 'partial:';

/** 台帳と心拍の置き場（[`daemon.sh`](daemon.sh) の `STATE_DIR` と同じ既定）。 */
export function boardState() {
  return process.env.BOARD_STATE ?? `${process.env.USERPROFILE ?? process.env.HOME}/.claude/board-state`;
}

const ledgerPath = (stateDir) => join(stateDir, 'taken.json');

/** 台帳を読む。**読めなければ空**——失われたときの害は、同じ手が1回重なることだけ。 */
export function readLedger(stateDir) {
  try {
    return JSON.parse(readFileSync(ledgerPath(stateDir), 'utf8'));
  } catch {
    return {};
  }
}

export function writeLedger(stateDir, taken) {
  writeFileSync(ledgerPath(stateDir), `${JSON.stringify(taken, undefined, 2)}\n`);
}

/**
 * 見回りの記録（1行1件のJSON。`agent-ops/board-design.md` 2.21.4節）。**書くのは係のセッション**で、
 * 綴りを持つのは [`patrol-prompt.md`](../../agent-ops/prompts/patrol-prompt.md)。
 *
 * **追記で持つのは、前回と突き合わせるため**——進んでいないことは1枚の写真には写らない。
 */
export const patrolPath = (stateDir) => join(stateDir, 'patrol.jsonl');

/**
 * 最後の見回り（`at`・`verdict`・`summary`）。**一度も走っていない周と、記録が壊れている周は
 * `undefined`。** 読む側（`board.mjs`）はどちらも「見回りが届いていない」として同じに扱う
 * ——人から見れば、走らなかったのと読めないのは同じだけ危ない。
 */
export function readLastPatrol(stateDir) {
  let text;
  try {
    text = readFileSync(patrolPath(stateDir), 'utf8');
  } catch {
    return undefined;
  }
  const lines = text.split('\n').filter((line) => line !== '');
  // **最後の1行だけを見る。** 手前に壊れた行が在っても、要るのは直近の1件。
  const last = lines[lines.length - 1];
  if (last === undefined) return undefined;
  try {
    const record = JSON.parse(last);
    // **時刻として読めない記録は、無かったことにする。** 読む側が要るのは「いつの見回りか」で、
    // それが出ない行は走ったことの証拠にならない。
    if (typeof record.at !== 'string' || Number.isNaN(Date.parse(record.at))) return undefined;
    return { at: record.at, verdict: String(record.verdict ?? ''), summary: String(record.summary ?? '') };
  } catch {
    return undefined;
  }
}

/**
 * 今その周に出ている**配れない理由**と、それが出始めた時刻（古い順）。**書くのは1周を回す側**で、
 * 読むのは人への書き出し（`board.mjs`）。
 */
export function readNotes(stateDir) {
  return marked(readLedger(stateDir), NOTE_PREFIX);
}

/**
 * この周の盤面が欠けている理由（古い順）。**書くのは1周を回す側**で、読むのは人への書き出し。
 * **続いている長さは出さない**——欠けは1周ごとに出直すもので、読む人が要るのは今そうであること。
 */
export function readPartialNotes(stateDir) {
  return marked(readLedger(stateDir), PARTIAL_PREFIX).map((note) => note.text);
}

/** 台帳から、その頭を持つ鍵を拾って本文と時刻に分ける。並びは古い順（長く続いているものが先）。 */
function marked(taken, prefix) {
  return Object.entries(taken)
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, since]) => ({ text: key.slice(prefix.length), since: String(since) }))
    .sort((one, other) => (one.since < other.since ? -1 : one.since > other.since ? 1 : 0));
}

/**
 * **今まさに盤面を引けていない**ことと、その区間の いつから・いつまで・何周・道具が言った理由。
 * 引けているあいだは `undefined`。
 *
 * **欠けた値は補って返す。** 台帳は前の版が書いたものでもありうるので、**始まりだけが読めれば
 * 断りは出せる**——読む人に要るのは「引けていない」がまず届くことで、周の数はその次。
 */
export function readUnreadable(stateDir) {
  const taken = readLedger(stateDir);
  const since = taken[UNREADABLE];
  if (since === undefined) return undefined;
  const rounds = Number(taken[UNREADABLE_ROUNDS]);
  return {
    since,
    until: taken[UNREADABLE_UNTIL] ?? since,
    rounds: Number.isFinite(rounds) && rounds > 0 ? rounds : 1,
    reason: taken[UNREADABLE_REASON] ?? '',
  };
}

/**
 * **周の出来事の帳面**（1行1件のJSON。`agent-ops/board-design.md` 2.20.3節）。**書くのは1周を回す
 * 側**で、読むのは人への書き出し（`board.mjs`）と、盤面を見回る係。
 *
 * 載るのは2種類——**打った手とその結果**（`{ at, kind: 'move', move, target, result }`）と、
 * **閉じた「盤面を引けなかった区間」**（`{ at, kind: 'gap', from, until, rounds, reason }`）。
 *
 * **追記だけで、古い行を落とす者は置かない**（`patrol.jsonl`・`conflicts.jsonl` と同じ）。**猶予を
 * 詰める材料はここ**——何度も繰り返す短い停止は、区間が閉じるたびにここへ1行ずつ残る（2.22.2 が
 * 待っている「実際に鳴った回数」）。
 */
export const journalPath = (stateDir) => join(stateDir, 'rounds.jsonl');

/**
 * 末尾から読む量。**窓（`board.mjs` の `EVENT_WINDOW_HOURS`）のぶんが必ず入る大きさ**にしてある
 * ——1件はおよそ100バイトで、周（[`daemon.sh`](daemon.sh) の `INTERVAL`、既定30秒）が毎回1件書いても
 * 1日で30万バイトに届かない。**窓を広げるか周を速くしたら、ここも見直す**——突き合わせは検査が持つ
 * （`tests/scripts/roundEventsReachPeople.test.ts`）。
 */
export const JOURNAL_TAIL_BYTES = 1024 * 1024;

/** 周の出来事を1件書く。**書けなくても周は止めない**——落ちるのは届け先であって、打つ手ではない。 */
export function appendRound(stateDir, record) {
  try {
    appendFileSync(journalPath(stateDir), `${JSON.stringify(record)}\n`);
  } catch {
    // 置き場そのものが無い周（台帳を作る手前）。次の周が書く。
  }
}

/**
 * 帳面の**末尾だけ**を読む。**読むのは書き出す側で、要るのは直近の窓のぶんだけ**——帳面は落とす者が
 * 居ないので、丸ごと読む形にすると、**回るほど読む量が増える**
 * （[`policies.md`](../../agent-ops/policies.md)「仕組みの作り方」）。
 *
 * **途中から読んだ回は、先頭の1行が欠けている**ので捨てる。壊れた行も同じ——取りこぼす害は、その
 * 1件が本文に出ないことだけ。
 */
export function readRounds(stateDir) {
  const path = journalPath(stateDir);
  let text;
  try {
    const { size } = statSync(path);
    if (size === 0) return [];
    const from = Math.max(0, size - JOURNAL_TAIL_BYTES);
    const buffer = Buffer.alloc(size - from);
    const fd = openSync(path, 'r');
    try {
      readSync(fd, buffer, 0, buffer.length, from);
    } finally {
      closeSync(fd);
    }
    text = buffer.toString('utf8');
    if (from > 0) text = text.slice(text.indexOf('\n') + 1);
  } catch {
    return [];
  }
  const records = [];
  for (const line of text.split('\n')) {
    if (line === '') continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      continue;
    }
  }
  return records;
}
