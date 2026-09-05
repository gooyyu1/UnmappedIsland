// メタMCP（`mcp__ccr_meta__*`）の `tools/call` を1発投げる。
//
// **入口は隣の [`ccr-meta.sh`](./ccr-meta.sh)。** 呼び方・なぜこれが要るのか・落とし穴と確かめ方は
// すべてそちらの冒頭にある。ここに書くのは、中身の側でしか読めない制約だけ。

import { readFileSync } from 'node:fs';

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

const tool = process.argv[2];
const args = await readStdinAsUtf8();

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
    params: { name: tool, arguments: JSON.parse(args.trim() || '{}') },
  }),
});

const raw = await response.text();

// 道具の側の失敗は 200 に `error` を載せて返る。HTTPが落ちているのは認証などその手前の失敗で、
// **本文はJSONとも限らない**ので、状態と本文をそのまま出す。
if (!response.ok) {
  console.error(`失敗: HTTP ${response.status} ${raw}`);
  process.exit(1);
}

const parsed = JSON.parse(raw);

if (parsed.error) {
  console.error('失敗:', JSON.stringify(parsed.error));
  process.exit(1);
}

// 中身は普段のMCPと同じ text コンテンツ。そのまま出す。
for (const part of parsed.result?.content ?? []) {
  console.log(part.text ?? JSON.stringify(part));
}
