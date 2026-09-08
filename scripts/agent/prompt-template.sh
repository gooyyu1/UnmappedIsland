#!/usr/bin/env bash
# ひな形（`.claude/*-prompt.md`）から、セッションへ渡す本体と題を取り出す。**シェルから `source`
# して使う。**
#
#   # shellcheck source=scripts/agent/prompt-template.sh
#   source "$(dirname "${BASH_SOURCE[0]}")/prompt-template.sh"
#   template_body "$PROMPT" "$WORK/prompt.md"
#   template_title "$PROMPT" "$WORK/title.txt"
#
# **ひな形は手で書き写さない**——書き写すと必ず何かが落ちる（2026-08-27 に「PRを見張らない」の一文が
# 投入のひな形から抜け、セッションが承認待ちで止まった）。**取り出す側も写さない**のは同じ理由で、
# 片方だけ直すと、そのひな形を読む経路だけが黙って別の中身を渡す。
#
# 出す先をファイルにするのは、**日本語をシェル変数に載せないため**（[`.claude/ccr-meta.sh`](../../.claude/ccr-meta.sh)
# 「指示は Write で書く」）。

# ひな形（`$1`）の囲みの中身を `$2` へ取り出す。
#
# **囲みの綴りはひな形が決める。** バッククォートだけの行が最初に現れたところが始まりで、同じ行が
# 閉じる。中に ``` を含むひな形は ```` で囲めばよく、取り出す側は綴りを知らなくてよい。**閉じで
# 切る**ので、ひな形が後ろで例を挙げても本体へ混ざらない。
template_body() {
  awk '
    fence == "" { if ($0 ~ /^```+$/) fence = $0; next }
    $0 == fence { exit }
    { print }
  ' "$1" >"$2"
  [ -s "$2" ] || {
    echo "ひな形から囲みの中身を取り出せない: $1" >&2
    return 1
  }
}

# ひな形（`$1`）が名乗る題を `$2` へ取り出す。**題はひな形が持つ**——投入する側が別に持つと、係の題と
# セッションの題が食い違う（`watch-routine.sh` は Routine を探す鍵にもこの題を使う）。
template_title() {
  sed -n 's/^題: *//p' "$1" | head -1 >"$2"
  [ -s "$2" ] || {
    echo "ひな形に \`題:\` の行が無い: $1" >&2
    return 1
  }
}
