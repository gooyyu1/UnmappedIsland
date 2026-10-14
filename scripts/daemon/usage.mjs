// 使用量の口を1回叩いて、枠ごとに1行で出す。
//
// **入口は隣の [`usage.sh`](usage.sh)。** 呼び方・出る行の形・叩ける間隔・控えはそちらの冒頭、
// **どの枠を出すか**は [`usage-windows.mjs`](usage-windows.mjs)。ここに書くのは、中身の側でしか
// 読めない制約だけ。

import { readFileSync } from 'node:fs';
import { WINDOWS } from './usage-windows.mjs';

const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';

function readAccessToken() {
  const home = process.env.USERPROFILE ?? process.env.HOME;
  const credentials = JSON.parse(readFileSync(`${home}/.claude/.credentials.json`, 'utf8'));
  return credentials.claudeAiOauth.accessToken;
}

const response = await fetch(ENDPOINT, {
  headers: { authorization: `Bearer ${readAccessToken()}`, accept: 'application/json' },
});

const raw = await response.text();

// **呼び手が見るのは終了コードだけ**なので、落ちた理由は標準エラーへ残す（後からログを見る人間の
// ため）。間隔を空けそこねた `429` も、資格情報が切れた `401` も、名乗れるのはここだけ。
//
// **`429` が口の閉じている秒数（`retry-after`）を添えていれば、それを標準出力へ出して3で終わる。**
// 間隔の番を持つのは `usage.sh` なので、ここは読んで渡すだけ。
//
// 終了コードは `process.exit` で切らずに返す——理由は `dispatch-session.mjs` の末尾と同じで、切ると
// Windows では3が別のコードに化ける。
function report() {
  if (!response.ok) {
    const retryAfter = response.headers.get('retry-after') ?? '';
    console.error(`失敗: HTTP ${response.status}${retryAfter ? ` retry-after ${retryAfter}` : ''} ${raw}`);
    if (response.status === 429 && /^\d+$/.test(retryAfter)) {
      console.log(retryAfter);
      return 3;
    }
    return 1;
  }

  const usage = JSON.parse(raw);

  const lines = [];
  for (const key of WINDOWS) {
    const quota = usage[key];
    if (!quota || typeof quota.utilization !== 'number') {
      console.error(`失敗: ${key} が無い ${raw}`);
      return 1;
    }
    lines.push([key, quota.utilization, quota.resets_at ?? '-', quota.locked_reason ?? '-'].join(' '));
  }

  console.log(lines.join('\n'));
  return 0;
}

process.exitCode = report();
