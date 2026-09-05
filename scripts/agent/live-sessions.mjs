// **畳まれていないセッション**を引く。「畳まれていない」の定義はここ1箇所だけが持つ。
//
//   import { liveSessions } from './live-sessions.mjs';
//   liveSessions()   // → [{ id, status, bucket, tags: [] }]
//
// コマンドとして呼ぶと1行1件のTSVを出す（入口は [`live-sessions.sh`](live-sessions.sh)）。
// 1行が `<セッションID>\t<session_status>\t<status_bucket>\t<タグをカンマで繋いだもの>`。1本も
// 無ければ**何も出さずに終了コード0**。**引けなかったときは終了コード1**で、呼び手は止まる側へ
// 倒せる。
//
// ## なぜ切り出したか
//
// 一覧を要る側は1つではない（呼び手は `live-sessions` で検索すれば出る。
// [`board-design.md`](../../.claude/board-design.md) 2.5.3）。**同じ条件を複数箇所へ書くと、
// 片方だけが直る。**
//
// ## 絞るのは `SESSION_STATUS_ARCHIVED` だけ
//
// **手が空いていることは、仕事が終わったことではない。** `status_bucket` が
// `..._COMPLETED` / `..._BLOCKED` / `..._FAILED` でも、そのセッションは仕事を持ったまま次の指示を
// 待っている——**畳まれたセッションでさえ、`unarchive_session` → `send_message` で文脈ごと再開
// できる**（1.5 の実測）。ここで落とすと、占有の側が「空いている」と読んで二重に立てる。
//
// **`session_status` と `status_bucket` は両方そのまま出す。** どちらで何を読むかは呼び手が決める
// （1.6）。条件をこちらへ持つと、どちらの呼び手にも合わない定義が1つできる。
//
// 判定に **`updated_at` は使わない**（1.6）——走行中でも動かないことを 2026-09-05 に実測している。
//
// ## 一覧は最後まで繰る
//
// `list_sessions` の `tags` での絞り込みは、この呼び出し元からは使えない（指定すると異常終了する。
// 使えるのはOAuthの呼び出し元だけ）ので、取ってから手元で絞る。**1ページで済ませない**——固まった
// 走行中のセッションは占有したままなので、直近100件の外に居ることがある。

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runBash } from './spawn.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
/** 試験は差し替える（パスで呼ぶため PATH では差し替わらない）。 */
const CCR_META = process.env.CCR_META ?? resolve(HERE, '../../.claude/ccr-meta.sh');

/**
 * `list_sessions` を1ページ引いて、応答のJSONを返す。引けなければ `undefined`。**引き方を持つのは
 * ここ1箇所**——1ページで足りる呼び手（[`board.mjs`](board.mjs)）も、ここを通る。
 *
 * 応答は `<other-session>` の包みに入って返る（他のセッションの記録なので）ため、**中の JSON だけを
 * 取り出す**——そのまま `JSON.parse` すると包みの `<` で落ちる（`.claude/ccr-meta.sh` の冒頭）。
 */
export function listSessions(request) {
  const call = runBash(CCR_META, ['list_sessions'], { input: JSON.stringify(request), capture: true });
  if (call.status !== 0) return undefined;
  for (const line of call.stdout.split(/\r?\n/)) {
    const at = line.indexOf('{"ccr"');
    if (at >= 0) return JSON.parse(line.slice(at));
  }
  return undefined;
}

/** 一覧を引けなかったことを、呼び手が「止まる側へ倒す」ために投げる。 */
export class LiveSessionsError extends Error {
  constructor() {
    super('セッションの一覧を引けなかった');
  }
}

/** 畳まれていないセッションを、新しい順に全部返す。 */
export function liveSessions({ page: fetch = listSessions } = {}) {
  const live = [];
  let after = '';
  for (;;) {
    const page = fetch({ mine: true, limit: 100, ...(after === '' ? {} : { after_id: after }) });
    if (page === undefined) throw new LiveSessionsError();

    for (const session of page.ccr?.data ?? []) {
      if (session.session_status === 'SESSION_STATUS_ARCHIVED') continue;
      live.push({
        id: session.id,
        status: session.session_status ?? '-',
        bucket: session.status_bucket ?? '-',
        tags: [...(session.tags ?? [])],
      });
    }

    if (page.ccr?.has_more !== true) break;
    after = page.ccr?.last_id ?? '';
    if (after === '') break;
  }
  return live;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const lines = liveSessions().map(
      (session) => `${session.id}\t${session.status}\t${session.bucket}\t${session.tags.join(',')}`,
    );
    if (lines.length > 0) process.stdout.write(`${lines.join('\n')}\n`);
  } catch (error) {
    console.error(error instanceof LiveSessionsError ? error.message : error);
    process.exit(1);
  }
}
