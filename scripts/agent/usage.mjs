// 使用量の口を1回叩いて、枠ごとに1行で出す。
//
// **入口は隣の [`usage.sh`](usage.sh)。** 呼び方・出る行の形・叩ける間隔・なぜこの2つの枠だけかは、
// すべてそちらの冒頭にある。ここに書くのは、中身の側でしか読めない制約だけ。

import { readFileSync } from 'node:fs';

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
if (!response.ok) {
  console.error(`失敗: HTTP ${response.status} ${raw}`);
  process.exit(1);
}

const usage = JSON.parse(raw);

const lines = [];
for (const key of ['five_hour', 'seven_day']) {
  const quota = usage[key];
  if (!quota || typeof quota.utilization !== 'number') {
    console.error(`失敗: ${key} が無い ${raw}`);
    process.exit(1);
  }
  lines.push([key, quota.utilization, quota.resets_at ?? '-', quota.locked_reason ?? '-'].join(' '));
}

console.log(lines.join('\n'));
