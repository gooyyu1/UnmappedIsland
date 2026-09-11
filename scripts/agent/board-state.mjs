// デーモンが手元に置く台帳（`taken.json`）と、見回りの記録（`patrol.jsonl`）の読み書き、
// およびその置き場。
//
//   import { boardState, readLedger, writeLedger, UNREADABLE, readLastPatrol } from './board-state.mjs';
//
// **台帳を書くのは1周を回す側**（[`board-round.mjs`](board-round.mjs)）**だけ**で、ここは在り処と
// 形を持つ。**読む側が2つある**（[`board-publish.mjs`](board-publish.mjs) が `UNREADABLE` を人へ
// 見せる）ので、置き場の綴りを両方に書き写さないために分けてある。
//
// **見回りの記録を書くのは係のセッション**（[`patrol-prompt.md`](../../.claude/patrol-prompt.md)）で、
// 読むのは次の回の係と、人への書き出し（`board.mjs`）。

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * **盤面を引けなくなった時刻**（ISO。引けているあいだは台帳に無い）。
 *
 * **読む側は人だけ。** 引けない周にデーモンが打てる手は無い——CCRが落ちていればセッションは1本も
 * 立たないので、直せるのは Claude Code 本体を触れる人だけ（`.claude/board-design.md` 2.21.1）。
 * 常設の issue の本文へ出す（2.20）。
 *
 * **引けている周の不調はここに入らない。** 手が転んでいる・手が1つも出ない、といった形を見るのは
 * 見回る係（`board-move.mjs` の `CYCLES` の `patrol`）で、**係は印を見ずに毎回立つ**
 * ——印に掛からない壊れ方を拾うのがあちらの仕事だから（2.21.2）。
 *
 * **始まりだけを覚える。** 毎周書き直すと、続いた長さが出せない。
 */
export const UNREADABLE = 'unreadable:since';

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
 * 見回りの記録（1行1件のJSON。`.claude/board-design.md` 2.21.4）。**書くのは係のセッション**で、
 * 綴りを持つのは [`patrol-prompt.md`](../../.claude/patrol-prompt.md)。
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
