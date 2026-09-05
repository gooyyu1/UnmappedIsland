#!/bin/bash
# SessionStart hook: 記録済みの価値観を、セッションの文脈へ無条件に流し込む。
#
# 「必要なら読め」では機能しない。参照すべき場面だと気づけないことこそが記録を残す動機なので、
# 気づきに依存しない形で入れる。進め方の価値観（.claude/policies.md）は全文、ゲーム内容の判断基準
# （docs/concept/DesignPrinciples.md）は見出し（＝結論）だけを入れ、詳細は必要なときに読ませる。
#
# **入れるのは抽出済みの一般則だけで、判断の履歴（.claude/decisions/）は入れない。** 履歴は
# 溜まる一方なので、入れると全セッションがその分を毎回払う。棚卸しの契機だけが要るので、
# 未処理がしきい値を超えたときに件数を1行足す。
#
# 冪等・非対話。web/CLIどちらのセッションでも動く（依存の導入を行う session-start.sh とは別に
# 登録してある。あちらはwebでしか動かない）。
set -euo pipefail

REPO_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
POLICIES="$REPO_DIR/.claude/policies.md"
PRINCIPLES="$REPO_DIR/docs/concept/DesignPrinciples.md"
DECISIONS="$REPO_DIR/.claude/decisions"

# 未処理の履歴がこの数に達したら棚卸しを促す。毎回件数を告げると、注入されるのは一般則だけ、
# という分け方が崩れる。
DECISIONS_THRESHOLD=10

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

if [ -d "$DECISIONS" ]; then
  # 直下の .md だけを数える。archive/ に在るのは棚卸し済み。
  pending=$(find "$DECISIONS" -maxdepth 1 -name '*.md' -type f | wc -l)
  if [ "$pending" -ge "$DECISIONS_THRESHOLD" ]; then
    context+=$'\n'
    context+="棚卸ししていない判断の履歴が $pending 件ある。ユーザーと会話できるセッションなら、"
    context+="policy-review skill で一般則へ畳むことを提案する。"
    context+=$'\n'
  fi
fi

[ -n "$context" ] || exit 0

# **本文を `--arg` で渡さない。** 記録は伸びる一方で、argvの単一引数の上限を越えると jq が落ちる。
# **落ちてもセッションは普通に起動する**ので、価値観が1文字も入らないまま走り出したことに誰も
# 気づけない。builtin の printf は exec しないため、標準入力へ流すこの形なら長さに縛られない。
printf '%s' "$context" |
  jq -Rs '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: .}}'
