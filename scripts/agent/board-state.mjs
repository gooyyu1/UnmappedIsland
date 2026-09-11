// デーモンが手元に置く台帳（`taken.json`）の読み書きと、その置き場。
//
//   import { boardState, readLedger, writeLedger, STUCK } from './board-state.mjs';
//
// **書くのは1周を回す側**（[`board-round.mjs`](board-round.mjs)）**だけ**で、ここは在り処と形を
// 持つ。**読む側が2つある**（[`board-publish.mjs`](board-publish.mjs) が `STUCK` を人へ見せる）ので、
// 置き場の綴りを両方に書き写さないために分けてある。

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * **盤面が進んでいないと見え始めた時刻**（ISO。進んでいるあいだは台帳に無い）。
 *
 * 読む側が2つあり、**同じ1つの印を別のことに使う**（`.claude/board-design.md` 2.21）。
 *
 * - **人**……盤面を引けない周は、CCRが落ちているので誰もセッションを立てられない。直せるのは
 *   Claude Code 本体を触れる人だけなので、常設の issue の本文へ出す（2.20）。
 * - **詰まりを解く係**（[`board-move.mjs`](board-move.mjs) の `CYCLES`）……盤面は引けているのに
 *   手が打てない周は、原因を探して直すのに判断が要る。
 */
export const STUCK = 'stuck:since';

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
