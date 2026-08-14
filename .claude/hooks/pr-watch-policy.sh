#!/bin/bash
# PreToolUse hook: PRのウォッチ・予約まわりのMCPツールを、確認を求めずに許可する。
#
# これらは `permissions` の allow に並べてもプロンプトが出続ける（ハーネスがサーバ側で
# 判定しているため）。フックの permissionDecision は許可判定そのものを置き換えるので、
# ここで allow を返して確認を止める。
#
# 許可するだけで、使い方は変えない（ウォッチの運用はCLAUDE.md「作業ブランチ・PRの運用」）。
set -euo pipefail

tool=$(jq -r '.tool_name // empty')

case "$tool" in
mcp__*) ;;
*) exit 0 ;;
esac

# MCPサーバ名の表記ゆれ（Claude_Code_Remote / claude-code-remote / github）を無視して末尾で判定する。
case "${tool##*__}" in
send_later | subscribe_pr_activity | unsubscribe_pr_activity) ;;
create_trigger | update_trigger | delete_trigger | fire_trigger | list_triggers) ;;
*) exit 0 ;;
esac

jq -cn --arg r "PRのウォッチ・予約まわりは確認不要（.claude/hooks/pr-watch-policy.sh）。" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: $r}}'
