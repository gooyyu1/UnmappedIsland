#!/usr/bin/env bash
# 司令塔の盤面を1回で出す。**開いているPR・開いている task issue・畳んでいないセッション**の3つを、
# 突き合わせた形で並べる。
#
#   bash scripts/agent/board.sh
#
# ## 往復を減らすためだけの道具ではない
#
# 手で引くと `gh pr list` と `gh issue list` の2回で済むので、つい**依存を引き忘れる**。
# `blockedBy` は issue 1件につき1回の `gh api` が要るぶん省かれやすく、**塞いでいた issue が閉じても
# 誰も気づかない**——着手できるようになった仕事が、次に誰かが思い出すまで止まる。ここでは必ず引く。
#
# 同じ理由で、issue に**もう投入済みか**も出す。判断材料が1つの表に載っていないと、二重に投入する
# （2つのセッションが同じ issue で別々のPRを出す）。
#
# 出るのは4つの節。
#
#   ## PR      <番号> <CI> <マージ可否> <ラベル> <題>
#   ## TASK    <番号> <着手できるか> <題>
#   ## 未整理  <番号> <ラベル> <題>
#   ## 走行    <セッションID> <状態> <最終更新> <題>
#
# `TASK` の状態は次のどれか。
#   投入済み   … 走行中のセッションか、開いているPRの `Closes` に載っている
#   待ち:#N    … `blockedBy` の #N がまだ開いている
#   着手可     … どちらでもない＝今すぐ投入してよい
#
# ## `未整理` は、人間が書いたまま投入できない issue
#
# ユーザーが立てる issue は自分の言葉で書かれていて、担当も完了条件も無い。**そのまま `task` を
# 付けて投入すると、PRの範囲が宣言されていない**ので、司令塔は差分を見ても範囲外へ伸びたかを
# 判定できず、全部が判断待ちに落ちる。**投入の前に棚卸しで翻訳する**
# （[`parallel-work.md`](../../.claude/parallel-work.md)「人間が立てた issue は、投入する前に
# 棚卸しで task へ翻訳する」）。
#
# ここに出るのは `task` も `meta` も付いていない open な issue。`meta` は常設の盤（#656 の確定待ち・
# #732 の現在地）で、投入する先が無いので棚卸しの対象でもない。**どれが翻訳の要る issue かは
# 判定しない**——並べるところまでが機械の仕事で、まとめ方も分け方もモデルが決める。

set -euo pipefail

REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CCR_META="$HERE/../../.claude/ccr-meta.sh"

prs=$(gh pr list --state open --limit 50 --json number,title,labels,statusCheckRollup,mergeable,body)

echo "## PR"
jq -r '
  .[]
  | . as $pr
  | (if ($pr.statusCheckRollup | length) == 0 then "チェック無"
     elif ([$pr.statusCheckRollup[] | select(.status != "COMPLETED")] | length) > 0 then "実行中"
     elif ([$pr.statusCheckRollup[]
            | select(.conclusion != "SUCCESS" and .conclusion != "NEUTRAL" and .conclusion != "SKIPPED")]
           | length) > 0 then "赤"
     else "緑" end) as $ci
  | ([$pr.labels[].name] | join(",")) as $labels
  | "PR \($pr.number) \($ci) \($pr.mergeable) \(if $labels == "" then "-" else $labels end) \($pr.title)"
' <<<"$prs"

# 走行中（畳んでいない）セッション。ここが「もう投入したか」の主な根拠。
#
# **上限に当たったら黙らない。** 一覧は新しい順なので、切れるのは古い側——畳み忘れて残っている
# セッションはまさにそこに居る。出ないことを「無い」と読むと、永久に畳まれない。
SESSION_LIMIT=100
sessions=$(printf '{"mine":true,"limit":%s}' "$SESSION_LIMIT" |
  bash "$CCR_META" list_sessions 2>/dev/null | grep -o '{"ccr".*' || true)
if [ -z "$sessions" ]; then
  echo "（セッションの一覧を引けなかった。投入済みの判定はPRだけで行う）" >&2
  sessions='{"ccr":{"data":[]}}'
fi
if [ "$(jq -r '.ccr.data | length' <<<"$sessions")" = "$SESSION_LIMIT" ]; then
  echo "（一覧が上限 $SESSION_LIMIT に当たった。これより古いセッションは見えていない）" >&2
fi
live=$(jq -r '.ccr.data[] | select(.session_status != "SESSION_STATUS_ARCHIVED")
              | "\(.id)\t\(.session_status | sub("SESSION_STATUS_"; ""))\t\(.updated_at)\t\(.title // "")"' <<<"$sessions")

# 投入済みの印になる issue 番号。**走行中セッションの題の `(#N)` と、開いているPRの `Closes #N`。**
dispatched=$( {
  grep -oE '\(#[0-9]+\)' <<<"$live" | grep -oE '[0-9]+' || true
  jq -r '.[].body // ""' <<<"$prs" | grep -oiE 'closes[[:space:]]+#[0-9]+' | grep -oE '[0-9]+' || true
} | sort -u)

# issue は1回だけ引いて、`task` の付いたものと、まだどこにも分類されていないものへ分ける。
issues=$(gh issue list --state open --limit 100 --json number,title,labels)

echo "## TASK"
while read -r number title; do
  [ -n "$number" ] || continue
  if grep -qx "$number" <<<"$dispatched"; then
    state='投入済み'
  else
    # 依存は issue 1件につき1回。task は同時に数件なので、ここは払ってよい。
    open_blocker=$(gh api "repos/$REPO/issues/$number/dependencies/blocked_by" \
      --jq '.[] | select(.state == "open") | .number' 2>/dev/null | head -1 || true)
    state=$([ -n "$open_blocker" ] && echo "待ち:#$open_blocker" || echo '着手可')
  fi
  echo "TASK $number $state $title"
done < <(jq -r '.[] | select([.labels[].name] | index("task")) | "\(.number) \(.title)"' <<<"$issues" | tr -d '\r')

echo "## 未整理"
jq -r '.[]
       | select([.labels[].name] | index("task") == null and index("meta") == null)
       | "未整理 \(.number) \(if (.labels | length) == 0 then "-" else ([.labels[].name] | join(",")) end) \(.title)"' \
  <<<"$issues" | tr -d '\r' | grep . || echo "（無し）"

echo "## 走行"
[ -n "$live" ] && awk -F'\t' '{print "走行 " $1 " " $2 " " $3 " " $4}' <<<"$live" || echo "（無し）"
