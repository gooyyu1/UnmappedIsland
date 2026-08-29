#!/usr/bin/env bash
# PRをマージして、後片付けまで済ませる。**判断は1つも無い**——見張りが `GREEN` を出し、レビューの
# セッションが `通してよい` を返した後に叩く、決まりきった手順だけをまとめてある。
#
#   bash scripts/agent/merge-and-close.sh 1036
#   bash scripts/agent/merge-and-close.sh 1036 --user-ok   … 関門をユーザーの許可で越える
#
# 出力は1行1件。
#   HELD     <PR番号>              … 関門に掛かった。マージしていない（理由が続けて出る）
#   MERGED   <PR番号>
#   CLOSED   <issue番号>            … PR本文の `Closes #N` が閉じたことの確認
#   OPEN     <issue番号>            … 閉じるはずが開いたまま（`Closes` の書き方を疑う）
#   ARCHIVED <セッションID>         … そのPRを出したCCRセッションを畳んだ
#   KEPT     <セッションID>         … issue を持たないセッションなので畳まなかった（相談役など）
#   NOSESSION <PR番号>              … 本文が脚注を持たず、畳む相手が分からなかった
#   UNARCHIVED <セッションID>       … 畳もうとして失敗した
#   SYNCED   <コミット>             … 本体のチェックアウトを新しい `main` へ進めた
#   INSTALLED                       … 依存が変わったので本体で `npm install` した
#   DIRTY    <本体のパス>           … 本体に未コミットの変更があるので触らなかった
#   終了コード 0 … すべて片付いた
#   終了コード 1 … マージできなかった（何もしていない。関門を含む）
#   終了コード 2 … マージはしたが、後片付けに残りがある
#                  （上の `OPEN`・`NOSESSION`・`UNARCHIVED`・`DIRTY`）
#
# ## 関門（`needs-user-review.sh`）は、司令塔が越えられない
#
# 宣言文法・スキーマ・`【確定】` の印に触るPRは、**司令塔の判断ではマージしない**。
# [`needs-user-review.sh`](needs-user-review.sh) が該当を出したら `判断待ち` を付けて `HELD` で止め、
# ユーザーへ回す。越えるにはユーザーの許可を引いて `--user-ok` を付けて叩き直す——**そのとき許可を
# 受けたことをPRへコメントとして残す**ので、後からどのPRが誰の許可で通ったのかを辿れる。
#
# **司令塔が自分の判断で越えられない関門にしてあるのは、越えられる関門は越えるから。** 直近25本で
# `## 仮決め` に中身のあったPRが22本、`判断待ち` が付いたのは0本だった。
#
# ## 畳んだのは、毎回同じ順で叩いていた5つ
#
# `gh pr merge` → PRが `MERGED` か確認 → `Closes` の issue が `CLOSED` か確認 → PRを出した
# セッションを `archive_session` → 結果の報告。**どれも判断が無いのに、司令塔の文脈を1往復ずつ
# 食う。** レビューは既に済んでいるので、ここから先を1回にまとめる。
#
# ## 畳む相手は [`session-of-pr.sh`](session-of-pr.sh) が引く
#
# 引き方はそちらに書いてある（差し戻す `send-back.sh` と同じ相手なので、1箇所に置く）。引けなければ
# `NOSESSION` を出して残りとして扱う。黙って畳まずに済ませると、走ったままのセッションが誰にも
# 数えられず残る。
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
USER_OK=0
[ "${2:-}" != "--user-ok" ] || USER_OK=1

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 試験は差し替える（`gh` は PATH で差し替わるが、これはパスで呼ぶため）。
CCR_META="${CCR_META:-$HERE/../../.claude/ccr-meta.sh}"
NEEDS_USER_REVIEW="${NEEDS_USER_REVIEW:-$HERE/needs-user-review.sh}"

body=$(gh pr view "$PR" --json body --jq '.body // ""' | tr -d '\r')
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
      echo "[司令塔] **ユーザーの許可を得てマージします。**"
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
closes=$(grep -oiE 'closes[[:space:]]+#[0-9]+' <<<"$body" | grep -oE '[0-9]+' | sort -u || true)
while read -r issue; do
  [ -n "$issue" ] || continue
  if [ "$(gh issue view "$issue" --json state --jq '.state')" = "CLOSED" ]; then
    echo "CLOSED $issue"
  else
    echo "OPEN $issue"
    leftover=1
  fi
done <<<"$closes"

# 引けないときは 1 を返す。`pipefail` があるので、ここで止めずに空として受ける。
sessions=$(CCR_META="$CCR_META" bash "$HERE/session-of-pr.sh" "$PR" || true)
if [ -z "$sessions" ]; then
  echo "NOSESSION $PR"
  leftover=1
fi
# 応答は `<other-session>` の包みに入って返るので、中のJSONだけ取り出す。
while read -r session; do
  [ -n "$session" ] || continue
  # 引けない・畳めないときは、そこで止めずに残りとして報せる。**マージは済んでいる**ので、
  # ここで落ちると後片付け（`main` の追随）ごと落ちる。
  info=$(printf '{"session_id":"%s"}' "$session" |
    bash "$CCR_META" get_session | grep -o '{"ccr".*' || true)
  [ "$(jq -r '.ccr.session_status // ""' <<<"$info")" != "SESSION_STATUS_ARCHIVED" ] || continue
  # **畳んでよいのは、1つの issue のために立てたセッションだけ**（`task-<番号>` タグを持つ。
  # `dispatch-task.sh` が必ず付ける）。相談役のように issue を持たない相手は、PR1本が
  # マージされても仕事が終わっていない——畳むと、ユーザーが話している窓口ごと閉じる。
  if ! jq -e '[.ccr.tags[]? | select(startswith("task-"))] | length > 0' <<<"$info" >/dev/null; then
    echo "KEPT $session"
    continue
  fi
  if printf '{"session_id":"%s"}' "$session" | bash "$CCR_META" archive_session >/dev/null; then
    echo "ARCHIVED $session"
  else
    echo "UNARCHIVED $session"
    leftover=1
  fi
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
