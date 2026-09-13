#!/usr/bin/env bash
# 盤面を1回で出す。
#
#   bash scripts/agent/board.sh
#
# **中身は [`board.mjs`](../daemon/board.mjs)。ここは入口だけ。** 何を並べるのか・なぜ1回で出すのかは、
# すべてそちらの冒頭にある。
#
# **入口とその中身が別のフォルダに在るのは、呼び手が2つあるから。** ここを打つのは人だが、同じ
# `board.mjs` はデーモンも常設の issue を書くために読む（[`board-publish.mjs`](../daemon/board-publish.mjs)）
# ——**止まると困るのはそちら**なので、中身は `scripts/daemon/` に置いてある。

set -euo pipefail

# `%/*` は区切りが無いと文字列をそのまま返す。**この入口は手で打たれる**ので、`scripts/agent/` の
# 中から `bash board.sh` と呼ばれる形も通す。
HERE="${BASH_SOURCE[0]%/*}"
if [[ "$HERE" == "${BASH_SOURCE[0]}" ]]; then HERE='.'; fi

exec node "$HERE/../daemon/board.mjs"
