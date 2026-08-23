#!/bin/bash
# SessionStart hook: 記録済みの価値観を、セッションの文脈へ無条件に流し込む。
#
# 「必要なら読め」では機能しない。参照すべき場面だと気づけないことこそが記録を残す動機なので、
# 気づきに依存しない形で入れる。進め方の価値観（.claude/policies.md）は全文、ゲーム内容の判断基準
# （docs/concept/DesignPrinciples.md）は見出し（＝結論）だけを入れ、詳細は必要なときに読ませる。
#
# 冪等・非対話。web/CLIどちらのセッションでも動く（依存の導入を行う session-start.sh とは別に
# 登録してある。あちらはwebでしか動かない）。
set -euo pipefail

REPO_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
POLICIES="$REPO_DIR/.claude/policies.md"
PRINCIPLES="$REPO_DIR/docs/concept/DesignPrinciples.md"

context=""

if [ -f "$POLICIES" ]; then
  context+="過去のセッションで記録した、ユーザーの価値観。A・Bどちらもあり得る場面ではこれに従い、訊き直さない。"
  context+=$'\n\n'
  context+="$(cat "$POLICIES")"
  context+=$'\n\n'
fi

if [ -f "$PRINCIPLES" ]; then
  # 見出しが結論そのものなので、一覧だけで「その基準が在ること」に気づける。
  headings=$(grep -E '^## ' "$PRINCIPLES" | sed 's/^## /- /' || true)
  if [ -n "$headings" ]; then
    context+="ゲーム内容の判断基準（docs/concept/DesignPrinciples.md の結論一覧。"
    context+="ゲーム内容に関わる判断をするときは本文も読む）:"
    context+=$'\n'
    context+="$headings"
    context+=$'\n'
  fi
fi

[ -n "$context" ] || exit 0

jq -n --arg c "$context" \
  '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $c}}'
