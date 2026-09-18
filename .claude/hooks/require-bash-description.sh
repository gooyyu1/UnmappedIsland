#!/bin/bash
# PreToolUse hook: description の無い Bash 呼び出しを拒否する。
#
# 実行ログの見出しは description。省略するとUIはコマンド文字列の先頭行にフォールバックし、
# 後から見て何をしていたのか読めなくなる。コンパクション後に省略しがちなので機械で止める。
#
# **Bash 呼び出しのたびに走る。** JSONを読む手は bash に無いので `jq` は残るが、そこから先
# ——空白を落とす・定数のJSONを出す——は組み込みで足りるので、外部プロセスは `jq` 1つだけ。
set -euo pipefail

description=$(jq -r '.tool_input.description // ""')

if [ -n "${description//[[:space:]]/}" ]; then
  exit 0
fi

mapfile -t deny <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "description が空。実行ログに残る見出しなので、コマンドの言い換えではなく「何のために何をするか」を日本語で書いて再実行すること。"
  }
}
JSON
printf '%s\n' "${deny[@]}"
