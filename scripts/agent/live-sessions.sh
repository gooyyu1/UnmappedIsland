#!/usr/bin/env bash
# **畳まれていないセッション**を1行1件で出す。
#
#   $ bash scripts/agent/live-sessions.sh
#   cse_abc123<TAB>SESSION_STATUS_RUNNING<TAB>SESSION_STATUS_BUCKET_WORKING<TAB>task-1234
#
# **中身は隣の [`live-sessions.mjs`](live-sessions.mjs)。ここは入口だけ。** 出す形・何を落とすか・
# ページの繰り方は、すべてそちらの冒頭にある。**盤面はこの入口を通らず、あちらを関数として呼ぶ**
# （[`board-read.mjs`](board-read.mjs)）——1周ごとにプロセスを起こす費用がそのまま常時の固定費に
# なるため。ここが残っているのは、シェルの呼び手（[`occupancy.sh`](occupancy.sh)・
# [`resume-session.sh`](resume-session.sh)・[`usage-record.sh`](usage-record.sh)）のため。

set -euo pipefail

# `%/*` は区切りが無いと文字列をそのまま返す。
HERE="${BASH_SOURCE[0]%/*}"
if [[ "$HERE" == "${BASH_SOURCE[0]}" ]]; then HERE='.'; fi

exec node "$HERE/live-sessions.mjs"
