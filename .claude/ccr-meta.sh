#!/usr/bin/env bash
# メタMCP（`mcp__ccr_meta__*`）のツールを、トークンを読み直しながら呼ぶ。
#
#   bash .claude/ccr-meta.sh list_sessions '{"limit": 5}'
#   bash .claude/ccr-meta.sh archive_session '{"session_id": "cse_..."}'
#   bash .claude/ccr-meta.sh create_session "$(cat args.json)"
#
# 引数は tools/call の arguments そのもの。**普段の `mcp__ccr_meta__*` と同じ道具・同じ引数**なので、
# 覚え直すことは無い。使えるのは23個全部（`tools/list` で引ける）。
#
# ## なぜこれが要るのか
#
# `mcp__ccr_meta__*` は**起動時のヘッダを掴んだまま**なので、走っている最中にトークンが切れると、
# 登録を直しても**そのセッションからは二度と使えない**（2026-08-25 に2回起きた）。**ここは呼ぶたびに
# `~/.claude/.credentials.json` から読み直す**ので切れない。
#
# MCPサーバもただのHTTPで、しかも**ステートレスに応じる**（`initialize` で session id を持たされない）
# ので、`tools/call` を1発投げるだけでよい。
#
# **RESTを逆算しない。** `/v1/code/sessions` を直に叩く道もあるが、形が違ううえ、**`DELETE` は畳まずに
# 消す**。同じ意味の操作を2通り持つ理由が無いので、道具はMCP側に揃える。
#
# ## リポジトリの渡し方を間違えると、空の箱で走り出す
#
# `create_session` に渡すのは **`source_url` / `source_revision`（平の引数）**。RESTの
# `config.sources` の形で書くと**黙って無視され**、リポジトリの無い `/home/user` で起動する
# （2026-08-25 に1回やった）。**立てた直後に `get_session` で `session_context.sources` を見て、
# 入っていることを確かめる。**

set -euo pipefail

TOOL="${1:?ツール名を渡す（例: list_sessions）}"
ARGS="${2:-{\}}"

TOKEN=$(node -e "
  const fs = require('node:fs');
  const path = (process.env.USERPROFILE || process.env.HOME) + '/.claude/.credentials.json';
  process.stdout.write(JSON.parse(fs.readFileSync(path, 'utf8')).claudeAiOauth.accessToken);
")

BODY=$(TOOL="$TOOL" ARGS="$ARGS" node -e "
  process.stdout.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: process.env.TOOL, arguments: JSON.parse(process.env.ARGS) },
  }));
")

curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  --data "$BODY" \
  "https://api.anthropic.com/v1/code/mcp/meta" |
  node -e "
    let s = '';
    process.stdin.on('data', (d) => (s += d)).on('end', () => {
      const parsed = JSON.parse(s);
      if (parsed.error) {
        console.error('失敗:', JSON.stringify(parsed.error));
        process.exit(1);
      }
      // 中身は普段のMCPと同じ text コンテンツ。そのまま出す。
      for (const part of parsed.result?.content ?? []) {
        console.log(part.text ?? JSON.stringify(part));
      }
    });
  "
