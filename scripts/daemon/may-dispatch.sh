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
# - **モデルを使わせてよいか**（[`may-spend.sh`](may-spend.sh)。人の手綱と使用量の余力。
#   [`board-design.md`](../../agent-ops/board-design.md) 2.5.2）
# - **占有**（[`occupancy.sh`](occupancy.sh)。同じ仕事に既にセッションが立っている）
#
# **前者は起こす経路（[`resume-session.sh`](resume-session.sh)）と同じものを通る**——モデルを食うのは
# どちらも同じで、そこで分ける理由が無い。**ここに残るのは占有だけ**で、あれは「立てる」にしか無い問い。
#
# **関門の終了コードは、そのまま自分の終了コードになる**（`set -e`）。理由の行は止めた側が標準エラーへ
# 出しているので、ここで読み替えない。
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

bash "$HERE/may-spend.sh" "$KIND"

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
