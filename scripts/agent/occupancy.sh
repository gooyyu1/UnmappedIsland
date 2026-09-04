#!/usr/bin/env bash
# タグの指す仕事が、今セッションに占有されていないかを見る。**答えるのは「立ててよいか」。**
#
#   bash scripts/agent/occupancy.sh task-1234
#   bash scripts/agent/occupancy.sh review-1500 task-1415
#
# **タグは複数渡せる。1つでも占有されていれば立ててはいけない。** レビューを立てる前に見るのは
# 「前のレビューが走っていないか」だけではなく「**そのPRを直しているセッションが居ないか**」でもある
# （[`board-design.md`](../../.claude/board-design.md) 1.3）。1回の一覧の走査で全部を見る。
#
# 出力は次のどれか。**終了コードが0なのは `FREE` のときだけ**で、他は全部「立ててはいけない」。
#
#   FREE
#   HELD <セッションID> <status_bucket> <タグ>
#   UNKNOWN <理由>
#
# ## 読めなかったときに止まる側へ倒すのを、ここが引き受ける
#
# 呼び手が終了コードを見るだけで安全側になるよう、**`UNKNOWN` も `HELD` と同じ非0**にしている。
# 「占有されていない」と「引けなかった」を呼び手に区別させると、区別を忘れた呼び手が
# 二重に立てる（`CLAUDE.md`「自分のことは自分でする」）。区別が要るときは出力の1語目を見る。
#
# 溢れるより止まるほうが軽い、という向きは [`board-design.md`](../../.claude/board-design.md) 2.4 と
# 同じ。余分に立ったセッションは、同じPRへ食い違う判定を残す（1.5）。
#
# ## 占有の判定に時刻を使わない
#
# 見るのは `session_status` と `status_bucket` だけ（1.2）。**`updated_at` は走行中でも動かない**
# ——2026-09-05 の実測で、走っているセッションの `updated_at` が前日のまま止まっていた。
# 「古いから止まっている」は書けない。
#
# 結果として、**固まった走行中のセッションは占有したままになる。** これは意図した側で、時間で
# 勝手に剥がすと PR #1493 の二重投入と同じ形に戻る。剥がすのは人が畳んだとき。
#
# ## 一覧は最後まで繰る
#
# `list_sessions` の `tags` での絞り込みは、この呼び出し元からは使えない（指定すると異常終了する。
# 使えるのはOAuthの呼び出し元だけ）ので、取ってから手元で絞る。
#
# **1ページで済ませない。** 上の「固まったセッションも占有」がある以上、占有している相手が直近
# 100件に居るとは限らない。ただし**見つけた時点で打ち切る**ので、止まっている相手が居るときほど
# 早く返る。
#
# 繰り方と `tr -d '\r'` の要否は [`archive-reviews.sh`](archive-reviews.sh) と同じ。

set -euo pipefail

[ "$#" -gt 0 ] || {
  echo "UNKNOWN タグを1つ以上渡す（例: task-1234 / review-1500）"
  exit 1
}
TAGS="$(printf '%s\n' "$@")"

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
    echo "UNKNOWN セッションの一覧を引けなかった"
    exit 1
  fi

  held=$(jq -r --arg tags "$TAGS" '($tags | split("\n") | map(select(length > 0))) as $want
    | .ccr.data[]?
    | select(.session_status != "SESSION_STATUS_ARCHIVED")
    | select(.status_bucket != "SESSION_STATUS_BUCKET_COMPLETED")
    | select(.status_bucket != "SESSION_STATUS_BUCKET_FAILED")
    | . as $s
    | ($want | map(select(. as $w | [$s.tags[]?] | index($w))) | first) as $hit
    | select($hit != null)
    | "HELD \($s.id) \($s.status_bucket // "-") \($hit)"' <<<"$page" | tr -d '\r')
  if [ -n "$held" ]; then
    printf '%s\n' "$held"
    exit 1
  fi

  [ "$(jq -r '.ccr.has_more // false' <<<"$page" | tr -d '\r')" = true ] || break
  after=$(jq -r '.ccr.last_id // ""' <<<"$page" | tr -d '\r')
  [ -n "$after" ] || break
done

echo FREE
