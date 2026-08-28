#!/usr/bin/env bash
# PRをマージして、後片付けまで済ませる。**判断は1つも無い**——見張りが `GREEN` を出し、司令塔が
# 差分を読んで通すと決めた後に叩く、決まりきった手順だけをまとめてある。
#
#   bash scripts/agent/merge-and-close.sh 1036
#
# 出力は1行1件。
#   MERGED   <PR番号>
#   CLOSED   <issue番号>            … PR本文の `Closes #N` が閉じたことの確認
#   OPEN     <issue番号>            … 閉じるはずが開いたまま（`Closes` の書き方を疑う）
#   ARCHIVED <セッションID>         … そのPRを出したCCRセッションを畳んだ
#   終了コード 0 … すべて片付いた
#   終了コード 1 … マージできなかった（何もしていない）
#   終了コード 2 … マージはしたが、後片付けに残りがある（上の `OPEN` など）
#
# ## 畳んだのは、毎回同じ順で叩いていた5つ
#
# `gh pr merge` → PRが `MERGED` か確認 → `Closes` の issue が `CLOSED` か確認 → PRを出した
# セッションを `archive_session` → 結果の報告。**どれも判断が無いのに、司令塔の文脈を1往復ずつ
# 食う。** 読むべき差分は既に読み終わっているので、ここから先を1回にまとめる。
#
# ## セッションは、タイトルではなく本文の脚注で引く
#
# PR本文の末尾に `https://claude.ai/code/session_...` が入る（Claude Codeが付ける）。**これが、その
# PRを実際に出したセッション。** タイトルの `(#1029)` で引くと、同じ issue へ2回投入したときに
# 古いほうを畳む。`watch-prs.sh` の `STALLED` も同じ脚注を見ている。
#
# ## `--delete-branch` は worktree の警告を必ず出す
#
# ローカルに `main` の worktree があると `fatal: 'main' is already used by worktree at ...` を吐くが、
# **リモートのマージとブランチ削除は成功している**。毎回 `grep -v` で潰していたので、ここへ入れる。

set -euo pipefail

PR="${1:?PRの番号を渡す（例: 1036）}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 試験は差し替える（`gh` は PATH で差し替わるが、これはパスで呼ぶため）。
CCR_META="${CCR_META:-$HERE/../../.claude/ccr-meta.sh}"

body=$(gh pr view "$PR" --json body --jq '.body // ""' | tr -d '\r')
state=$(gh pr view "$PR" --json state --jq '.state')

if [ "$state" = "OPEN" ]; then
  mergeable=$(gh pr view "$PR" --json mergeable --jq '.mergeable')
  if [ "$mergeable" != "MERGEABLE" ]; then
    echo "マージできない（mergeable=$mergeable）。コンフリクトなら差し戻す。" >&2
    exit 1
  fi
  # 警告だけを落とす。マージ自体の失敗は下の state で捕まえる。
  gh pr merge "$PR" --squash --delete-branch 2>&1 | grep -v 'already used by worktree' || true
  state=$(gh pr view "$PR" --json state --jq '.state')
fi

if [ "$state" != "MERGED" ]; then
  echo "マージされていない（state=$state）" >&2
  exit 1
fi
echo "MERGED $PR"

leftover=0

# `Closes #123` だけを拾う。番号だけの参照（`#123`）では閉じないので、ここでも見ない。
while read -r issue; do
  [ -n "$issue" ] || continue
  if [ "$(gh issue view "$issue" --json state --jq '.state')" = "CLOSED" ]; then
    echo "CLOSED $issue"
  else
    echo "OPEN $issue"
    leftover=1
  fi
done < <(grep -oiE 'closes[[:space:]]+#[0-9]+' <<<"$body" | grep -oE '[0-9]+' | sort -u)

# 応答は `<other-session>` の包みに入って返るので、中のJSONだけ取り出す。
while read -r session; do
  [ -n "$session" ] || continue
  status=$(printf '{"session_id":"%s"}' "$session" |
    bash "$CCR_META" get_session | grep -o '{"ccr".*' | jq -r '.ccr.session_status')
  [ "$status" != "SESSION_STATUS_ARCHIVED" ] || continue
  printf '{"session_id":"%s"}' "$session" | bash "$CCR_META" archive_session >/dev/null
  echo "ARCHIVED $session"
done < <(grep -o 'session_[A-Za-z0-9]*' <<<"$body" | sort -u)

exit "$([ "$leftover" -eq 0 ] && echo 0 || echo 2)"
