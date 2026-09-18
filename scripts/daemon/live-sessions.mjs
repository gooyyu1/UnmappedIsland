// **畳まれていないセッション**を引く。「畳まれていない」の定義はここ1箇所だけが持つ。
//
//   import { liveSessions } from './live-sessions.mjs';
//   await liveSessions()   // → [{ id, status, bucket, env, served, tags: [] }]
//
// コマンドとして呼ぶと1行1件のTSVを出す（入口は [`live-sessions.sh`](live-sessions.sh)）。
// 1行が
// `<セッションID>\t<session_status>\t<status_bucket>\t<タグをカンマで繋いだもの>\t<環境>\t<働いたか>`。
// 1本も無ければ**何も出さずに終了コード0**。**引けなかったときは終了コード1**で、呼び手は止まる側へ
// 倒せる。
//
// ## なぜ切り出したか
//
// 一覧を要る側は1つではない（呼び手は `live-sessions` で検索すれば出る。
// [`board-design.md`](../../agent-ops/board-design.md) 2.5.3）。**同じ条件を複数箇所へ書くと、
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
// ## 立てられたことと、働いたことは別
//
// **投入が通っても、その先に走る者が付くとは限らない。** 走る者の配られない区間では、セッション
// だけが作られて中身が空のまま残り、**呼び手には「手が空いている」としか映らない**（1.6 のどの値も
// これには答えない）——盤面はそれを停滞と読み、担当の issue を片端から人へ返した（issue #2206）。
//
// **区別は呼び手ではなくここが持つ**（`CLAUDE.md`「自分のことは自分でする」）。読む側が
// `external_metadata` の中身を知っていると、**見るべき区別を知らない呼び手だけが黙って取り違える。**
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

import { MetaError, callMeta, metaJson } from '../../.claude/ccr-meta.mjs';
import { runBash } from './spawn.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** 生きたセッションが1件も無いページが、これだけ続いたら繰るのをやめる。 */
const DRY_PAGES = Number(process.env.LIVE_SESSIONS_DRY_PAGES || 2);

/**
 * 今の環境ID（`board-design.md` 2.16）。**既定のIDを持つのは [`ccr-env.sh`](ccr-env.sh) 1箇所**
 * なので、直接叩いて読む——書き写すと、あちらを直したときにここが黙って古いIDを見続ける。
 *
 * 返すのは `{ name, id }` の並びで、**名前は `ccr-env.sh` が出す綴りのまま**（`CLOUD_ENV` /
 * `BRIDGE_ENV`）。**決まらなかった側は出てこない**（あちらの「決まらなかった側は出さない」）ので、
 * 並びに居ないことと、居るが死んでいることは別（[`check-values.mjs`](check-values.mjs)）。
 *
 * **引けなかったら止める。** 空で返すと、呼び手には「環境が1つも無い」と見分けが付かない。
 */
export function environmentIds() {
  // パスで呼ぶため PATH では差し替わらない。試験は `CCR_ENV` で差し替える。
  const path = process.env.CCR_ENV ?? resolve(HERE, 'ccr-env.sh');
  const call = runBash(path, [], { capture: true });
  if (call.status !== 0) throw new Error(`ccr-env.sh を起こせなかった: ${path}`);
  const found = [];
  for (const line of call.stdout.split(/\r?\n/)) {
    const at = line.indexOf('=');
    if (at > 0) found.push({ name: line.slice(0, at), id: line.slice(at + 1) });
  }
  return found;
}

/**
 * `ccr-env.sh` が出す名前から、一覧に載る綴りへ（`LiveSession` の `env`）。**訳を持つのはここ
 * 1箇所**——環境ごとにセッションを数える側（[`check-values.mjs`](check-values.mjs)）も同じ訳で
 * 引くので、書き写すと片方だけが直る。
 */
export const envKind = (name) => (name === 'BRIDGE_ENV' ? 'bridge' : 'cloud');

/**
 * どこで走っているか（`board-design.md` 2.16）。
 *
 * **知らない環境は `-`。** `cloud` に寄せない——盤面はこの値で「間違った場所に居るワーカー」を
 * 畳むので、知らないものを既定へ落とすと、正しく走っているセッションを畳みうる。
 *
 * **引けなければ `environmentIds` が投げるのに任せる**（受けて空を返さない）。空の対応表は全セッション
 * を `-` へ落とし、**配り直しの仕組みがどこにも跡を残さずに死ぬ**——`-` は「食い違いを見ない」側
 * なので、赤くも遅くもならない。
 */
function environments() {
  const found = {};
  for (const { name, id } of environmentIds()) found[id] = envKind(name);
  return found;
}

/**
 * `list_sessions` を1ページ引いて、応答のJSONを返す。引けなければ `undefined`。**引き方を持つのは
 * ここ1箇所**で、繰るのは下の `liveSessions` だけ——1ページで足りる呼び手は1つも無い。
 *
 * **[`ccr-meta.mjs`](../../.claude/ccr-meta.mjs) を直に呼ぶ。** シェルの入口を通すと、1ページごとに
 * `bash ccr-meta.sh` と `node ccr-meta.mjs` が起きる（あちらの「node から呼ぶ側は、シェルの入口を
 * 通らない」）。**包みをほどくのも `metaJson` に任せる**——`<other-session>` の綴りを呼び手ごとに
 * 覚え直さない。
 */
async function listSessions(request) {
  let text;
  try {
    text = await callMeta('list_sessions', request);
  } catch (error) {
    // **道具が言った理由を捨てない。** 上限（`1000 calls per account per hour`）も認証切れも、
    // ここが黙ると呼び手には「引けなかった」しか残らず、**ログだけでは直しようが無い**。
    writeSync(2, `list_sessions: ${error instanceof MetaError ? error.message : String(error)}\n`);
    return undefined;
  }
  const page = metaJson(text);
  if (page === undefined) writeSync(2, `list_sessions: 応答からJSONを読めなかった: ${text}\n`);
  return page;
}

/** 一覧を引けなかったことを、呼び手が「止まる側へ倒す」ために投げる。 */
export class LiveSessionsError extends Error {
  constructor() {
    super('セッションの一覧を引けなかった');
  }
}

/**
 * 走る者が一度でも付いたか（上の「立てられたことと、働いたことは別」）。
 *
 * **見るのは `external_metadata.last_served_model`**——手番を1つでも供したセッションだけがこれを
 * 持つ（2026-09-17 に実測。立てただけで一度も走っていない1本の `external_metadata` は
 * `container_cc_version` と `cross_session_inbound` だけで、この鍵が無かった）。
 *
 * **`status_bucket` では言えない。** 走る者が付かなかった周は `..._FAILED` で並ぶが、同じ値は
 * 働いたあとに手番が転んだセッションにも付く（1.5 の `01Wcy9XLj85X`）——**始まらなかったことと、
 * 始まってから転んだことが同じ顔になる。**
 *
 * **引けなければ「付いた」側へ倒す。** 呼び手はこの値で畳む手を打つので、知らないことを
 * 「付かなかった」と読むと、**働いているセッションを畳む。**
 */
const servedOnce = (session) =>
  typeof session.external_metadata?.last_served_model === 'string' &&
  session.external_metadata.last_served_model !== '';

/**
 * 1件をTSVの1行へ。**列の並びを持つのはここ**（読む側は `occupancy.sh`・`usage-record.sh`）。
 *
 * **足すのは末尾。** 読む側は前から数えた位置で引くので（`usage-record.sh` の `jq`、
 * `occupancy.sh` の `read`）、間へ入れると**タグの列がずれて、どの占有にも一致しなくなる。**
 *
 * **働いたかを知らない1件は `served` と書く。** 読み戻す側の既定（下の `parseLive`）と同じ向きへ
 * 倒しておかないと、**書いて読むだけで「働かなかった」へ化ける。**
 */
export const formatLive = (session) =>
  [
    session.id,
    session.status,
    session.bucket,
    session.tags.join(','),
    session.env,
    session.served === false ? 'unserved' : 'served',
  ].join('\t');

/**
 * TSVを読み戻す。`formatLive` の逆。
 *
 * **列が無ければ「働いた」側**（上の `servedOnce` と同じ理由）。古い写しを読んだ周に、働いている
 * セッションが畳まれない側へ倒す。
 */
export function parseLive(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [id = '', status = '-', bucket = '-', tags = '', env = '-', served = 'served'] = line.split('\t');
      return {
        id,
        status,
        bucket,
        env,
        served: served !== 'unserved',
        tags: tags.split(',').filter((tag) => tag !== ''),
      };
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
export async function liveSessions({
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
    const page = await fetch({ mine: true, limit: 100, ...(after === '' ? {} : { after_id: after }) });
    if (page === undefined) throw new LiveSessionsError();

    const before = live.length;
    for (const session of page.ccr?.data ?? []) {
      if (session.session_status === 'SESSION_STATUS_ARCHIVED') continue;
      live.push({
        id: session.id,
        status: session.session_status ?? '-',
        bucket: session.status_bucket ?? '-',
        env: known[session.environment_id] ?? '-',
        served: servedOnce(session),
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
    const lines = (await liveSessions()).map(formatLive);
    if (lines.length > 0) process.stdout.write(`${lines.join('\n')}\n`);
  } catch (error) {
    console.error(error instanceof LiveSessionsError ? error.message : error);
    process.exit(1);
  }
}
