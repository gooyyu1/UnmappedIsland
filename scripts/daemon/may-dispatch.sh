#!/usr/bin/env bash
# **セッションを1本立ててよいかを、ここ1つで答える。**
#
#   bash scripts/daemon/may-dispatch.sh new-task task-1234
#   bash scripts/daemon/may-dispatch.sh review   review-1500 task-1415
#
# 終了コードが0なら立ててよい。**立ててはいけないときは理由を標準エラーへ出して非0**で終わる。
# **3は「人が手綱で止めている」**（[`brake.sh`](brake.sh)）、**4は「余力が足りない」**
# （[`headroom.sh`](headroom.sh)）、1はそれ以外。
#
# **タグは複数渡せる**（[`occupancy.sh`](occupancy.sh)）。1つの仕事に、占有を持ちうるセッションが
# 2種類あることがある——レビューなら「前のレビュー」と「そのPRを直しているセッション」。
#
# ## 呼び手に条件を数えさせない
#
# 「立ててよいか」は1つの問いで、答えるのに要る条件が複数あるだけ。**条件を呼び手に並べさせると、
# 増やしたとき片方の呼び手にだけ入る**（`CLAUDE.md`「自分のことは自分でする」）。条件は次。
#
# - **手綱**（[`brake.sh`](brake.sh)。人間が issue のチェックで止める）
# - **余力**（[`headroom.sh`](headroom.sh)。使用量の上限が近い。
#   [`board-design.md`](../../agent-ops/board-design.md) 2.5.1）
# - **占有**（[`occupancy.sh`](occupancy.sh)。同じ仕事に既にセッションが立っている）
#
# **手綱（人間）と余力（自動）は AND で、互いに書き換えない**（2.5.2）——2つの書き手が同じビットを
# 取り合うと、人が入れたチェックを機械が外す形になる。
#
# **訊く順は、答えの重さの順。** どれで止まったかはログに1行しか残らないので、**先に訊いたほうが
# 名乗る**——人が止めているなら、余力の話は要らない。
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

# `%/*` は区切りが無いと文字列をそのまま返す。
HERE="${BASH_SOURCE[0]%/*}"
if [[ "$HERE" == "${BASH_SOURCE[0]}" ]]; then HERE='.'; fi
HERE="$(cd "$HERE" && pwd)"

# **手綱の答えは、終了コードごと呼び手へ渡す**（[`brake.sh`](brake.sh)）。人が止めている（3）のか
# 読めなかった（1）のかは、**盤面が進まない周を詰まりと読む側**が要る区別で、ここで1つに潰すと
# 復元できない。
gate=0
brake=$(bash "$HERE/brake.sh" "$KIND") || gate=$?
if [ "$gate" -ne 0 ]; then
  echo "投入の手綱で止まっている: $brake" >&2
  exit "$gate"
fi

# **余力の答えも、終了コードごと渡す**（[`headroom.sh`](headroom.sh)）。4（余力が足りない）は
# **枠が明ければひとりでに戻る**ので、人が止めている3とも、読めなかった1とも打つ手が違う。
gate=0
headroom=$(bash "$HERE/headroom.sh" "$KIND") || gate=$?
if [ "$gate" -ne 0 ]; then
  echo "使用量の余力で止まっている: $headroom" >&2
  exit "$gate"
fi

# **種類ごとに、占有へ訊く問いが違う**（[`occupancy.sh`](occupancy.sh)・`board-design.md` 1.2）。
# 新しいタスクは**もう配ったか**を訊く——手が空いたセッションが持っていても、その issue は配られて
# いる。残りは**今その差分へ手が動いているか**で、書き終えたセッションは通す（通さないと、再レビューも
# 直しの再開も二度と出ない）。
case "$KIND" in
new-task) question=--live ;;
*) question=--busy ;;
esac

if ! held=$(bash "$HERE/occupancy.sh" "$question" "$@"); then
  echo "立てない: $held" >&2
  exit 1
fi
