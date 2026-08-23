#!/usr/bin/env bash
# 指定した issue の変更が main に入るまで待ち、入った瞬間にその番号を出して終了する。
#
# 別セッションへ出したタスクの完了を待つために使う。エージェントはこれをバックグラウンドで
# 起動しておき、終了通知で1回だけ起きて次のタスクを投入する。待っている間モデルのターンは
# 消費されないので、間隔は詰めてよい。
#
#   bash .claude/wait-for-issues.sh 662 665
#   bash .claude/wait-for-issues.sh 662 --interval 5 --timeout-minutes 120
#
# **「issue が閉じたか」では早い。** タスクのセッションは PR を作った時点で issue を閉じるので、
# 閉じた直後の main にはまだ何も入っていない。その状態で次のタスクを投入すると、前のタスクの
# 変更が無い main を土台に作業を始めてしまう。そこで見るのは、その issue を閉じる PR が
# **マージされたか**。
#
# PR を伴わずに閉じた issue（取り下げなど）は検出できない。その場合は TIMEOUT になるので、
# 出力を見て人が判断する。
#
# 出力は次のいずれか1行。
#   DONE <番号>   … その issue を閉じる PR がマージされた
#   TIMEOUT       … 制限時間まで、どれもマージされなかった
#   ERROR <理由>  … gh が続けて失敗した

set -uo pipefail

INTERVAL=5
TIMEOUT_MINUTES=120
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

if [ ${#NUMBERS[@]} -eq 0 ]; then
  echo "usage: wait-for-issues.sh <issue番号>... [--interval 秒] [--timeout-minutes 分]" >&2
  exit 2
fi

deadline=$(($(date +%s) + TIMEOUT_MINUTES * 60))
failures=0

# 1周につき gh を1回だけ呼ぶ。監視対象が増えても呼び出し回数は増えない。
while [ "$(date +%s)" -lt "$deadline" ]; do
  if landed=$(gh pr list --state merged --limit 100 --json closingIssuesReferences \
    --jq '.[].closingIssuesReferences[].number' 2>/dev/null); then
    failures=0
    for number in "${NUMBERS[@]}"; do
      if grep -qx "$number" <<<"$landed"; then
        echo "DONE $number"
        exit 0
      fi
    done
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
