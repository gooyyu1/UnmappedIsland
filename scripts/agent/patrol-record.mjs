// 盤面を見回る係が、その回の記録を1件書く（`agent-ops/board-design.md` 2.21.4節）。
//
//   node scripts/agent/patrol-record.mjs <置き場> < record.json
//
// **置き場は引数で受ける。** 係はブリッジで立ち、デーモンの環境変数を受け取らないので、自分の
// `BOARD_STATE` を読むと書いた先と盤面が読む先がずれる。置き場は投入のときに本文へ書き込まれる
// （[`prompt-body.mjs`](../daemon/prompt-body.mjs) の `SESSION_PLACES`）。
//
// 読めない記録は書かずに理由を出して 1 で抜ける。中身は
// [`board-state.mjs`](../daemon/board-state.mjs) の `appendPatrol`。

import { readFileSync } from 'node:fs';
import { appendPatrol } from '../daemon/board-state.mjs';

const [stateDir] = process.argv.slice(2);
if (stateDir === undefined) {
  console.error('置き場を渡す（係の本文に書いてある）');
  process.exit(2);
}
try {
  appendPatrol(stateDir, JSON.parse(readFileSync(0, 'utf8')));
} catch (error) {
  console.error(`記録を書けなかった: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
