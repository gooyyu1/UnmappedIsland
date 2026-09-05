#!/usr/bin/env bash
# 司令塔の盤面を1回で出す。
#
#   bash scripts/agent/board.sh
#
# **中身は隣の [`board.mjs`](board.mjs)。ここは入口だけ。** 何を並べるのか・なぜ1回で出すのかは、
# すべてそちらの冒頭にある。

set -euo pipefail

# `%/*` は区切りが無いと文字列をそのまま返す。**この入口は手で打たれる**ので、`scripts/agent/` の
# 中から `bash board.sh` と呼ばれる形も通す。
HERE="${BASH_SOURCE[0]%/*}"
if [[ "$HERE" == "${BASH_SOURCE[0]}" ]]; then HERE='.'; fi

exec node "$HERE/board.mjs"
