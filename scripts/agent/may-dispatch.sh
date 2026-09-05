#!/usr/bin/env bash
# **セッションを1本立ててよいかを、ここ1つで答える。**
#
#   bash scripts/agent/may-dispatch.sh new-task task-1234
#   bash scripts/agent/may-dispatch.sh review   review-1500 task-1415
#
# 終了コードが0なら立ててよい。**立ててはいけないときは理由を標準エラーへ出して非0**で終わる。
#
# **タグは複数渡せる**（[`occupancy.sh`](occupancy.sh)）。1つの仕事に、占有を持ちうるセッションが
# 2種類あることがある——レビューなら「前のレビュー」と「そのPRを直しているセッション」。
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

KIND="${1:?種類を渡す（new-task / review / review-untasked / resume / other）}"
shift
[ "$#" -gt 0 ] || {
  echo "タグを1つ以上渡す（例: task-1234 / review-1500）" >&2
  exit 1
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! brake=$(bash "$HERE/brake.sh" "$KIND"); then
  echo "投入の手綱で止まっている: $brake" >&2
  exit 1
fi

# **種類ごとに、占有へ訊く問いが違う**（[`occupancy.sh`](occupancy.sh)・`board-design.md` 1.2）。
# 新しいタスクは**もう配ったか**を訊く——手が空いたセッションが持っていても、その issue は配られて
# いる。残りは**今その差分へ手が動いているか**で、書き終えたセッションは通す（通さないと、再レビューも
# 直しの再開も二度と出ない）。
case "$KIND" in
new-task) question=--live ;;
*) question=--busy ;;
esac

if ! held=$(CCR_META="${CCR_META:-$HERE/../../.claude/ccr-meta.sh}" bash "$HERE/occupancy.sh" "$question" "$@"); then
  echo "立てない: $held" >&2
  exit 1
fi
