// **畳まれていないセッション**を引く。「畳まれていない」の定義はここ1箇所だけが持つ。
//
//   import { liveSessions } from './live-sessions.mjs';
//   liveSessions()   // → [{ id, status, bucket, env, tags: [] }]
//
// コマンドとして呼ぶと1行1件のTSVを出す（入口は [`live-sessions.sh`](live-sessions.sh)）。
// 1行が `<セッションID>\t<session_status>\t<status_bucket>\t<タグをカンマで繋いだもの>\t<環境>`。1本も
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
// ## 繰るのは、生きたセッションが尽きるまで
//
// `list_sessions` の `tags` での絞り込みは、この呼び出し元からは使えない（指定すると異常終了する。
// 使えるのはOAuthの呼び出し元だけ）ので、取ってから手元で絞る。**1ページで済ませない**——固まった
// 走行中のセッションは占有したままなので、直近100件の外に居ることがある。
//
// **ただし履歴の末尾までは繰らない。** `list_sessions` には**1000回/時**の上限があり、末尾まで繰ると
// 1回の走査に要る回数が**これまでに作ったセッションの総数に比例して増え続ける**。上限に当たると
// 一覧が引けず、盤面はその周を捨てる——**進みが止まったまま、日が経つほど戻りにくくなる**
// （`board-design.md` 1.7）。生きたセッションが1件も無いページが `DRY_PAGES` 枚続いたら、そこで
// 止める。
//
// **`DRY_PAGES` は「間に何件の畳まれたセッションが挟まっても見つけるか」**（1枚 = 100件）。
// 深いところに居る生きたセッションを取りこぼすと、盤面はそのタグを空きと読んで**二重に立てる**ので、
// 減らす向きには倒さない。

import { readFileSync, writeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runBash } from './spawn.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
/** 試験は差し替える（パスで呼ぶため PATH では差し替わらない）。 */
const CCR_META = process.env.CCR_META ?? resolve(HERE, '../../.claude/ccr-meta.sh');

/** 生きたセッションが1件も無いページが、これだけ続いたら繰るのをやめる。 */
const DRY_PAGES = Number(process.env.LIVE_SESSIONS_DRY_PAGES || 2);

/**
 * どこで走っているか（`board-design.md` 2.16）。**既定のIDを持つのは
 * [`ccr-env.sh`](ccr-env.sh) 1箇所**なので、直接叩いて読む——書き写すと、あちらを直したときに
 * ここが黙って古いIDを見続ける。
 *
 * **知らない環境は `-`。** `cloud` に寄せない——盤面はこの値で「間違った場所に居るワーカー」を
 * 畳むので、知らないものを既定へ落とすと、正しく走っているセッションを畳みうる。
 *
 * **引けなかったら止める。** 空の対応表を返すと全セッションが `-` へ落ち、**配り直しの仕組みが
 * どこにも跡を残さずに死ぬ**——`-` は「食い違いを見ない」側なので、赤くも遅くもならない。
 */
function environments() {
  // パスで呼ぶため PATH では差し替わらない。試験は `CCR_ENV` で差し替える。
  const path = process.env.CCR_ENV ?? resolve(HERE, 'ccr-env.sh');
  const call = runBash(path, [], { capture: true });
  if (call.status !== 0) throw new Error(`ccr-env.sh を起こせなかった: ${path}`);
  const found = {};
  for (const line of call.stdout.split(/\r?\n/)) {
    const at = line.indexOf('=');
    if (at > 0) found[line.slice(at + 1)] = line.slice(0, at) === 'BRIDGE_ENV' ? 'bridge' : 'cloud';
  }
  return found;
}

/**
 * `list_sessions` を1ページ引いて、応答のJSONを返す。引けなければ `undefined`。**引き方を持つのは
 * ここ1箇所**——1ページで足りる呼び手（[`board.mjs`](board.mjs)）も、ここを通る。
 *
 * 応答は `<other-session>` の包みに入って返る（他のセッションの記録なので）ため、**中の JSON だけを
 * 取り出す**——そのまま `JSON.parse` すると包みの `<` で落ちる（`.claude/ccr-meta.sh` の冒頭）。
 */
export function listSessions(request) {
  const call = runBash(CCR_META, ['list_sessions'], { input: JSON.stringify(request), capture: true });
  const found = call.stdout.split(/\r?\n/).find((line) => line.includes('{"ccr"'));
  if (call.status === 0 && found !== undefined) return JSON.parse(found.slice(found.indexOf('{"ccr"')));
  // **道具が言った理由を捨てない。** 上限（`1000 calls per account per hour`）も認証切れも、
  // ここが黙ると呼び手には「引けなかった」しか残らず、**ログだけでは直しようが無い**。
  const reason = call.stdout.split(/\r?\n/).find((line) => line.trim() !== '');
  if (reason !== undefined) writeSync(2, `list_sessions: ${reason.trim()}\n`);
  return undefined;
}

/** 一覧を引けなかったことを、呼び手が「止まる側へ倒す」ために投げる。 */
export class LiveSessionsError extends Error {
  constructor() {
    super('セッションの一覧を引けなかった');
  }
}

/** 1件をTSVの1行へ。**列の並びを持つのはここ**（読む側は `occupancy.sh`・`usage-record.sh`）。 */
export const formatLive = (session) =>
  `${session.id}\t${session.status}\t${session.bucket}\t${session.tags.join(',')}\t${session.env}`;

/** TSVを読み戻す。`formatLive` の逆。 */
export function parseLive(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [id = '', status = '-', bucket = '-', tags = '', env = '-'] = line.split('\t');
      return { id, status, bucket, env, tags: tags.split(',').filter((tag) => tag !== '') };
    });
}

/**
 * この周のぶんを既に引いてあるなら、そのファイルを読む（[`board-round.mjs`](board-round.mjs)）。
 *
 * **1周に何度も引かないため。** 一覧を要るのは1周に4箇所まであり（盤面・使用量の割り当て・占有の
 * 判定・起こす相手の確認）、それぞれが別のプロセスから引くと**同じ答えを4回買う**ことになる。
 * 上限は1時間あたりで数えるので、ここがそのまま盤面の回る速さの上限になる。
 *
 * **読めなかったら止まる側へ倒す**——投入する側に渡す答えなので、黙って引き直すと「同じ周の答え」で
 * なくなる。
 */
function snapshot(path) {
  try {
    return parseLive(readFileSync(path, 'utf8'));
  } catch {
    throw new LiveSessionsError();
  }
}

/** 畳まれていないセッションを、新しい順に返す。 */
export function liveSessions({
  page: fetch = listSessions,
  envs = environments,
  taken = process.env.LIVE_SESSIONS_TSV ?? '',
} = {}) {
  if (taken !== '') return snapshot(taken);

  const known = envs();
  const live = [];
  let after = '';
  let dry = 0;
  while (dry < DRY_PAGES) {
    const page = fetch({ mine: true, limit: 100, ...(after === '' ? {} : { after_id: after }) });
    if (page === undefined) throw new LiveSessionsError();

    const before = live.length;
    for (const session of page.ccr?.data ?? []) {
      if (session.session_status === 'SESSION_STATUS_ARCHIVED') continue;
      live.push({
        id: session.id,
        status: session.session_status ?? '-',
        bucket: session.status_bucket ?? '-',
        env: known[session.environment_id] ?? '-',
        tags: [...(session.tags ?? [])],
      });
    }
    dry = live.length === before ? dry + 1 : 0;

    if (page.ccr?.has_more !== true) break;
    after = page.ccr?.last_id ?? '';
    if (after === '') break;
  }
  return live;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const lines = liveSessions().map(formatLive);
    if (lines.length > 0) process.stdout.write(`${lines.join('\n')}\n`);
  } catch (error) {
    console.error(error instanceof LiveSessionsError ? error.message : error);
    process.exit(1);
  }
}
