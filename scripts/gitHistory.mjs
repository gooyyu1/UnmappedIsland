// `main` の履歴を日本時間の日で切って読むための手。**日で切る道具が2つ以上あるので、ここに置く**
// ——[`historyStats.mjs`](historyStats.mjs)（規模の推移）と
// [`payoffMetrics.mjs`](payoffMetrics.mjs)（割に合っているか）が同じ切り方をする。
//
// 日付は**日本時間**で読み、その日の最終コミットの状態を測る。時差で日が変わるので、UTCの履歴を
// そのまま日で切ると1日ずれる。**呼ぶ側も日付をJSTで作ること**。

import { execFileSync } from 'node:child_process';

import { JAPAN_OFFSET, japanDayOf } from './japanDay.mjs';

/**
 * `git` を1回叩いて、末尾の改行を落とした標準出力を返す。
 *
 * `maxBuffer` を上げてあるのは、**履歴を丸ごと引く呼び出しがあるから**——既定の1MBでは
 * `git log --numstat` が途中で切れ、**切れたことは例外ではなく短い出力として返る。**
 */
export function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  }).trim();
}

/** コミットの時刻（`%at` のエポック秒）から、日本時間の日を出す。 */
export function dayOf(epochSeconds) {
  return japanDayOf(new Date(Number(epochSeconds) * 1000));
}

/**
 * 履歴を全部持っていないなら、何も測らずに落ちる。
 *
 * **浅いクローンでは、履歴を遡る道具が答えるべきものが元から無い。** 今のコミットだけから出せる列
 * （行数・今の定義の数）は出せてしまうので、**そこで表を出すと「測れた」形の表になり、貼った先で
 * 気づけない。** 数えられるものと数えられないものの線は、ここ1箇所で引く。
 *
 * @param what 何を測れないのかを告げる語（「育ち方」「割に合っているか」）。
 */
export function requireFullHistory(what) {
  if (git(['rev-parse', '--is-shallow-repository']) !== 'true') return;
  console.error(
    `浅いクローンでは${what}を測れない。'git fetch --unshallow origin' で履歴を取ってから走らせること。`,
  );
  process.exit(1);
}

/** その日（日本時間）の最終コミット。まだ1つも無い日は空文字。 */
export function revisionAt(day) {
  return git(['rev-list', '-1', `--before=${day} 23:59:59 ${JAPAN_OFFSET}`, 'HEAD']);
}
