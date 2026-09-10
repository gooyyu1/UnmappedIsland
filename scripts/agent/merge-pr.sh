#!/usr/bin/env bash
# PRを1本マージする。**判断は1つも無い**——見張りが `GREEN` を出し、レビューの
# セッションが `通してよい` を返した後に叩く、決まりきった手順だけをまとめてある。
#
#   bash scripts/agent/merge-pr.sh 1036
#   bash scripts/agent/merge-pr.sh 1036 --user-ok   … 関門をユーザーの許可で越える
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
# ## 関門（`needs-user-review.sh`）は、この道具では越えられない
#
# 確定の宣言（節の `【確定】` と、文書単位の `**本書は全体が確定です。**`）を足した／消したPRは、
# **ユーザー以外の判断ではマージしない**。
# [`needs-user-review.sh`](needs-user-review.sh) が該当を出したら `判断待ち` を付けて `HELD` で止め、
# ユーザーへ回す。越えるにはユーザーの許可を引いて `--user-ok` を付けて叩き直す——**そのとき許可を
# 受けたことをPRへコメントとして残す**ので、後からどのPRが誰の許可で通ったのかを辿れる。
#
# **自動では越えられない関門にしてあるのは、越えられる関門は越えるから。** 直近25本で
# `## 仮決め` に中身のあったPRが22本、`判断待ち` が付いたのは0本だった。
#
# **レビュアーが付けた `判断待ち` は、こことは別。** `[レビュー] 通してよい（人の判断が要る）` で
# 付くほうを見ているのは盤面（[`board-move.mjs`](board-move.mjs)）で、**この道具はラベルを見ない**
# ——外れればマージの手が出て、ここは該当なしで通す。だから `--user-ok` は要らない
# （[`board-design.md`](../../.claude/board-design.md) 2.13.4）。**ラベルを1つ外すだけで越えられる形に
# してあるのは、何を判断してほしいかがレビューのコメントに書いてあるから。**

set -euo pipefail

PR="${1:?PRの番号を渡す（例: 1036）}"
USER_OK=0
[ "${2:-}" != "--user-ok" ] || USER_OK=1

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
    if [ "$USER_OK" -eq 0 ]; then
      echo "HELD $PR"
      echo "$reasons" | sed 's/^/    /'
      gh pr edit "$PR" --add-label 判断待ち >/dev/null
      exit 1
    fi
    note="$(mktemp)"
    {
      echo "[デーモン] **ユーザーの許可を得てマージします。**"
      echo
      echo '`needs-user-review.sh` はこのPRを止めていました。'
      echo
      echo '```'
      echo "$reasons"
      echo '```'
    } >"$note"
    gh pr comment "$PR" --body-file "$note" >/dev/null
    rm -f "$note"
    gh pr edit "$PR" --remove-label 判断待ち >/dev/null 2>&1 || true
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
