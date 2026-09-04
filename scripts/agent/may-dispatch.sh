#!/usr/bin/env bash
# **セッションを1本立ててよいかを、ここ1つで答える。**
#
#   bash scripts/agent/may-dispatch.sh new-task task-1234
#   bash scripts/agent/may-dispatch.sh review   review-1500
#
# 終了コードが0なら立ててよい。**立ててはいけないときは理由を標準エラーへ出して非0**で終わる。
#
# ## 呼び手に条件を数えさせない
#
# 「立ててよいか」は1つの問いで、答えるのに要る条件が複数あるだけ。**条件を呼び手に並べさせると、
# 増やしたとき片方の呼び手にだけ入る**（`CLAUDE.md`「自分のことは自分でする」）。
# 今の条件は2つ。
#
# - **手綱**（[`brake.sh`](brake.sh)。人間が issue のチェックで止める）
# - **占有**（[`occupancy.sh`](occupancy.sh)。同じ仕事に既にセッションが立っている）
#
# **使用量による自動の停止**（[`board-design.md`](../../.claude/board-design.md) 2.5）もここへ足す。
# 1本あたりの消費の計測が溜まってからなので、まだ入っていない。
#
# ## 呼ぶ場所は「立てる直前」
#
# 占有の判定と `create_session` の間が空くほど、その隙に他が立てられる。**引数を組み立てる前ではなく、
# 立てる直前に呼ぶ。** これは排他ではないので隙は消えないが、PR #1493 で起きた「同じ分に2本」は
# この幅に収まらない（1.5）。

set -euo pipefail

KIND="${1:?種類を渡す（new-task / review / resume / other）}"
TAG="${2:?タグを渡す（例: task-1234 / review-1500）}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! brake=$(bash "$HERE/brake.sh" "$KIND"); then
  echo "投入の手綱で止まっている: $brake" >&2
  exit 1
fi

if ! held=$(CCR_META="${CCR_META:-$HERE/../../.claude/ccr-meta.sh}" bash "$HERE/occupancy.sh" "$TAG"); then
  echo "$TAG は既に占有されている: $held" >&2
  exit 1
fi
