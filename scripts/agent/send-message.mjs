// 走っているセッションへ本文を1つ送る（`send_message`）。
//
//   node scripts/agent/send-message.mjs <セッションID> <本文のファイル>
//
// **本文はファイルから読む。** 危ないのは文字の符号ではなく**シェルの展開**なので、構文ごとに載せて
// よいかを判断せず、載せないほうを決めておく（[`ccr-meta.sh`](../../.claude/ccr-meta.sh)「指示は
// Write で書く」）。
//
// **組み立てと通信は同じプロセスに置く**——分けると node が2つ起きる
// （[`ccr-meta.mjs`](../../.claude/ccr-meta.mjs)「node から呼ぶ側は」）。
//
// 出すものは無い。**届いたかは終了コードだけ**で、応答は呼び手のどこからも読まれない。

import { readFileSync } from 'node:fs';

import { callMeta } from '../../.claude/ccr-meta.mjs';

const [session, bodyPath] = process.argv.slice(2);
try {
  await callMeta('send_message', { session_id: session, message: readFileSync(bodyPath, 'utf8') });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
