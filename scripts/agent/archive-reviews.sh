#!/usr/bin/env bash
# あるPRのレビューのCCRセッションを畳む。
#
#   bash scripts/agent/archive-reviews.sh 1152
#
# **ここが決めるのは「どれがそのPRのレビューか」と「走行中を守るか」**で、畳んでよいかの判定と出力は
# [`archive-session.sh`](archive-session.sh) が持つ。対象が無ければ何も出さない。
# **引けなくても畳めなくても終了コードは0**——呼び手（投入・マージ）の本題は別にあるので、
# 後片付けで落とさない。
#
# ## 呼ぶのは「そのレビューがもう起こされない」と確定した瞬間
#
# レビューのセッションは PR を出さないので、[`session-of-pr.sh`](session-of-pr.sh) では引けない
# （あちらが引くのは**直す側**）。`review-<PR番号>` のタグだけが手掛かりで、これは
# [`dispatch-review.sh`](dispatch-review.sh) が必ず付ける。
#
# 呼ぶ場所は2つあり、どちらも「もう起こされない」が確定した瞬間。
#
# - `dispatch-review.sh` が**次を立てる直前**。レビューは使い回さない設計（あちらの「再レビューでも、
#   前のセッションを起こさずに新しく立てる」）なので、次を立てる時点で前の分は終わっている。
# - `merge-and-close.sh` が**マージした後**。PRが閉じれば、最後の1本も読む相手が無くなる。**ここが
#   最後の機会**なので、走行中でも畳む（下の `--keep-working`）。
#
# ## 「読み終えたか」は状態では判定できない
#
# 走行中かどうかは分かる（`SESSION_STATUS_RUNNING`）が、**知りたいのは「読み終えたか」で、それは
# 待機中の中身にある**——「判定を書き終えた」も「こちらの追加指示を待っている」も待機中に落ちる。
# だから**どれを渡すか**を選ぶのはタグと、上の2つの出来事だけ（`.claude/parallel-work.md`
# 「状態で判定しない」）。渡した後に走行中を除くのは別の問いで、`archive-session.sh` が見る。

set -euo pipefail

PR="${1:?PRの番号を渡す（例: 1152）}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 試験は差し替える（パスで呼ぶため PATH では差し替わらない）。
CCR_META="${CCR_META:-$HERE/../../.claude/ccr-meta.sh}"

# 応答は `<other-session>` の包みに入って返るので、中のJSONだけ取り出す。引けないときは `grep` が
# 1 を返す。`pipefail` があるので、ここで止めずに空として受ける。
#
# **`tr -d '\r'` が要るのは、複数行を出して、その行を「シェルが」受け取るとき。** Windowsの外部 jq は
# 標準出力をテキストモードで開くので、行の区切りが CRLF になる。**`\r` が残るのは各行の末尾**で、
# `$(…)` が落とすのはそのうち**最後の1行ぶんだけ**。ここでは `read` が拾って `archive_session` へ
# 渡すので、JSON として壊れる（`Bad control character in string literal`）。
#
#   $ y=$(jq -rn '"A","B"'); printf '%s' "$y" | od -c   →   A  \r  \n   B
#
# 綺麗なのは最後の1行で、汚れているのはその手前まで——先頭行だけを取る経路も安全ではない。
#
# **要らない側が2つある。**
#
# - **1つの値しか出さない `$(jq …)`。** Windowsの bash（MSYS2）は、末尾の `\r\n` を丸ごと落とす。
#
#       $ x=$(jq -rn '"OPEN"'); printf '%s' "$x" | od -c   →   O   P   E   N
#
# - **複数行でも、受け取るのが `grep`・`awk` だけのとき。** MSYS2 のこの2つは `\r\n` を行の終わりとして
#   扱う（`printf 'A\r\nB' | grep -qx A` は当たる）。`grep -o` で数字や識別子だけを抜き出す使い方も、
#   `\r` は抜き出す側に入らない。`board.sh` と `watch-prs.sh` に `tr` の無い `$(jq …)` があるのは
#   これで、**シェルが行を受け取る箇所（`read`・値の比較・正規表現への埋め込み）にだけ付いている。**
#
# **この「丸ごと落とす」はWindowsの bash だけ**で、Linuxでは末尾の `\r` が残る。ただしLinuxの jq は
# `\r` を出さないので、どちらでも同じ結果になる。`gh` の `--jq` は gh 内蔵なので、Windowsでも LF。
# 無条件に掛けると、要る理由が読めなくなる。
sessions=$(bash "$CCR_META" list_sessions <<<'{"mine":true,"limit":100}' | grep -o '{"ccr".*' |
  jq -r --arg tag "review-$PR" '.ccr.data[]?
    | select([.tags[]? | select(. == $tag)] | length > 0)
    | .id' | tr -d '\r' || true)

# 畳んでよいかの判定は [`archive-session.sh`](archive-session.sh) が持つ。ここが選ぶのはタグと、
# **走行中を守るかどうか**だけ。
#
# 守るのは**PRがまだ開いているとき**。閉じた（マージされた）PRのレビューは、判定を書き終えても読む
# 相手が無いうえ、**上の2つの出来事はどちらも二度と起きない**——次のレビューは投入されず、次のマージも
# 無い。守ると `KEPT` のまま誰にも渡されずに残り、`archive-reviews.sh` を入れる前の状態（72本）へ
# 戻る（`watch-prs.sh` が見張るタグは `task` で始まるものだけなので、合図も出ない）。
keep=()
[ "$(gh pr view "$PR" --json state --jq '.state')" != "OPEN" ] || keep=(--keep-working)
CCR_META="$CCR_META" bash "$HERE/archive-session.sh" "${keep[@]}" <<<"$sessions"
