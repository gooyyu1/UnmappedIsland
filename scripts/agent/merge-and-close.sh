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
#   NOSESSION <PR番号>              … 本文が脚注を持たず、畳む相手が分からなかった
#   SYNCED   <コミット>             … 本体のチェックアウトを新しい `main` へ進めた
#   INSTALLED                       … 依存が変わったので本体で `npm install` した
#   DIRTY    <本体のパス>           … 本体に未コミットの変更があるので触らなかった
#   終了コード 0 … すべて片付いた
#   終了コード 1 … マージできなかった（何もしていない）
#   終了コード 2 … マージはしたが、後片付けに残りがある（上の `OPEN`・`NOSESSION`・`DIRTY`）
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
# **脚注が無いPRがある。** 本文を書き直した拍子に落ちる（PR #1083 で実際に落ちた）。黙って畳まずに
# 済ませると、走ったままのセッションが誰にも数えられず残るので、`NOSESSION` を出して残りとして扱う。
#
# ## `--delete-branch` は worktree の警告を必ず出す
#
# ローカルに `main` の worktree があると `fatal: 'main' is already used by worktree at ...` を吐くが、
# **リモートのマージとブランチ削除は成功している**。毎回 `grep -v` で潰していたので、ここへ入れる。
#
# ## 本体を追随させるのは、ここでしかできないから
#
# 作業ツリーは `<repo>/.claude/worktrees/` に置かれる。**リポジトリの中なので、Node も npm も親を
# 遡って本体の `node_modules` を見つけ、そのまま共有する。** 本体のチェックアウトが古いと、
# 共有しているのに版が食い違う——`Cannot find module` にはならず、**古い版が解決されて一部だけ
# 壊れる**（本体が `ajv` 8 を持たず eslint 由来の 6 だけ在り、テスト1本が落ちた実例がある）。
#
# 誰も本体では作業しないので、本体が自分から追いつくことはない。**`main` が動くのはマージの瞬間で、
# それを起こしているのがこのスクリプト**だから、ここで一緒に進める。
#
# 本体でブランチは持たない（detached HEAD）。`main` は同時に2箇所へチェックアウトできず、本体が
# 握ると作業ツリーが作れなくなる。detached は「固定」ではなく、ブランチ名を挟まずにコミットを
# 直接指す形で、マージのたびに指す先を新しい `main` へ付け替える。

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

# 見つからないときは `grep` が 1 を返す。`pipefail` があるので、ここで止めずに空として受ける。
sessions=$(grep -o 'session_[A-Za-z0-9]*' <<<"$body" | sort -u || true)
if [ -z "$sessions" ]; then
  echo "NOSESSION $PR"
  leftover=1
fi
# 応答は `<other-session>` の包みに入って返るので、中のJSONだけ取り出す。
while read -r session; do
  [ -n "$session" ] || continue
  status=$(printf '{"session_id":"%s"}' "$session" |
    bash "$CCR_META" get_session | grep -o '{"ccr".*' | jq -r '.ccr.session_status')
  [ "$status" != "SESSION_STATUS_ARCHIVED" ] || continue
  printf '{"session_id":"%s"}' "$session" | bash "$CCR_META" archive_session >/dev/null
  echo "ARCHIVED $session"
done <<<"$sessions"

# 本体は作業ツリーの共有先なので、進める前に汚れていないことを見る。未追跡は見ない——本体には
# `claude_rc.bat` のような、追跡していない持ち物が置いてある。
main_dir="$(cd "$HERE" && cd "$(git rev-parse --git-common-dir)/.." && pwd)"
if [ -n "$(git -C "$main_dir" status --porcelain --untracked-files=no)" ]; then
  echo "DIRTY $main_dir"
  leftover=1
else
  before=$(git -C "$main_dir" rev-parse HEAD:package-lock.json)
  git -C "$main_dir" fetch --quiet origin main
  git -C "$main_dir" checkout --quiet --detach origin/main
  echo "SYNCED $(git -C "$main_dir" rev-parse --short HEAD)"
  # 依存が変わったときだけ入れ直す。`npm install` の最中は共有先が揺れるので、毎回は打たない
  # （直近30日で `package-lock.json` を触ったコミットは1572件中3件）。
  if [ "$before" != "$(git -C "$main_dir" rev-parse HEAD:package-lock.json)" ] ||
    [ ! -e "$main_dir/node_modules/.package-lock.json" ]; then
    (cd "$main_dir" && npm install --no-fund --no-audit)
    echo "INSTALLED"
  fi
fi

exit "$([ "$leftover" -eq 0 ] && echo 0 || echo 2)"
