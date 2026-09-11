#!/usr/bin/env bash
# PRを1本マージする。**判断は1つも無い**——見張りが `GREEN` を出し、レビューの
# セッションが `通してよい` を返した後に叩く、決まりきった手順だけをまとめてある。
#
#   bash scripts/agent/merge-pr.sh 1036
#
# 出力は1行1件。
#   HELD     <PR番号>              … 関門に掛かった。マージしていない（理由が続けて出る）
#   MERGED   <PR番号>
#   終了コード 0 … マージした
#   終了コード 1 … マージできなかった（何もしていない。関門を含む）
#
# ## 後片付けは、ここではしない
#
# **マージしたかと、後片付けが済んだかは別の問い。** 繋ぐと、**人が画面からマージしたときに後片付けが
# 一度も走らない**——ユーザーはPRをGitHubの画面からマージするので、繋いだままだと本体のチェックアウトが
# 置き去りになり、`Closes` の閉じ損ねも誰も見ていない状態になる（出どころ: ユーザーの指示・2026-09-07）。
# ワーカーを畳む手が先に避けたのと同じ誤りで、避け方も同じ
# （[`board-design.md`](../../.claude/board-design.md) 2.10.1）。
#
# 後片付けを持つのは [`tidy-merged-pr.sh`](tidy-merged-pr.sh) で、**マージ済みのPRを見つけた周**に
# 盤面が打つ。ブランチの削除と、上に積まれたPRの base の張り替えは**GitHub 自身がやる**ので、
# どちらもここには無い（あちらの「GitHub が肩代わりするもの」）。
#
# ## 関門（`needs-user-review.sh`）を越える道は、この道具に無い
#
# 確定の宣言（節の `【確定】` と、文書単位の `**本書は全体が確定です。**`）を足した／消したPRは、
# **ユーザー以外の判断ではマージしない**。
# [`needs-user-review.sh`](needs-user-review.sh) が該当を出したら `判断待ち` を付けて `HELD` で止め、
# ユーザーへ回す。**そこから先はユーザーが画面からマージする**——人が画面から入れるなら、その判断は
# 定義上もう済んでいる（[`board-design.md`](../../.claude/board-design.md) 2.13.1）。**許可を引いて
# 叩き直す口は持たない。** 打つ操作を1つ足すと、ユーザーが覚えることがその分だけ増える。
#
# **自動では越えられない関門にしてあるのは、越えられる関門は越えるから。** 直近25本で
# `## 仮決め` に中身のあったPRが22本、`判断待ち` が付いたのは0本だった。
#
# **レビュアーが付けた `判断待ち` も、越え方は同じ**（画面からのマージ）。ラベルを見ているのは盤面
# （[`board-move.mjs`](board-move.mjs)）で、**この道具はラベルを見ない**——付いている間は盤面が
# マージの手を出さないので、ここまで来ない（2.13.4）。

set -euo pipefail

PR="${1:?PRの番号を渡す（例: 1036）}"

# `%/*` は区切りが無いと文字列をそのまま返す。
HERE="${BASH_SOURCE[0]%/*}"
if [[ "$HERE" == "${BASH_SOURCE[0]}" ]]; then HERE='.'; fi
HERE="$(cd "$HERE" && pwd)"
# 試験は差し替える（`gh` は PATH で差し替わるが、これはパスで呼ぶため）。
NEEDS_USER_REVIEW="${NEEDS_USER_REVIEW:-$HERE/needs-user-review.sh}"

state=$(gh pr view "$PR" --json state --jq '.state')

if [ "$state" = "OPEN" ]; then
  # 関門。**マージの前に見る**——通した後では、印が付いた状態が `main` に入ってしまう。
  reasons=$(bash "$NEEDS_USER_REVIEW" "$PR" 2>&1) && gate=0 || gate=$?
  if [ "$gate" -ne 1 ]; then
    echo "HELD $PR"
    echo "$reasons" | sed 's/^/    /'
    gh pr edit "$PR" --add-label 判断待ち >/dev/null
    exit 1
  fi

  mergeable=$(gh pr view "$PR" --json mergeable --jq '.mergeable')
  if [ "$mergeable" != "MERGEABLE" ]; then
    echo "マージできない（mergeable=$mergeable）。コンフリクトなら差し戻す。" >&2
    exit 1
  fi
  # **ブランチは消さない。** `delete_branch_on_merge` が真なので、消すのはGitHub
  # （[`tidy-merged-pr.sh`](tidy-merged-pr.sh) の「GitHub が肩代わりするもの」）。失敗は下の state で捕まえる。
  gh pr merge "$PR" --squash || true
  state=$(gh pr view "$PR" --json state --jq '.state')
fi

if [ "$state" != "MERGED" ]; then
  echo "マージされていない（state=$state）" >&2
  exit 1
fi
echo "MERGED $PR"
