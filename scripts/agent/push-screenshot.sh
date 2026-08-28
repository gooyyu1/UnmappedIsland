#!/usr/bin/env bash
# スクリーンショットを `screenshots` ブランチへ置いて、PR本文に貼れるURLを返す。
#
#   bash scripts/agent/push-screenshot.sh <画像ファイル> <名前>
#   => https://raw.githubusercontent.com/gooyyu1/UnmappedIsland/screenshots/<枝>/<名前>.png
#
# 出力は1行。返ってきたURLをそのまま `![<名前>](URL)` の形でPR本文へ書く。
#
# ## なぜ専用のブランチが要るのか
#
# **GitHubには画像を上げるAPIが無い**（ブラウザのUIからしか投げられない）ので、**画像はgitのどこかに
# 置くしかない**。このリポジトリは public なので、`raw.githubusercontent.com` のURLはPR本文に
# そのままインライン表示される（private だとGitHubが代理取得できず表示されない）。
#
# 置き場を分けているのは、次の2つを同時に満たすため。
#
# - **`main` に入れない。** 証跡は資料ではないので、`docs/ui/` の画面説明に混ぜると何が資料なのかが
#   分からなくなる。公開サイトにも出てしまう。
# - **PRブランチに入れない。** マージ後に枝が消えると、参照していたコミットが到達不能になって画像が
#   壊れる。**「PR本文は実際に入った変更の記録」が、後から読めない記録になる。**
#
# ## 作業ツリーを触らずに積む
#
# `git worktree add` はリポジトリを丸ごとチェックアウトするので、画像1枚のために払う額ではない。
# ここでは一時的なインデックスの上で木を組み、`commit-tree` で直接コミットを作って push する。
# 作業ツリーもHEADも動かないので、**ビルドやテストの最中に呼んでも安全**。
#
# 同じブランチへ複数のセッションが同時に積むので、push が弾かれたら引き直して積み直す。
set -euo pipefail

IMAGE="${1:?画像のパスを渡す}"
NAME="${2:?名前を渡す（拡張子は付けない）}"
BRANCH=screenshots
ATTEMPTS=5

[ -r "$IMAGE" ] || {
  echo "読めない: $IMAGE" >&2
  exit 1
}

# `owner/repo` は remote のURLから取る。**`gh` を使ってはいけない**——CCRのタスクセッションには
# `gh` が入っておらず（GitHubへはMCP経由）、ここで `command not found` になる。画面を触るタスクは
# 全部この道具を通るので、落ちると証跡が1枚も貼られない。
REPO=$(git config --get remote.origin.url |
  sed -E 's#^(https?://[^/]+/|git@[^:]+:|ssh://git@[^/]+/)##; s#\.git$##')
[ -n "$REPO" ] || {
  echo "remote.origin.url から owner/repo を取れなかった" >&2
  exit 1
}

# 置き場は枝ごとに分ける。剥がれた HEAD なら短いコミットで代用する（枝の名前が無いだけで、
# 同じPRの画像が1箇所へ集まることは変わらない）。
ref=$(git rev-parse --abbrev-ref HEAD)
[ "$ref" != "HEAD" ] || ref=$(git rev-parse --short HEAD)
dir=$(printf '%s' "$ref" | tr -c 'A-Za-z0-9._/-' '-')
path="$dir/$NAME.png"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
export GIT_INDEX_FILE="$work/index"

blob=$(git hash-object -w "$IMAGE")

for attempt in $(seq "$ATTEMPTS"); do
  # 既に在れば積み上げ、無ければ空の木から始める（このブランチの1つ目のコミット）。
  if git fetch --quiet origin "$BRANCH" 2>/dev/null; then
    parent=$(git rev-parse FETCH_HEAD)
    git read-tree "$parent"
  else
    parent=''
    git read-tree --empty
  fi

  git update-index --add --cacheinfo "100644,$blob,$path"
  tree=$(git write-tree)
  # shellcheck disable=SC2086 # 親が無い1つ目のコミットでは -p ごと落とす
  commit=$(git commit-tree "$tree" ${parent:+-p "$parent"} -m "$path")

  if git push --quiet origin "$commit:refs/heads/$BRANCH" 2>/dev/null; then
    echo "https://raw.githubusercontent.com/$REPO/$BRANCH/$path"
    exit 0
  fi
  echo "（$BRANCH が動いた。引き直して積み直す: $attempt/$ATTEMPTS）" >&2
done

echo "$ATTEMPTS 回続けて push できなかった" >&2
exit 1
