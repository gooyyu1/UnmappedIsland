#!/usr/bin/env bash
# PRを出したCCRセッションのIDを引く。**そのPRを畳む相手であり、差し戻す相手でもある。**
#
#   bash scripts/agent/session-of-pr.sh 1036
#
# 見つかったIDを1行ずつ出す。1つも引けなければ何も出さずに終了コード1。
#
# ## タイトルではなく本文の脚注で引く
#
# PR本文の末尾に `https://claude.ai/code/session_...` が入る（Claude Codeが付ける）。**これが、その
# PRを実際に出したセッション。** タイトルの `(#1029)` で引くと、同じ issue へ2回投入したときに
# 古いほうを引く。
#
# **脚注が無いPRがある。** 本文を書き直した拍子に落ちる。そのときは `Closes #<番号>` と
# `task-<番号>` のタグで引き直す——**タグは `dispatch-task.sh` が必ず付ける**ので、書き手が消せる
# 本文とは別の手掛かりになる。

set -euo pipefail

PR="${1:?PRの番号を渡す（例: 1036）}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 試験は差し替える（`gh` は PATH で差し替わるが、これはパスで呼ぶため）。
CCR_META="${CCR_META:-$HERE/../../.claude/ccr-meta.sh}"

body=$(gh pr view "$PR" --json body --jq '.body // ""' | tr -d '\r')

# IDの桁まで見る。本文が脚注の**書き方を説明している**ことがあり（`https://claude.ai/code/session_...`
# のような引用）、`session_` までで拾うと存在しないIDを引きに行く。
# 見つからないときは `grep` が 1 を返す。`pipefail` があるので、ここで止めずに空として受ける。
sessions=$(grep -oE 'session_[A-Za-z0-9]{16,}' <<<"$body" | sort -u || true)

if [ -z "$sessions" ]; then
  # `Closes #123` だけを拾う。番号だけの参照（`#123`）では issue が閉じないので、ここでも見ない。
  closes=$(grep -oiE 'closes[[:space:]]+#[0-9]+' <<<"$body" | grep -oE '[0-9]+' | sort -u || true)
  if [ -n "$closes" ]; then
    tags=$(sed 's/^/task-/' <<<"$closes" | paste -sd'|' -)
    sessions=$(bash "$CCR_META" list_sessions <<<'{"mine":true,"limit":100}' | grep -o '{"ccr".*' |
      jq -r --arg re "^($tags)\$" '.ccr.data[] | select([.tags[]? | select(test($re))] | length > 0) | .id' |
      sort -u || true)
  fi
fi

[ -n "$sessions" ] || exit 1
printf '%s\n' "$sessions"
