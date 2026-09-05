#!/usr/bin/env bash
# **畳まれていないセッション**を1行1件で出す。「畳まれていない」の定義はここ1箇所だけが持つ。
#
#   $ bash scripts/agent/live-sessions.sh
#   cse_abc123<TAB>SESSION_STATUS_RUNNING<TAB>SESSION_STATUS_BUCKET_WORKING<TAB>task-1234
#
# 1行が `<セッションID>\t<session_status>\t<status_bucket>\t<タグをカンマで繋いだもの>`。1本も
# 無ければ**何も出さずに終了コード0**。**引けなかったときは終了コード1**で、呼び手は止まる側へ
# 倒せる。
#
# ## なぜ切り出したか
#
# 一覧を要るのは2つある——**占有の判定**（[`occupancy.sh`](occupancy.sh)）と、**使用量の割り当て**
# （[`usage-record.sh`](usage-record.sh)。[`board-design.md`](../../.claude/board-design.md) 2.5.3）。
# **2箇所に同じ条件を書くと、片方だけが直る。**
#
# ## 絞るのは `SESSION_STATUS_ARCHIVED` だけ
#
# **手が空いていることは、仕事が終わったことではない。** `status_bucket` が
# `..._COMPLETED` / `..._BLOCKED` / `..._FAILED` でも、そのセッションは仕事を持ったまま次の指示を
# 待っている——**畳まれたセッションでさえ、`unarchive_session` → `send_message` で文脈ごと再開
# できる**（1.5 の実測）。ここで落とすと、占有の側が「空いている」と読んで二重に立てる。
#
# **`session_status` と `status_bucket` は両方そのまま出す。** どちらで何を読むかは呼び手が決める
# （1.6）。条件をこちらへ持つと、どちらの呼び手にも合わない定義が1つできる。
#
# 判定に **`updated_at` は使わない**（1.6）——走行中でも動かないことを 2026-09-05 に実測している。
#
# ## 一覧は最後まで繰る
#
# `list_sessions` の `tags` での絞り込みは、この呼び出し元からは使えない（指定すると異常終了する。
# 使えるのはOAuthの呼び出し元だけ）ので、取ってから手元で絞る。**1ページで済ませない**——固まった
# 走行中のセッションは占有したままなので、直近100件の外に居ることがある。
#
# 繰り方と `tr -d '\r'` の要否は [`archive-reviews.sh`](archive-reviews.sh) と同じ。

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 試験は差し替える（パスで呼ぶため PATH では差し替わらない）。
CCR_META="${CCR_META:-$HERE/../../.claude/ccr-meta.sh}"

after=''
while :; do
  if [ -z "$after" ]; then
    req='{"mine":true,"limit":100}'
  else
    req=$(printf '{"mine":true,"limit":100,"after_id":"%s"}' "$after")
  fi

  page=$(bash "$CCR_META" list_sessions <<<"$req" | grep -o '{"ccr".*' || true)
  if [ -z "$page" ]; then
    echo "セッションの一覧を引けなかった" >&2
    exit 1
  fi

  jq -r '.ccr.data[]?
    | select(.session_status != "SESSION_STATUS_ARCHIVED")
    | [.id, (.session_status // "-"), (.status_bucket // "-"), ([.tags[]?] | join(","))]
    | @tsv' <<<"$page" | tr -d '\r'

  [ "$(jq -r '.ccr.has_more // false' <<<"$page" | tr -d '\r')" = true ] || break
  after=$(jq -r '.ccr.last_id // ""' <<<"$page" | tr -d '\r')
  [ -n "$after" ] || break
done
