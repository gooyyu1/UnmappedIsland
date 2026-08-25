#!/usr/bin/env bash
# 開いているPRと、指定した issue を見張り、動きがあった時点でその一覧を出して終了する。
#
# **見張るのは司令塔の仕事で、PRを出したセッションの仕事ではない。** 各セッションに見張らせると、
# 自分を起こすための `send_later` と、その取り消しの `delete_trigger` を使うことになる。この2つは
# 自動承認できないので、そのままユーザーのタップに化ける。司令塔はシェルで待てる。
#
#   bash .claude/watch-prs.sh                           # 開いている全PR
#   bash .claude/watch-prs.sh 731 733                   # PRの番号を指定
#   bash .claude/watch-prs.sh --issues 732,759          # issue も見張る（下記）
#   bash .claude/watch-prs.sh --interval 5 --timeout-minutes 60
#
# 出力は1行1件で、**終了コードで区別できる**。
#   GREEN   <番号> <ラベル>        … 全チェックが成功（ラベルが空なら素通しの候補）
#   RED     <番号> <落ちたチェック名>
#   GONE    <番号>                 … 見張っていた issue が閉じた（--issues のときだけ）
#   COMMENT pr|issue <番号> <著者> … 起動より後に付いたコメント
#   終了コード 0 … 動きが1件以上ある（上の行が出ている）
#   終了コード 3 … TIMEOUT（制限時間まで、何も動かなかった）
#   終了コード 1 … ERROR（gh が続けて失敗した）
#
# ## COMMENT を見るのは、却下を受け取る唯一の経路だから
#
# **PRの作者はすべてユーザー自身になる**（セッションがユーザーの資格情報で push するため）ので、
# GitHubは Approve も Request changes も出させない。**仮決めを却下する手段はコメントしか無い。**
# 承認はマージがそのまま答えになるので、見張るのは却下の側だけでよい。
#
# `判断待ち` の付いたPRも**コメントだけは見る**。ラベルは「ユーザーの手元にある」という意味なので
# CIの決着は出さないが、そこへコメントが付いたということは手元から戻ってきたということ。
#
# **自分（司令塔）が書いたコメントでも起きる。** 著者で区別できない——セッションも司令塔もユーザーの
# 資格情報で書くため。著者と番号は出すので、受け取った側が見て、自分のものなら見張り直す。
#
# ## --issues を付けるのは、PRが出ないまま終わる場合があるから
#
# この見張りの本体はPRなので、投入した先が「閉じた issue だった」「セッションが落ちた」といった
# 理由でPRを作らないと、**何も届かないままタイムアウトまで空待ちになる**（2026-08-25 に実測。
# 却下されて閉じた issue へその16分後にセッションを立て、120分の空待ちに入りかけた）。投入した
# issue の番号を渡しておけば、それが閉じた時点で `GONE` が出る——マージで閉じたのか、始めから
# 閉じていたのかは、受け取った側が見る。
#
# **司令塔の現在地の issue（#732）も渡す。** ユーザーはPRではなくそちらへ書くことがあり、どちらに
# 書いても届くようにしておくのが、いちばん手数が少ない。
#
# 動きを受け取った側の動きは `.claude/parallel-work.md` の「PR の型」節。

set -uo pipefail

INTERVAL=5
TIMEOUT_MINUTES=60
FAILURE_LIMIT=20
NUMBERS=()
ISSUES=()
SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ)

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
    --issues)
      IFS=', ' read -r -a ISSUES <<<"$2"
      shift 2
      ;;
    --since)
      SINCE="$2"
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
#
# `判断待ち` の付いたPRは既に振り分けが済んでユーザーの手元にあるので、決着していても出さない。
# 出すと、起こされた側が同じ行を受け取り続けて回り続ける。コメントの側（下）は別で、ラベルに
# 関わらず見る。
pr_settled_filter='
  .[]
  | select(([.labels[].name] | index("判断待ち")) == null)
  | select((.statusCheckRollup | length) > 0)
  | select([.statusCheckRollup[] | select(.status != "COMPLETED")] | length == 0)
  | . as $pr
  | ([$pr.statusCheckRollup[] | select(.conclusion != "SUCCESS" and .conclusion != "NEUTRAL" and .conclusion != "SKIPPED") | .name]) as $failed
  | if ($failed | length) == 0
    then "GREEN \($pr.number) \([$pr.labels[].name] | join(","))"
    else "RED \($pr.number) \($failed | join(","))"
    end
'

# gh の --jq には --arg を渡せないので、起動時刻は文字列として埋め込む。
comment_filter() {
  printf '
    .[]
    | . as $item
    | $item.comments[]
    | select(.createdAt > "%s")
    | "COMMENT %s \($item.number) \(.author.login)"
  ' "$SINCE" "$1"
}

while [ "$(date +%s)" -lt "$deadline" ]; do
  if prs=$(gh pr list --state open --limit 50 \
    --json number,labels,statusCheckRollup,comments 2>/dev/null); then
    failures=0
    settled=$(jq -r "$pr_settled_filter" <<<"$prs")
    if [ ${#NUMBERS[@]} -gt 0 ]; then
      pattern=$(printf '%s\n' "${NUMBERS[@]}" | paste -sd'|' -)
      settled=$(grep -E "^(GREEN|RED) (${pattern}) " <<<"$settled")
    fi
    settled=$(printf '%s\n%s' "$settled" "$(jq -r "$(comment_filter pr)" <<<"$prs")")

    # 見張っている issue を1回引いて、閉じたもの（開いている一覧に居ないもの）と、起動より後に
    # 付いたコメントを拾う。issue の本数が増えても gh の呼び出しは1周につき1回のまま。
    if [ ${#ISSUES[@]} -gt 0 ]; then
      if open_issues=$(gh issue list --state open --limit 100 --json number,comments 2>/dev/null); then
        numbers=$(jq -r '.[].number' <<<"$open_issues")
        for issue in "${ISSUES[@]}"; do
          if ! grep -qx "$issue" <<<"$numbers"; then
            settled=$(printf '%s\nGONE %s' "$settled" "$issue")
          fi
        done
        watched=$(printf '%s\n' "${ISSUES[@]}" | paste -sd'|' -)
        settled=$(printf '%s\n%s' "$settled" \
          "$(jq -r "$(comment_filter issue)" <<<"$open_issues" | grep -E "^COMMENT issue (${watched}) " || true)")
      fi
    fi

    if [ -n "${settled//[[:space:]]/}" ]; then
      grep -v '^[[:space:]]*$' <<<"$settled"
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
