#!/usr/bin/env bash
# コンフリクトしているPRが、**どのファイルで・何とぶつかったか**を出す。
#
#   bash scripts/agent/describe-conflict.sh 1573
#
#   FILE <パス>       … `main` との併合で解決できなかったファイル
#   WITH <PR番号>     … 分岐点から後、そのファイルを `main` へ入れたPR
#   終了コード 0 … 調べられた（ぶつかっていなければ何も出さない）
#   終了コード 2 … 調べられなかった（`git fetch` が通らない等）
#
# **相手を出せるのは、squash マージの件名が `(#番号)` で終わるから**（`merge-and-close.sh`）。
# 分岐点から `main` の先頭までのうち、衝突したファイルを触った件名だけを引く。
#
# 使うのは [`board-round.mjs`](board-round.mjs) で、**手を打つためではなく控えるため**
# （`.claude/board-design.md` 3.1）。盤面は同じファイルを書く issue を並べて投入するので、
# ぶつかった実績を残しておかないと、`area:` の錠を足すべき資源が後から分からない。

set -euo pipefail

PR="${1:?PR番号}"

# **自分の置き場からリポジトリの根まで出る。** 呼び手のカレントに依らずに済み、`git` の出す
# パスもリポジトリからの形で揃う（カレントからの相対で出ると、記録した後で何のファイルか読めない）。
cd "$(dirname "${BASH_SOURCE[0]}")"
cd "$(git rev-parse --show-toplevel)"

git fetch -q origin main || exit 2
main_tip=$(git rev-parse FETCH_HEAD)
git fetch -q origin "pull/$PR/head" || exit 2
pr_tip=$(git rev-parse FETCH_HEAD)

# 併合できたときは終了コード0、衝突したときは1。**どちらも答え**なので、それ以外だけを失敗と読む。
code=0
out=$(git merge-tree --write-tree --name-only "$main_tip" "$pr_tip") || code=$?
[ "$code" -le 1 ] || exit 2

# 1行目は併合結果の木、続けて衝突したファイル、空行の後は人向けの説明。
files=$(printf '%s\n' "$out" | awk 'NR == 1 { next } /^$/ { exit } { print }')
[ -n "$files" ] || exit 0

paths=()
while IFS= read -r path; do
  paths+=("$path")
  printf 'FILE %s\n' "$path"
done <<<"$files"

subjects=$(git log --format=%s "$(git merge-base "$main_tip" "$pr_tip")..$main_tip" -- "${paths[@]}")

# **自分は外す。** 一度マージされて枝が残っているPRを調べると、自分の squash が相手として出る。
# 相手が1本も残らないことはあるので、`grep` が空で終わるのは失敗ではない。
printf '%s\n' "$subjects" |
  sed -n 's/.*(#\([0-9][0-9]*\))$/\1/p' |
  sort -un |
  { grep -vx "$PR" || true; } |
  sed 's/^/WITH /'
