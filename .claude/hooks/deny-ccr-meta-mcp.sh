#!/bin/bash
# PreToolUse hook: メタMCPの道具（`mcp__ccr_meta__*`）を常に拒否し、正しい入口を理由に書いて返す。
#
# **登録はあえて消していない。** 消すと道具の一覧から `mcp__ccr_meta__*` が消え、今度は「そもそも
# 手が無い」と読んで諦める（`policies.md`「正しい入口とは別に、使えない経路が見えているとき」）。
# 見えたまま残せば、**呼んだ瞬間が案内の機会**になる。
#
# **ここが出るのは、道具が一覧に在るときだけ。** 登録のトークンが起動時に無効だと道具ごと消え、
# フックも呼ばれない（2026-09-05 に実測）。だから登録のトークンを追従させる必要がある——理由と
# 仕組みは [`ccr-meta.sh`](../ccr-meta.sh) の冒頭。入口を1つに揃える理由そのものも同じ場所。
set -euo pipefail

cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "メタMCPの入口は `.claude/ccr-meta.sh` ひとつ。**同じ道具・同じ引数がそのまま通る**ので覚え直すことは無い（使えるのは `tools/list` で引ける全部）。引数はargvではなく標準入力のJSONで渡す:\n\n  bash .claude/ccr-meta.sh list_sessions <<<'{\"limit\": 5}'\n  bash .claude/ccr-meta.sh create_session < args.json\n\n**日本語を含む引数は、必ずファイルへ書いてから流すこと**（環境変数や `$(...)` を経由するとWindowsのnodeが黙って化けさせる）。落とし穴と確かめ方は `.claude/ccr-meta.sh` の冒頭に全部書いてある。"
  }
}
JSON
