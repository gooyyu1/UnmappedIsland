#!/usr/bin/env bash
# メタMCP（`mcp__ccr_meta__*`）のツールを、トークンを読み直しながら呼ぶ。
#
#   bash .claude/ccr-meta.sh list_sessions <<<'{"limit": 5}'
#   bash .claude/ccr-meta.sh archive_session <<<'{"session_id": "cse_..."}'
#   bash .claude/ccr-meta.sh create_session < args.json
#
# **引数は標準入力で渡す**（argvではない）。中身は tools/call の arguments そのもので、**普段の
# `mcp__ccr_meta__*` と同じ道具・同じ引数**なので覚え直すことは無い。使えるのは23個全部
# （`tools/list` で引ける）。
#
# **日本語を含む引数は、必ずファイルへ書いてから流す。** シェルの `$(...)` や環境変数を経由すると
# Windowsのnodeが化けさせる（下記）。
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
# ## 立てたら、届いた本文を読んで確かめる
#
# **化けても壊れても、セッションは普通に動き出す。** 2026-08-25 に、環境変数を経由したせいで指示が
# 丸ごと化けたまま20分走った——URLとバッククォートの中（ASCII）だけが読めるので、**それらしく
# ファイルを読み始め、こちらは「無事だ」と誤読した。** 見た目の動きは判断材料にならない。
#
# ```bash
# printf '%s' '{"session_id":"<id>","limit":100}' > "$LOCALAPPDATA/Temp/ev.json"
# bash .claude/ccr-meta.sh list_events < "$LOCALAPPDATA/Temp/ev.json"
# ```
#
# 最も古い `user` のイベントが送った本文。**元のファイルと突き合わせて一致を見る**（目視で「読める」
# ではなく、文字列の比較で）。
#
# ## リポジトリの渡し方を間違えると、空の箱で走り出す
#
# `create_session` に渡すのは **`source_url` / `source_revision`（平の引数）**。RESTの
# `config.sources` の形で書くと**黙って無視され**、リポジトリの無い `/home/user` で起動する
# （2026-08-25 に1回やった）。**立てた直後に `get_session` で `session_context.sources` を見て、
# 入っていることを確かめる。**

set -euo pipefail

TOOL="${1:?ツール名を渡す（例: list_sessions）}"

TOKEN=$(node -e "
  const fs = require('node:fs');
  const path = (process.env.USERPROFILE || process.env.HOME) + '/.claude/.credentials.json';
  process.stdout.write(JSON.parse(fs.readFileSync(path, 'utf8')).claudeAiOauth.accessToken);
")

# **引数は標準入力から受けて、そのまま curl へ流す。** シェル変数にも環境変数にも載せない——
# Windowsのnodeは環境変数をANSIコードページで受け取るので、**日本語を env や `$(...)` で渡すと
# 静かに化ける**（2026-08-25 に、セッションのタイトルが化けて実際に見つかった）。
node -e "
  let stdin = '';
  process.stdin.on('data', (d) => (stdin += d)).on('end', () => {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: process.argv[1], arguments: JSON.parse(stdin || '{}') },
      }),
    );
  });
" "$TOOL" |
  curl -sS -X POST \
    -H "Authorization: Bearer $TOKEN" \
    -H "content-type: application/json; charset=utf-8" \
    -H "accept: application/json, text/event-stream" \
    --data-binary @- \
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
