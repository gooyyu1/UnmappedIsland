#!/usr/bin/env bash
# タグの指す仕事が、今セッションに占有されていないかを見る。**答えるのは「立ててよいか」。**
#
#   bash scripts/agent/occupancy.sh --live task-1234
#   bash scripts/agent/occupancy.sh --busy review-1500 task-1415
#
# **タグは複数渡せる。1つでも占有されていれば立ててはいけない。** レビューを立てる前に見るのは
# 「前のレビューが走っていないか」だけではなく「**そのPRを直しているセッションが居ないか**」でもある
# （[`board-design.md`](../../.claude/board-design.md) 1.3）。1回の一覧の走査で全部を見る。
#
# 出力は次のどれか。**終了コードが0なのは `FREE` のときだけ**で、他は全部「立ててはいけない」。
#
#   FREE
#   HELD <セッションID> <session_status> <タグ>
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
# ## 答える問いは、呼び手が選ぶ
#
# 一覧は [`live-sessions.sh`](live-sessions.sh) が持ち、**畳まれていないセッションを全部**返す。
# `--busy` のときだけ、そこから**手が動いているもの**に絞る（絞り方は
# [`board-design.md`](../../.claude/board-design.md) 1.6）。
#
# **問いは2つあり、答えが違う**（[`board-design.md`](../../.claude/board-design.md) 1.2）。
# どちらを訊くかは呼び手が渡す。
#
#   --live … **もう投入したか。** 畳まれていないセッション全部。手が空いていても、その仕事は
#            既に配られている。これを訊かずに投入すると、同じ issue へ2本目が立つ（1.5）。
#   --busy … **今その差分へ手が動いているか。** 走行中のものだけ。これを `--live` で訊くと、
#            判定を書き終えたレビューが占有し続けて**再レビューが永久に止まる**。
#
# 種類ごとにどちらを訊くかは [`may-dispatch.sh`](may-dispatch.sh) が持つ。ここは訊かれた問いに
# 答えるだけで、投入の種類を知らない。

set -euo pipefail

case "${1:-}" in
--live | --busy) MODE="$1" && shift ;;
*)
  echo "UNKNOWN 問いを渡す（--live / --busy）"
  exit 1
  ;;
esac

[ "$#" -gt 0 ] || {
  echo "UNKNOWN タグを1つ以上渡す（例: task-1234 / review-1500）"
  exit 1
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CCR_META="${CCR_META:-$HERE/../../.claude/ccr-meta.sh}"

if ! live=$(CCR_META="$CCR_META" bash "$HERE/live-sessions.sh" 2>/dev/null); then
  echo "UNKNOWN セッションの一覧を引けなかった"
  exit 1
fi

while IFS=$'\t' read -r id status bucket tags; do
  [ -n "$id" ] || continue
  if [ "$MODE" = --busy ]; then
    # **手が動いているかを言うのは `session_status` だけ。** `status_bucket` は手番が終わった後の
    # 要約から決まるので、どの値も「処理中」を意味しない（1.6 の実測）。
    case "$status|$bucket" in
    SESSION_STATUS_RUNNING\|*) ;;
    *) continue ;;
    esac
  fi
  for want in "$@"; do
    case ",$tags," in
    *",$want,"*)
      echo "HELD $id $status $want"
      exit 1
      ;;
    esac
  done
done <<<"$live"

echo FREE
