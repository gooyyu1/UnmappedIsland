#!/usr/bin/env bash
# **その種類の仕事へモデルを使わせてよいかを、ここ1つで答える。**
#
#   bash scripts/daemon/may-spend.sh new-task
#   bash scripts/daemon/may-spend.sh resume
#
# 終了コードが0なら流してよい。**流してはいけないときは理由を標準エラーへ出して非0**で終わる。
# **3は「人が手綱で止めている」**（[`brake.sh`](brake.sh)）、**4は「余力が足りない」**
# （[`headroom.sh`](headroom.sh)）、1はそれ以外。
#
# ## 使うのが「立てる」か「起こす」かで、条件を分けない
#
# モデルの使用量を食うのは**セッションを立てる周と、止まったセッションを起こす周**の両方
# （[`board-design.md`](../../agent-ops/board-design.md) 2.5.2節）。**条件を呼び手ごとに書くと、
# 増やしたとき片方にだけ入る**——余力の手綱が立てる側（[`may-dispatch.sh`](may-dispatch.sh)）にだけ
# 入り、起こす側（[`resume-session.sh`](resume-session.sh)）が人の手綱だけを写していたのが
# その形（[issue #2220](https://github.com/gooyyu1/UnmappedIsland/issues/2220)）。**条件は呼び手が
# 数えるものではない**ので、ここが持つ（`CLAUDE.md`「自分のことは自分でする」）。
#
# **占有はここに無い。** あれは「この仕事に既にセッションが立っているか」で、**起こす経路には
# 問いそのものが無い**（同じ相手へ二度送っても2本にはならない。`resume-session.sh`）。経路で
# 変わるものだけがあちらに残る。
#
# **訊く順は、答えの重さの順。** どれで止まったかはログに1行しか残らないので、**先に訊いたほうが
# 名乗る**——人が止めているなら、余力の話は要らない。

set -euo pipefail

KIND="${1:?種類を渡す（綴りは `brake.sh` が持つ）}"

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
