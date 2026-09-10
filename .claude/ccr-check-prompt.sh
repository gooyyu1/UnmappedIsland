#!/usr/bin/env bash
# `create_session` で送った指示が、欠けずに届いたかを確かめる。
#
#   bash .claude/ccr-check-prompt.sh session_012... "$LOCALAPPDATA/Temp/instruction.md"
#
#   一致                 … 送ったファイルと届いた本文が同じ（終了コード 0）
#   不一致               … 長さと、届いた先頭300字が出る（終了コード 1）
#   （読めなかった）     … 送ったファイルが読めない・応答が読み取れない（終了コード 2）
#
# **欠けても壊れても、セッションは普通に動き出す。** 立てた直後にこれを通すこと
# （[`ccr-meta.sh`](./ccr-meta.sh)「立てたら、届いた本文を読んで確かめる」）。それらしくファイルを
# 読み始めた、は判断材料にならない。
#
# **中身は隣の [`ccr-check-prompt.mjs`](./ccr-check-prompt.mjs)。ここは入口だけ。** 何を見るか・
# なぜ待つかはそちらの冒頭にある。**投入する側はこの入口を通らず、あちらを関数として呼ぶ**
# （[`dispatch-session.mjs`](../scripts/agent/dispatch-session.mjs)）——1回の投入で起きる node の数が
# そのまま常時の固定費になるため。ここが残っているのは、手で叩く側のため。

set -euo pipefail

SESSION="${1:?セッションIDを渡す（例: session_012...）}"
SENT="${2:?送った指示のファイルのパスを渡す}"

# `%/*` は区切りが無いと文字列をそのまま返す。**この入口は手で打たれる**ので、`.claude/` の中から
# `bash ccr-check-prompt.sh …` と呼ばれる形も通す。
HERE="${BASH_SOURCE[0]%/*}"
if [[ "$HERE" == "${BASH_SOURCE[0]}" ]]; then HERE='.'; fi

exec node "$HERE/ccr-check-prompt.mjs" "$SESSION" "$SENT"
