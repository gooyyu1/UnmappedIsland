// デーモンが見ている盤面を、常設の issue の本文へ書き出す（`.claude/board-design.md` 2.20）。
//
//   node scripts/agent/board-publish.mjs        # 1回書き込む。書けなければ終了コード1
//   BOARD_ISSUE=1714 node scripts/agent/board-publish.mjs
//
// **並べる形は隣の [`board.mjs`](board.mjs)**（`issueBody`）。ここが持つのは**届け先**だけ。
//
// ## 読むのは人だけで、機械はここを読まない
//
// 盤面の事実は GitHub と CCR に在り、[`board-round.mjs`](board-round.mjs) は毎周そちらから引き直す。
// **ここが書くのは、そのときの見え方の写し**——**写しを持つと古くなったことに誰も気づけない**
// （[`parallel-work.md`](../../.claude/parallel-work.md) 5節）ので、**いつ時点かを本文へ一緒に書く。**
// 機械が読み返さないので、古い写しが手を決めることはない。
//
// **周期を持つのは呼び手**（[`daemon.sh`](daemon.sh)）。ここは呼ばれたら1回書くだけで、間隔を知らない
// ——手で叩いた1回が「まだ早い」と言って何もしないのは、叩いた側から見て何も起きていないのと同じ。

import { mkdtempSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UNREADABLE, boardState, readLastPatrol, readLedger } from './board-state.mjs';
import { issueBody } from './board.mjs';
import { gh as runGh } from './spawn.mjs';

/**
 * 書き込む先。**環境変数で差し替えられる定数**（[`brake.sh`](brake.sh) の `BRAKE_ISSUE` と同じ形）
 * ——常設の issue は1本しか無いので、呼び手に毎回渡させるものではない。
 */
const ISSUE = process.env.BOARD_ISSUE ?? '1714';

const defaultWarn = (line) => writeSync(2, `${line}\n`);

/**
 * 1回書き込む。書けたら `true`。
 *
 * **issue とPRを引けなかったら、書き込まない。** 欠けた盤面で上書きすると、**在るはずのものが
 * 消えた盤面**が残る——古いままのほうが、読む側は最終更新の時刻で気づける。**セッションの一覧を
 * 引けなかっただけなら書き込む**（[`board.mjs`](board.mjs) が、一覧を根拠にした行を落として組む）。
 *
 * **盤面を引けていない印は、デーモンの台帳から引く**（[`board-state.mjs`](board-state.mjs)）。
 * 置くのは1周を回す側で、**人へ見せるのはここ**——引けない周にできるのはこれだけ（2.21）。
 *
 * **見回りの記録も同じ理由でここから渡す。** 書くのは係のセッションで、**走ったこと自体が人に
 * 見えるのはこの本文だけ**（2.21.4）。
 */
export function publish({
  gh = runGh,
  body = issueBody,
  issue = ISSUE,
  warn = defaultWarn,
  unreadableSince = readLedger(boardState())[UNREADABLE],
  patrol = readLastPatrol(boardState()),
} = {}) {
  const text = body({ gh, warn, unreadableSince, patrol });
  if (text === undefined) return false;

  // 本文は複数行なので、引数ではなくファイルで渡す（`board-round.mjs` の `RETURN` と同じ）。
  const work = mkdtempSync(join(tmpdir(), 'board-publish-'));
  try {
    const file = join(work, 'body.md');
    writeFileSync(file, text);
    return gh(['issue', 'edit', issue, '--body-file', file]) !== undefined;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(publish() ? 0 : 1);
}
