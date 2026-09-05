#!/usr/bin/env bash
# 使用量を1回引いて、生きているセッションへ割り当てる。**1周に1回、デーモンから呼ぶ。**
#
#   bash scripts/agent/usage-record.sh
#   BOARD_STATE=/tmp/board bash scripts/agent/usage-record.sh   # 置き場を変える
#
# 畳まれたセッションが在った周だけ、その消費を1行1件で出す。**引けなければ何もせず終了コード1。**
#
# 割り当ての中身は [`usage-attribute.mjs`](usage-attribute.mjs)、一覧は
# [`live-sessions.sh`](live-sessions.sh)。ここは2つを繋ぐだけ。
#
# **`status_bucket` から `working` を立てるのはここ。** 一覧は畳まれていないセッションを全部出し
# （占有の側がそれを要る）、消費を積むのは動いていたものだけ、という違いを呼び手が引き受ける。
#
# ## 置き場をリポジトリの外にする
#
# 蓄積はデーモンの手元のファイルへ置く（[`board-design.md`](../../.claude/board-design.md) 2.5）。
# リポジトリへ入れると毎周がコミットになる。**これは過去の記録なのでデーモンが死んでも嘘にならず、
# 消えない場所に置いてよい**（1.1）。
#
# ## 間隔は粗くてよいが、空けすぎると落ちる
#
# セッションが1周のあいだに立って終わると、生きている一覧に一度も現れないので**その消費は記録
# されない**。平均を取る側では欠測になるだけで、値が歪む向きではない。

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${BOARD_STATE:-$HOME/.claude/board-state}"

usage=$(bash "$HERE/usage.sh" | grep '^five_hour ' | tr -d '\r') || {
  echo "使用量を引けなかった" >&2
  exit 1
}
read -r _ utilization _ <<<"$usage"

live=$(CCR_META="${CCR_META:-$HERE/../../.claude/ccr-meta.sh}" bash "$HERE/live-sessions.sh") || {
  echo "セッションの一覧を引けなかった" >&2
  exit 1
}

# TSVをそのままJSONへ。**日本語は載らない**（IDとタグだけ）ので、ここは変数で通してよい。
printf '%s' "$live" | jq -R -s --arg u "$utilization" \
  --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{
    utilization: ($u | tonumber),
    now: $now,
    live: (split("\n") | map(select(length > 0)) | map(split("\t") | {
      id: .[0],
      working: (.[1] == "SESSION_STATUS_BUCKET_WORKING"),
      tags: (.[2] // "" | split(",") | map(select(length > 0)))
    }))
  }' |
  node "$HERE/usage-attribute.mjs" "$STATE_DIR/usage.json" "$STATE_DIR/spent.tsv"
