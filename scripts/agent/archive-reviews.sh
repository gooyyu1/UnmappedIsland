#!/usr/bin/env bash
# あるPRのレビューのCCRセッションを畳む。
#
#   bash scripts/agent/archive-reviews.sh 1152
#
# 出力は1行1件。畳めたら `ARCHIVED <ID>`、畳めなければ `UNARCHIVED <ID>`。対象が無ければ何も
# 出さない。**引けなくても畳めなくても終了コードは0**——呼び手（投入・マージ）の本題は別に
# あるので、後片付けで落とさない。
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

set -euo pipefail

PR="${1:?PRの番号を渡す（例: 1152）}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 試験は差し替える（パスで呼ぶため PATH では差し替わらない）。
CCR_META="${CCR_META:-$HERE/../../.claude/ccr-meta.sh}"

# 応答は `<other-session>` の包みに入って返るので、中のJSONだけ取り出す。引けないときは `grep` が
# 1 を返す。`pipefail` があるので、ここで止めずに空として受ける。
#
# **`tr -d '\r'` は要る。** Windowsの jq は標準出力をテキストモードで開くので、行の区切りが CRLF に
# なる。落とさないと ID の末尾に `\r` が付いたまま `archive_session` へ渡り、向こうで JSON として
# 壊れる（`Bad control character in string literal`）。
sessions=$(bash "$CCR_META" list_sessions <<<'{"mine":true,"limit":100}' | grep -o '{"ccr".*' |
  jq -r --arg tag "review-$PR" '.ccr.data[]?
    | select(.session_status != "SESSION_STATUS_ARCHIVED")
    | select([.tags[]? | select(. == $tag)] | length > 0)
    | .id' | tr -d '\r' || true)

while read -r session; do
  [ -n "$session" ] || continue
  if printf '{"session_id":"%s"}' "$session" | bash "$CCR_META" archive_session >/dev/null; then
    echo "ARCHIVED $session"
  else
    echo "UNARCHIVED $session"
  fi
done <<<"$sessions"
