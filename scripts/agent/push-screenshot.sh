#!/usr/bin/env bash
# スクリーンショットを `screenshots` ブランチへ置いて、PR本文に貼れるURLを返す。
#
#   bash scripts/agent/push-screenshot.sh <画像ファイル> <名前>
#   => https://raw.githubusercontent.com/gooyyu1/UnmappedIsland/screenshots/<枝>/<名前>.png
#
# 出力は1行。返ってきたURLをそのまま `![<名前>](<URL>)` の形でPR本文へ書く。
#
# ## 転んだ行には、打った git の標準エラーを載せる
#
# 落ちた事実だけを出すと、読んだ側は**競合なのか、権限なのか、通信が落ちたのか**へ辿り着けず、同じ
# コマンドを手で打ち直すところから始めることになる。理由を持っているのは打った側なので、捨てずに
# 同じ行へ載せる（[`archive-session.sh`](../daemon/archive-session.sh) の `DIRTY` と同じ形。
# **1行1件**なので改行は空白へ畳む）。
#
# **落ちた理由を、こちらで決めつけない。** 同じブランチへ同時に積めば競合するが、権限も通信も同じ
# 非0で返る。**「ブランチが動いた」と決めつけた文面で繰り返すと、繰り返しても直らない理由が同じ顔で
# 何度も出る。** 名乗るのは打った側で、こちらは何回目かだけを言う。
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
  # 既に在れば積み上げ、無ければ空の木から始める（このブランチの1つ目のコミット）。**ブランチが
  # まだ無いのか、引きに行けなかったのかは、打った側しか知らない**ので、理由をそのまま出したうえで
  # 空の木から始める（積むものが在ったなら、下の push が非fast-forwardで断る）。
  if err=$(git fetch --quiet origin "$BRANCH" 2>&1 >/dev/null); then
    parent=$(git rev-parse FETCH_HEAD)
    git read-tree "$parent"
  else
    echo "$BRANCH を引けなかったので、空の木から積む: ${err//$'\n'/ }" >&2
    parent=''
    git read-tree --empty
  fi

  git update-index --add --cacheinfo "100644,$blob,$path"
  tree=$(git write-tree)
  # shellcheck disable=SC2086 # 親が無い1つ目のコミットでは -p ごと落とす
  commit=$(git commit-tree "$tree" ${parent:+-p "$parent"} -m "$path")

  if err=$(git push --quiet origin "$commit:refs/heads/$BRANCH" 2>&1 >/dev/null); then
    echo "https://raw.githubusercontent.com/$REPO/$BRANCH/$path"
    exit 0
  fi
  echo "push できなかった（$attempt/$ATTEMPTS。引き直して積み直す）: ${err//$'\n'/ }" >&2
done

echo "$ATTEMPTS 回続けて push できなかった: ${err//$'\n'/ }" >&2
exit 1
