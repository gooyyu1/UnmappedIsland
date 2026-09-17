#!/usr/bin/env bash
# 残り余力で、その種類を流してよいかを答える。**答えるのは「立ててよいか」。**
#
#   bash scripts/daemon/headroom.sh new-task
#   bash scripts/daemon/headroom.sh review
#
# 出力は次のどれか。**終了コードが0なのは `GO` のときだけ**（[`brake.sh`](brake.sh) と同じ向き。
# 読めなかったときに止まる側へ倒すのを、呼び手ではなくここが引き受ける）。
#
#   GO             … 終了コード 0
#   HOLD <理由>    … 終了コード 4
#   UNKNOWN <理由> … 終了コード 1
#
# **人が止めた `STOP`（3）と別の終了コードを持つ。** 同じ顔にすると、**盤面を見回る係が「人が
# 止めている」と読む**（[`board-design.md`](../../agent-ops/board-design.md) 2.21.2）——手綱は人が
# 外すまで戻らないが、こちらは枠が明ければひとりでに戻るので、**打つ手がまるきり違う。**
#
# ## まず控えを読み、無ければ自分で1回引く
#
# 使用量の口は2分に1回ほどしか通らない（[`usage.sh`](usage.sh)）ので、**普段は控え（`--last`）を
# 読む**。毎周叩くと、答えが出ない周ができるうえ、割り当ての側（[`usage-record.sh`](usage-record.sh)）
# の番を奪う。**古い控えはあちらが1で断る**——古い値で通すと、上限に当たってから気づくことになる。
#
# **控えが無い・古いのを、そのまま「立てるな」にしない。** 控えを書くのは口を叩いた周だけなので、
# **デーモンが回っていない場所で手から投入するとき**（[`dispatch-task.sh`](dispatch-task.sh) を人が
# 直に叩く経路。[`parallel-work.md`](../../agent-ops/parallel-work.md)）は必ずこの形になる。塞ぐと
# **「そもそも手が無い」と読んで諦める経路が新しくできる**ので、そこでは自分で1回引く
# （[`policies.md`](../../agent-ops/policies.md)「仕組みの作り方」）——デーモンが回っている間は、
# 割り当ての側が周の先頭で叩いて控えを新しくしているので、ここは通らない。
#
# **引き直せなかったときだけ `UNKNOWN`。** そこも、口が落ちているのか順番待ちなのかで名乗りを分ける
# （下）——見るのはログを読む人で、同じ顔にすると打ち直して確かめるしかなくなる。
#
# 比べ方は隣の [`headroom.mjs`](headroom.mjs)。ここは在り処と入口だけ。

set -euo pipefail

KIND="${1:?種類を渡す（new-task / review / review-untasked / resume / other）}"

# `%/*` は区切りが無いと文字列をそのまま返す。
HERE="${BASH_SOURCE[0]%/*}"
if [[ "$HERE" == "${BASH_SOURCE[0]}" ]]; then HERE='.'; fi

STATE_DIR="${BOARD_STATE:-$HOME/.claude/board-state}"

if ! usage=$(bash "$HERE/usage.sh" --last); then
  # **引き直せなかった理由は、名乗り分ける**（[`usage.sh`](usage.sh)。2は「今は読む番ではない」で、
  # 1は「引けなかった」）。デーモンが回っている場所でここへ来る主な形は2のほうで、**同じ顔にすると、
  # 口が落ちているのか順番待ちなのかがログから読めない**——打ち直しても2は何も出さずに返る。
  fresh=0
  usage=$(bash "$HERE/usage.sh") || fresh=$?
  case "$fresh" in
  0) ;;
  2)
    echo "UNKNOWN 控えが古く、口を叩ける間隔もまだ空いていない"
    exit 1
    ;;
  *)
    echo "UNKNOWN 使用量を引けなかった（\`bash scripts/daemon/usage.sh\` が通るか見る）"
    exit 1
    ;;
  esac
fi

printf '%s\n' "$usage" | node "$HERE/headroom.mjs" "$KIND" "$STATE_DIR/spent.tsv"
