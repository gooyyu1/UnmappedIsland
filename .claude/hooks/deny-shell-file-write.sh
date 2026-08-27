#!/bin/bash
# PreToolUse hook: シェルからファイルを書き換える Bash 呼び出しを拒否する。
#
# 実行ログにはコマンドしか残らないので、シェルで書き換えると**何をどう変えたのかが差分として
# 見えなくなる**。整形のフック（format-after-edit.sh）も Write/Edit にしか掛からない。
#
# 判定の本体は scripts/agent/check-shell-command.sh。**Copilot CLI 側の拡張と同じものを呼ぶ**ので、
# 片方だけ直して線がずれることがない。
set -uo pipefail

input=$(cat)
command=$(jq -r '.tool_input.command // ""' <<<"$input")
checker="${CLAUDE_PROJECT_DIR:-.}/scripts/agent/check-shell-command.sh"

[ -n "$command" ] || exit 0
[ -f "$checker" ] || exit 0

if reason=$(printf '%s' "$command" | bash "$checker"); then
  exit 0
fi

jq -n --arg reason "$reason" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $reason
  }
}'
