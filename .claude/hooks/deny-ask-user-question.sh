#!/bin/bash
# PreToolUse hook: 選択肢を提示して回答させるツール（AskUserQuestion）を常に拒否する。
#
# このツールは同じ質問を繰り返して会話が進まなくなることがあるため使わない。意見が必要なときは
# 普通のチャットの文章で訊く。
set -euo pipefail

cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "選択肢UIは使わない。訊きたいことは普通のチャットの文章で質問すること。"
  }
}
JSON
