#!/usr/bin/env bash
# 使用量を引いて行で出す。**読むだけ。**
#
#   $ bash scripts/agent/usage.sh
#   five_hour 9 2026-09-04T20:10:00.441803+00:00 -
#   seven_day 14 2026-09-10T15:59:59.441827+00:00 -
#
# 1行が `<枠> <utilization> <resets_at> <locked_reason>`。`locked_reason` が無いときは `-`。
# **引けなかったときは何も出さずに1で終わる**ので、呼び手は終了コードだけで止まる側へ倒せる
# （[`occupancy.sh`](occupancy.sh) と同じ向き）。
#
# ## `limits[].severity` は出さない
#
# 基盤の出す段階は「どれだけ使ったか」を粗く言うだけで、**こちらが知りたい「あと1本投入して
# よいか」には答えない**（[`board-design.md`](../../.claude/board-design.md) 2.5.1）。要るのは残量
# そのものではなく**残量と1本あたりの消費の比較**なので、比較は呼び手が自分の計測でする。
#
# 応答には他にも枠が並ぶ（`seven_day_opus` など）が、**手綱が見るのはこの2つだけ。** 増やすなら
# 2.5.2 の側を先に決める。
#
# ## トークンは呼ぶたびに読み直す
#
# 理由は [`ccr-meta.sh`](../../.claude/ccr-meta.sh) の冒頭と同じ——掴んだままにすると、走っている
# 最中に切れたときそのセッションから二度と使えない。**モデルは要らない**ので、この口は使用量が
# 満杯でも通る。

set -euo pipefail

TOKEN=$(node -e "
  const fs = require('node:fs');
  const path = (process.env.USERPROFILE || process.env.HOME) + '/.claude/.credentials.json';
  process.stdout.write(JSON.parse(fs.readFileSync(path, 'utf8')).claudeAiOauth.accessToken);
")

curl -sS -H "Authorization: Bearer $TOKEN" -H 'accept: application/json' \
  'https://api.anthropic.com/api/oauth/usage' |
  node -e "
    let s = '';
    process.stdin.on('data', (d) => (s += d)).on('end', () => {
      let json;
      try {
        json = JSON.parse(s);
      } catch {
        process.exit(1);
      }
      const lines = [];
      for (const key of ['five_hour', 'seven_day']) {
        const w = json[key];
        if (!w || typeof w.utilization !== 'number') process.exit(1);
        lines.push([key, w.utilization, w.resets_at ?? '-', w.locked_reason ?? '-'].join(' '));
      }
      process.stdout.write(lines.join('\n') + '\n');
    });
  "
