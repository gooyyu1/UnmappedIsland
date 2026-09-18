// メタMCP（`mcp__ccr_meta__*`）の `tools/call` を1発投げる。
//
//   import { callMeta, metaJson } from './ccr-meta.mjs';
//   metaJson(await callMeta('get_session', { session_id }))?.ccr
//
// **シェルからの入口は隣の [`ccr-meta.sh`](./ccr-meta.sh)。** 呼び方・なぜこれが要るのか・落とし穴と
// 確かめ方はすべてそちらの冒頭にある。ここに書くのは、中身の側でしか読めない制約だけ。
//
// ## node から呼ぶ側は、シェルの入口を通らない
//
// 通ると **node が2つ起きる**——引数を組み立てる側と、それを受けて通信する側。Windowsでは `node` の
// 起動だけで1回44.5msかかる（2026-09-05 の実測）ので、境界の数がそのまま常時の固定費になる。
// **組み立てと通信を同じプロセスに置けば1つで済む**ので、node から呼ぶ側は `callMeta` を直に呼ぶ。
//
// **引数をJSONの文字列にして渡す経路も要らない。** ファイルへ書いて渡していたのは、シェルの展開に
// 通さないため（`ccr-meta.sh`「指示は Write で書く」）で、シェルを跨がないならそもそも掛からない。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 環境変数は、試験が身代わりのサーバへ向けるための差し替え口（`tests/scripts/ccrMeta.test.ts`）。 */
const ENDPOINT = process.env.CCR_META_ENDPOINT ?? 'https://api.anthropic.com/v1/code/mcp/meta';

function readAccessToken() {
  const home = process.env.USERPROFILE ?? process.env.HOME;
  const credentials = JSON.parse(readFileSync(`${home}/.claude/.credentials.json`, 'utf8'));
  return credentials.claudeAiOauth.accessToken;
}

/**
 * 標準入力をUTF-8として読む。**受けたチャンクを文字列へ足しながら繋がない**——多バイト文字が
 * チャンクの境目（既定で64KiB）で割れると、そこだけ U+FFFD になって黙って化ける。指示の本文は
 * 数十KiBになるので、境目は現に踏む。
 */
async function readStdinAsUtf8() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * 道具まで届かなかったこと。**呼び手が止まる側へ倒せるように、理由を持って投げる**——道具の側の
 * 失敗（200 に載る `error`）も、その手前のHTTPの失敗も、名乗れるのはここだけ。
 */
export class MetaError extends Error {}

/**
 * 道具（`tool`）を1回呼んで、返ってきた text コンテンツをそのまま返す。届かなければ `MetaError`。
 *
 * **トークンは呼ぶたびに読み直す**（`ccr-meta.sh` の冒頭）——掴んだままにすると、走っている最中に
 * 切れたときそのプロセスから二度と使えない。
 */
export async function callMeta(tool, args = {}) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${readAccessToken()}`,
      'content-type': 'application/json; charset=utf-8',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: tool, arguments: args },
    }),
  });

  const raw = await response.text();

  // 道具の側の失敗は 200 に `error` を載せて返る。HTTPが落ちているのは認証などその手前の失敗で、
  // **本文はJSONとも限らない**ので、状態と本文をそのまま出す。
  if (!response.ok) throw new MetaError(`失敗: HTTP ${response.status} ${raw}`);

  const parsed = JSON.parse(raw);
  if (parsed.error) throw new MetaError(`失敗: ${JSON.stringify(parsed.error)}`);

  return (parsed.result?.content ?? []).map((part) => part.text ?? JSON.stringify(part)).join('\n');
}

/**
 * 応答のテキストからJSONを1つ取り出す。読める行が無ければ `undefined`。
 *
 * **包みの綴りを呼び手に覚えさせない。** 他のセッションの記録は `<other-session>` の行に包まれて
 * 返り、`create_trigger` はJSONの後ろへ人向けの1行を足す——どちらも「JSONの行が1つ混じったテキスト」
 * なので、行ごとに `{` から読んでみて、最初に読めたものを返す。**そのまま `JSON.parse` すると包みの
 * `<` で落ちる**（`ccr-meta.sh` の冒頭）ことを、呼び手ごとに思い出さなくてよくする。
 */
export function metaJson(text) {
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf('{');
    if (at < 0) continue;
    try {
      return JSON.parse(line.slice(at));
    } catch {
      // JSONではない行。次を見る。
    }
  }
  return undefined;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = await readStdinAsUtf8();
  try {
    // 中身は普段のMCPと同じ text コンテンツ。そのまま出す。
    const text = await callMeta(process.argv[2], JSON.parse(args.trim() || '{}'));
    if (text !== '') console.log(text);
  } catch (error) {
    console.error(error instanceof MetaError ? error.message : error);
    process.exit(1);
  }
}
