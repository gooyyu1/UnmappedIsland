#!/usr/bin/env bash
# 開いているPRのCIを見張り、決着が付いたPRが現れた時点でその一覧を出して終了する。
#
# **PRを見張るのは司令塔の仕事で、PRを出したセッションの仕事ではない。** 各セッションに
# 見張らせると、自分を起こすための `send_later` と、その取り消しの `delete_trigger` を使うことに
# なる。この2つは自動承認できないので、そのままユーザーのタップに化ける。司令塔はシェルで待てる。
#
#   bash .claude/watch-prs.sh                       # 開いている全PR
#   bash .claude/watch-prs.sh 731 733               # 番号を指定
#   bash .claude/watch-prs.sh --interval 5 --timeout-minutes 60
#
# 出力は1行1PRで、**終了コードで区別できる**。
#   GREEN <番号> <ラベル>   … 全チェックが成功（ラベルが空なら素通しの候補）
#   RED   <番号> <落ちたチェック名>
#   終了コード 0 … 決着が1件以上ある（GREEN / RED の行が出ている）
#   終了コード 3 … TIMEOUT（制限時間まで、どれも決着しなかった）
#   終了コード 1 … ERROR（gh が続けて失敗した）
#
# 決着が付いた行を受け取った側の動きは `.claude/parallel-work.md` の「PR の型」節。
# GREEN かつ `判断待ち` ラベルが無ければ司令塔がマージし、RED なら**そのPRを出したセッションを
# `send_message` で起こして直させる**（畳んだ後なら新しいセッションを立てる）。

set -uo pipefail

INTERVAL=5
TIMEOUT_MINUTES=60
FAILURE_LIMIT=20
NUMBERS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --interval)
      INTERVAL="$2"
      shift 2
      ;;
    --timeout-minutes)
      TIMEOUT_MINUTES="$2"
      shift 2
      ;;
    *)
      NUMBERS+=("$1")
      shift
      ;;
  esac
done

deadline=$(($(date +%s) + TIMEOUT_MINUTES * 60))
failures=0

# 1周につき gh を1回だけ呼ぶ。見張る本数が増えても呼び出し回数は増えない。
# チェックが1つでも走っていれば、そのPRはまだ決着していない。
jq_filter='
  .[]
  | select((.statusCheckRollup | length) > 0)
  | select([.statusCheckRollup[] | select(.status != "COMPLETED")] | length == 0)
  | . as $pr
  | ([$pr.statusCheckRollup[] | select(.conclusion != "SUCCESS" and .conclusion != "NEUTRAL" and .conclusion != "SKIPPED") | .name]) as $failed
  | if ($failed | length) == 0
    then "GREEN \($pr.number) \([$pr.labels[].name] | join(","))"
    else "RED \($pr.number) \($failed | join(","))"
    end
'

while [ "$(date +%s)" -lt "$deadline" ]; do
  if settled=$(gh pr list --state open --limit 50 \
    --json number,labels,statusCheckRollup --jq "$jq_filter" 2>/dev/null); then
    failures=0
    if [ ${#NUMBERS[@]} -gt 0 ]; then
      pattern=$(printf '%s\n' "${NUMBERS[@]}" | paste -sd'|' -)
      settled=$(grep -E "^(GREEN|RED) (${pattern}) " <<<"$settled")
    fi
    if [ -n "$settled" ]; then
      echo "$settled"
      exit 0
    fi
  else
    failures=$((failures + 1))
    if [ "$failures" -ge "$FAILURE_LIMIT" ]; then
      echo "ERROR gh pr list が ${FAILURE_LIMIT} 回続けて失敗した（認証切れか通信断）"
      exit 1
    fi
  fi
  sleep "$INTERVAL"
done

echo "TIMEOUT"
exit 3
