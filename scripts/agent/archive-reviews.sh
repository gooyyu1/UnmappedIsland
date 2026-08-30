#!/usr/bin/env bash
# あるPRのレビューのCCRセッションを畳む。
#
#   bash scripts/agent/archive-reviews.sh 1152
#
# 出力は1行1件。畳めたら `ARCHIVED <ID>`、畳めなければ `UNARCHIVED <ID>`、触らないと決めたものは
# `KEPT <ID>`（下のブリッジ）。対象が無ければ何も出さない。**引けなくても畳めなくても終了コードは0**
# ——呼び手（投入・マージ）の本題は別にあるので、後片付けで落とさない。
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
# - `merge-and-close.sh` が**マージした後**。PRが閉じれば、最後の1本も読む相手が無くなる。
#
# ## 状態（`session_status`）では判定できない
#
# **読んでいる最中のレビューも `SESSION_STATUS_IDLE` を返す。** 状態で畳むと走行中のレビューを
# 止めるので、見るのはタグと、上の2つの出来事だけ。
#
# ## ブリッジで立てたレビューは畳まない
#
# `dispatch-review.sh --bridge` はこのPCの環境へ立てるので、`review-<PR番号>` のタグは**クラウドと
# ブリッジのどちらにも付きうる**。`claude remote-control` が落ちている間にブリッジのセッションを
# 畳むと、worktree がロックされたまま残る（`parallel-work.md`「終わったセッションは、issue を鍵に
# して畳む」）。タグでは区別が付かないので、`environment_id` で除いて `KEPT` として出す。

set -euo pipefail

PR="${1:?PRの番号を渡す（例: 1152）}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/agent/ccr-env.sh
source "$HERE/ccr-env.sh"
# 試験は差し替える（パスで呼ぶため PATH では差し替わらない）。
CCR_META="${CCR_META:-$HERE/../../.claude/ccr-meta.sh}"

# 応答は `<other-session>` の包みに入って返るので、中のJSONだけ取り出す。引けないときは `grep` が
# 1 を返す。`pipefail` があるので、ここで止めずに空として受ける。
#
# **`tr -d '\r'` が要るのは、複数行を出してそれを行ごとに使うから。** Windowsの外部 jq は標準出力を
# テキストモードで開くので、行の区切りが CRLF になる。**`$(…)` が落とすのは末尾だけ**なので、
# 2行目以降の頭に `\r` が残り、`archive_session` へ渡った先で JSON として壊れる
# （`Bad control character in string literal`）。
#
#   $ y=$(jq -rn '"A","B"'); printf '%s' "$y" | od -c   →   A  \r  \n   B
#
# **1つの値しか出さない `$(jq …)` には要らない。** Windowsの bash（MSYS2）は、末尾の `\r\n` を
# 丸ごと落とす。
#
#   $ x=$(jq -rn '"OPEN"'); printf '%s' "$x" | od -c   →   O   P   E   N
#
# **この「丸ごと落とす」はWindowsの bash だけ**で、Linuxでは末尾の `\r` が残る。ただしLinuxの jq は
# `\r` を出さないので、どちらでも同じ結果になる。`gh` の `--jq` は gh 内蔵なので、Windowsでも LF。
# 無条件に掛けると、要る理由が読めなくなる。
sessions=$(bash "$CCR_META" list_sessions <<<'{"mine":true,"limit":100}' | grep -o '{"ccr".*' |
  jq -r --arg tag "review-$PR" --arg bridge "$BRIDGE_ENV" '.ccr.data[]?
    | select(.session_status != "SESSION_STATUS_ARCHIVED")
    | select([.tags[]? | select(. == $tag)] | length > 0)
    | [(if .environment_id == $bridge then "KEPT" else "ARCHIVE" end), .id]
    | @tsv' | tr -d '\r' || true)

while read -r verdict session; do
  [ -n "$session" ] || continue
  if [ "$verdict" = KEPT ]; then
    echo "KEPT $session"
  elif printf '{"session_id":"%s"}' "$session" | bash "$CCR_META" archive_session >/dev/null; then
    echo "ARCHIVED $session"
  else
    echo "UNARCHIVED $session"
  fi
done <<<"$sessions"
