#!/usr/bin/env bash
# 残り余力で、その種類を流してよいかを答える。**答えるのは「立ててよいか」。**
#
#   bash scripts/daemon/headroom.sh new-task
#   bash scripts/daemon/headroom.sh review
#
# 出力は次のどれか。**終了コードが0なのは `GO` のときだけ**（[`brake.sh`](brake.sh) と同じ向き。
# 読めなかったときに止まる側へ倒すのを、呼び手ではなくここが引き受ける）。
#
#   GO           … 終了コード 0
#   HOLD <理由>  … 終了コード 4
#   UNKNOWN <理由> … 終了コード 1
#
# **人が止めた `STOP`（3）と別の終了コードを持つ。** 同じ顔にすると、**盤面を見回る係が「人が
# 止めている」と読む**（[`board-design.md`](../../agent-ops/board-design.md) 2.21.2）——手綱は人が
# 外すまで戻らないが、こちらは枠が明ければひとりでに戻るので、**打つ手がまるきり違う。**
#
# ## 口は叩かない。控えを読む
#
# 使用量の口は2分に1回ほどしか通らない（[`usage.sh`](usage.sh)）。ここが自分で叩くと、**答えが
# 出ない周ができるうえ、割り当ての側（[`usage-record.sh`](usage-record.sh)）の番を奪う。**
# 読むのは `usage.sh --last` の控えで、**古ければあちらが1で断る**——古い値で通すと、上限に当たって
# から気づくことになる。
#
# 比べ方は隣の [`headroom.mjs`](headroom.mjs)。ここは在り処と入口だけ。

set -euo pipefail

KIND="${1:?種類を渡す（new-task / review / review-untasked / resume / other）}"

# `%/*` は区切りが無いと文字列をそのまま返す。
HERE="${BASH_SOURCE[0]%/*}"
if [[ "$HERE" == "${BASH_SOURCE[0]}" ]]; then HERE='.'; fi

STATE_DIR="${BOARD_STATE:-$HOME/.claude/board-state}"

if ! usage=$(bash "$HERE/usage.sh" --last); then
  echo "UNKNOWN 使用量の控えを読めなかった"
  exit 1
fi

printf '%s\n' "$usage" | node "$HERE/headroom.mjs" "$KIND" "$STATE_DIR/spent.tsv"
