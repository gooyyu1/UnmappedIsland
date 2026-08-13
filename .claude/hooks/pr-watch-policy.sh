#!/bin/bash
# PreToolUse hook: PRのウォッチ関連ツールの可否を、許可プロンプトを出さずに決める。
#
# マージはユーザーが自分で行うため、このリポジトリではPRをウォッチしない（CLAUDE.md参照）。
# 予約・購読は塞ぎ、解除だけは自動で許可する。PR作成時の購読はハーネスがサーバ側で自動的に
# 行うので、こちらから止められるのは解除の呼び出しだけ。
#
# permissions.allow ではプロンプトが出続けたため、フックの permissionDecision で決めている。
set -euo pipefail

tool=$(jq -r '.tool_name // empty')

case "$tool" in
mcp__*) ;;
*) exit 0 ;;
esac

# MCPサーバ名の表記ゆれ（Claude_Code_Remote / claude-code-remote / github）を無視して末尾で判定する。
case "${tool##*__}" in
send_later | create_trigger | update_trigger | delete_trigger | fire_trigger | subscribe_pr_activity)
  decision=deny
  reason="このリポジトリではPRをウォッチしない（CLAUDE.md「作業ブランチ・PRの運用」）。"
  ;;
unsubscribe_pr_activity)
  decision=allow
  reason="自動で入った購読の解除。確認は不要。"
  ;;
*) exit 0 ;;
esac

jq -cn --arg d "$decision" --arg r "$reason" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: $d, permissionDecisionReason: $r}}'
