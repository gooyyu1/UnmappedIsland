#!/usr/bin/env bash
# シェルへ渡された命令が、リポジトリのファイルを書き換えようとしていないかを見る。
#
#   printf '%s' "$command" | bash scripts/agent/check-shell-command.sh
#     終了コード 0 … 通してよい
#     終了コード 1 … 拒否。理由が標準出力に出る（そのまま利用者へ見せる文面）
#
# **判定をここ1つに置く理由は、Copilot CLI と Claude Code の両方が同じ線を引くため。**
# 別々に書くと、片方だけ直したときに線がずれる。呼び出し側は
# `.github/extensions/session-bootstrap/extension.mjs` と
# `.claude/hooks/deny-shell-file-write.sh`。
#
# 止めているのは**シェルからのファイル書き換え**だけで、読み出し（`cat`・`grep`・`sed -n`）は
# 制限しない。書き換えを編集ツールに寄せるのは、実行ログにコマンドしか残らず、**何をどう変えたのかが
# 差分として見えなくなる**から。整形のフックも編集ツールにしか掛からない。
#
# 中間ファイルは一時ディレクトリへ書いてよい。**リポジトリの中と外の線**だけを引いている。
#
# 引用の中身も等しく見る。Windowsではすべて `bash -lc "..."` から走るので、引用の中を見ないと
# `bash -lc "printf x > src/..."` が素通りし、線が丸ごと消える。**代わりに、文中に記号として
# 書いた `>` は拒否される**——`echo "a > b"` と上の `bash -lc` は、この判定では見分けが付かない。
set -uo pipefail

command=$(cat)

deny() {
  printf '%s\n' "$1"
  printf 'リポジトリのファイルは create / edit ツールで書くこと（実行ログに差分が残る）。中間ファイルが要るなら /tmp へ書く。\n'
  exit 1
}

# 前後を包む引用符は行き先の一部ではない（`> "$D/ls.json"` の行き先は `$D/ls.json`）。
# 対になっているときだけ剥がす——`bash -lc "... > src/foo"` の末尾の `"` は対を持たない。
unquote() {
  case "$1" in
    '"'*'"' | \'*\') printf '%s' "${1:1:${#1}-2}" ;;
    *) printf '%s' "$1" ;;
  esac
}

# 書き換え先として許すもの。捨て先か、一時ディレクトリの中だけ。
is_allowed_target() {
  case "$1" in
    /dev/null | /dev/stdout | /dev/stderr | /dev/tty) return 0 ;;
    '$'*) return 0 ;; # 変数展開は中身が読めないので、ここでは判定しない
    */tmp/* | */temp/* | */Temp/* | /tmp/* | *.tmp) return 0 ;;
    *) return 1 ;;
  esac
}

# その場書き換え（読み出しの `sed -n` は通す）。
if grep -Eq '\b(sed|perl|ruby)[[:space:]]+(-[A-Za-z]*i([[:space:]]|$|\.)|--in-place)' <<<"$command"; then
  deny 'シェルからのその場書き換え（sed -i / perl -i）は使わない。'
fi

# 行き先を持たない `>` を先に落とす。矢印（`=>`・`->`）と、`<n>` のように `<` と対になるもの。
# どちらもコードやjqの式の中に現れる記号で、リダイレクトではない。対は `.` も `/` も含まない
# 名前に限る——`<a.txt>b.txt` を対と読むと、その後ろのリダイレクトごと消えてしまう。
redirects=${command//=>/=}
redirects=${redirects//->/-}
redirects=$(sed -E 's/<[A-Za-z0-9_-]+>//g' <<<"$redirects")

# 追記・上書きのリダイレクトと tee。`2>&1` は行き先がファイルではないので拾わない。
while read -r target; do
  [ -n "$target" ] || continue
  target=$(unquote "$target")
  is_allowed_target "$target" && continue
  deny "シェルからファイルへ書き込もうとしている（行き先: ${target}）。"
done < <(grep -oE '>>?[[:space:]]*[^[:space:]|&;<>()]+' <<<"$redirects" | sed -E 's/^>>?[[:space:]]*//')

while read -r target; do
  [ -n "$target" ] || continue
  target=$(unquote "$target")
  is_allowed_target "$target" && continue
  deny "tee でファイルへ書き込もうとしている（行き先: ${target}）。"
done < <(grep -oE '\btee[[:space:]]+(-a[[:space:]]+)?[^[:space:]|&;<>()]+' <<<"$command" |
  sed -E 's/^tee[[:space:]]+(-a[[:space:]]+)?//')

exit 0
