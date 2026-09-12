#!/usr/bin/env bash
# ひな形（`agent-ops/prompts/*-prompt.md`）から、セッションへ渡す本体と題を取り出す。**シェルから `source`
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
# 出す先をファイルにするのは、**本文をシェルの展開に通さないため**——危ないのは文字の符号ではなく
# 展開で、バッククォートで囲んだ識別子はコマンドとして実行されて消える
# （[`.claude/ccr-meta.sh`](../../.claude/ccr-meta.sh)「指示は Write で書く」）。**文字化けは考えなくて
# よい**（node は argv も環境変数も標準入力もUTF-8で受ける。2026-09-05 にコードページ932のまま実測）。

# ひな形（`$1`）の囲みの中身を `$2` へ取り出す。**どこまでが本体かを決めるのは
# [`prompt-body.mjs`](prompt-body.mjs)**——ここと、節を引ける範囲を見るドキュメントの検査が、同じ
# ものを本体と呼ぶ。ここが持つのは、空で渡さないための関門だけ。
template_body() {
  node "$(dirname "${BASH_SOURCE[0]}")/prompt-body.mjs" "$1" >"$2"
  [ -s "$2" ] || {
    echo "ひな形から囲みの中身を取り出せない: $1" >&2
    return 1
  }
}

# ひな形（`$1`）が名乗る題を `$2` へ取り出す。**題はひな形が持つ**——投入する側が別に持つと、係の題と
# セッションの題が食い違う。
template_title() {
  sed -n 's/^題: *//p' "$1" | head -1 >"$2"
  [ -s "$2" ] || {
    echo "ひな形に \`題:\` の行が無い: $1" >&2
    return 1
  }
}
