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
# ## 「生きている」の定義は持たない
#
# 一覧と生死の判定は [`live-sessions.sh`](live-sessions.sh) が持つ。ここがするのは、その一覧に
# 渡されたタグが在るかを見ることだけ。**同じ判定を要る場所が他にもある**（使用量の割り当て。2.5）
# ので、条件をこちらへ写さない。

set -euo pipefail

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

while IFS=$'\t' read -r id bucket tags; do
  [ -n "$id" ] || continue
  for want in "$@"; do
    case ",$tags," in
    *",$want,"*)
      echo "HELD $id $bucket $want"
      exit 1
      ;;
    esac
  done
done <<<"$live"

echo FREE
