#!/usr/bin/env bash
# 開いているPRと、指定した issue を見張り、動きがあった時点でその一覧を出して終了する。
#
# **見張るのは司令塔の仕事で、PRを出したセッションの仕事ではない。** 各セッションに見張らせると、
# 自分を起こすための `send_later` と、その取り消しの `delete_trigger` を使うことになる。この2つは
# 自動承認できないので、そのままユーザーのタップに化ける。司令塔はシェルで待てる。
#
#   bash scripts/agent/watch-prs.sh                    # 開いている全PR
#   bash scripts/agent/watch-prs.sh 731 733            # PRの番号を指定
#   bash scripts/agent/watch-prs.sh --issues 732,759   # issue も見張る（下記）
#   bash scripts/agent/watch-prs.sh --interval 5 --timeout-minutes 60
#
# 出力は1行1件で、**終了コードで区別できる**。
#   GREEN   <番号> <ラベル>        … 全チェックが成功（ラベルが空なら素通しの候補）
#   RED     <番号> <落ちたチェック名>
#   CONFLICT <番号>                … mainと衝突していて、解消するまでマージできない（ラベル不問）
#   GONE    <番号>                 … 見張っていた issue が閉じた（--issues のときだけ）
#   FIXED   <番号>                 … 直し待ちのPRへ、新しいコミットが載った
#   COMMENT pr|issue <番号> <著者> … 起動より後に付いたコメント
#   TASK    <番号>                 … 着手できる open な task（--issues に無く、依存も片付いている）
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
# **`GONE` はもう1つ、終わったセッションを畳む合図でもある。** 「その issue が閉じた」は畳む条件の
# 1つ目そのものなので、投入した issue を全部渡しておけば、掃除の遅れが見張りの間隔まで縮む
# （`parallel-work.md` の「畳む引き金は GONE」）。
#
# ## --issues は「こちらが把握している task の全部」
#
# 渡した番号に無い open な `task` は `TASK` として出る。**待ちを終える条件は「動いているものが終わる
# こと」ではなく「やることが無いこと」**だから——投入した全部が `判断待ち` で止まると、前者では
# 何も起こらなくなり、その間にセッションが立てた issue も誰の目にも触れない。
#
# だから、**投入していないが意図して置いてある `task`**（判断待ちの範囲に含まれるもの）も
# `--issues` へ渡す。渡さないと毎周 `TASK` で起こされる。**出すか出さないかは機械が決め、拾うか
# どうかは受け取った側が決める。**
#
# ## 着手できるかは、印ではなく issue の依存から出す
#
# `TASK` に出るのは**`task` ラベルの付いた issue のうち、依存が片付いているものだけ**（GitHub の
# `blockedBy` に open なものが無い）。`task` が1件のセッションの仕事の単位なので、確認の置き場や
# ユーザーの答え待ちのように**投入する先が無い issue** は、依存が空でも仕事ではない。
# 「今着手してよいか」は実装の進み具合で**真偽が変わる述語**なので、ラベルのような印で持たせると
# 必ず古くなり、貼り直す仕事が永久に残る。「A は B の後」は変わらない事実なので、一度書けば
# 正しいままで、着手できるかは毎周そこから計算すればよい。`task` は**それが作業単位かどうか**
# という変わらない事実なので、印で持ってよい。
#
# 依存は `gh issue list --json blockedBy` が**一覧と同時に返す**ので、呼び出しは1周1回のままで、
# `state` も同梱されるため open 一覧との突き合わせも要らない。
#
# **依存で止まったまま何も出なくなることはない。** GitHub は循環する依存を 422 で拒む（実測）ので、
# 開いている issue の依存は必ず有向非巡回になる。**非巡回な有限のグラフには必ず根がある**ので、
# open な `task` が1件でもあれば、そのうち1件は必ず ready になる。TASK が空になるのは、open な
# `task` が全部 `--issues` に入っているときだけ。
#
# 依存に書いてよいのは**順序に理由がある依存だけ**。「同じファイルを触る」は依存ではない
# （`parallel-work.md` の「1ファイル重なることは、直列にする理由にはしない」）。
#
# 動きを受け取った側の動きは `.claude/parallel-work.md` の「PR の型」節。

set -uo pipefail

INTERVAL=5
TIMEOUT_MINUTES=60
FAILURE_LIMIT=20
NUMBERS=()
ISSUES=()
NO_CHECK_GRACE=90
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
    --no-check-grace)
      NO_CHECK_GRACE="$2"
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
# **決着していても出さないPRが2種類ある。** どちらも「既に誰かの手元にある」もので、出すと起こされた
# 側が同じ行を受け取り続けて回り続ける。コンフリクトとコメント（下）は別で、ラベルに関わらず見る。
#
# - `判断待ち` … ユーザーの手元。仮決めを含むので司令塔は触らない。
# - `直し待ち` … 書いたセッションの手元。司令塔が `send_message` で差し戻した状態。**緑のまま
#   放置すると毎周報告される**ので、差し戻したら必ず付ける（2026-08-25 に PR #771 で実際に空振りした）。
#
# **`直し待ち` は、新しいコミットが載った時点で `FIXED` を出す。** 黙らせたまま放っておくと、直しが
# 上がったことに誰も気づけない——2026-08-25 に PR #781 で実際にそうなり、直しが1時間半見過ごされた。
# ラベルを付けた時刻より後のコミットがあれば、それが「戻ってきた」の合図になる。
#
# **チェックが1つも登録されないPRは、放っておくと永久に報告されない。** CI（`tests.yml`）の `paths` は
# `src/` `tests/` `scripts/` などで、`docs/` や `.claude/` しか触らないPRでは1つも走らないため。
# 実測（2026-08-25）で、PR #766 が誰にも拾われないまま残った。落ち着くのを待ってから GREEN として
# 出す（`--no-check-grace` 秒、既定90）。まだ登録中なだけの場合と区別が付かないので、猶予を置く。
#
# **コンフリクトは、ラベルより先に見る。** ラベルが表すのは「今それが誰の手元にあるか」で、
# コンフリクトが表すのは「誰の手元にあろうと、解消するまで進めないこと」——この2つは直交するので、
# 前者で後者を隠さない。隠すと、`判断待ち` のPRは何も出ないまま埋もれ、ユーザーが「入れて」と
# 答えてもその場では入らない（2026-08-27 に PR #865 で実際にそうなった）。ラベルの無いPRは逆に、
# 緑として出て素通しのマージに失敗する。チェックの結果とも独立なので、CIより先に見る。
#
# **計算中（`mergeable: UNKNOWN`）は決着として扱わない。** GitHub はマージ可否を訊かれてから計算する
# ので、初回は `UNKNOWN` が返る（#865 で実測。引き直すと `CONFLICTING` に確定した）。問題なしと
# 読むと、コンフリクトしたPRが緑として出る。次の周で引き直せば済む。
pr_settled_filter() {
  # 第1引数はチェック無しPRの猶予の境目。
  printf '
    .[]
    | . as $pr
    | ([$pr.labels[].name]) as $names
    | if $pr.mergeable == "CONFLICTING" then "CONFLICT \($pr.number)"
      elif $pr.mergeable == "UNKNOWN" then empty
      elif ($names | index("直し待ち")) != null then "MENDING \($pr.number)"
      elif ($names | index("判断待ち")) != null then empty
      else
        ([$pr.statusCheckRollup[] | select(.status != "COMPLETED")] | length) as $running
        | if ($pr.statusCheckRollup | length) == 0
          then (if $pr.updatedAt < "%s" then "GREEN \($pr.number) \($names | join(","))" else empty end)
          elif $running > 0 then empty
          else
            ([$pr.statusCheckRollup[] | select(.conclusion != "SUCCESS" and .conclusion != "NEUTRAL" and .conclusion != "SKIPPED") | .name]) as $failed
            | if ($failed | length) == 0
              then "GREEN \($pr.number) \($names | join(","))"
              else "RED \($pr.number) \($failed | join(","))"
              end
          end
      end
  ' "$1"
}

# gh の --jq には --arg を渡せないので、時刻は文字列として埋め込む。
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
    --json number,labels,statusCheckRollup,comments,updatedAt,mergeable 2>/dev/null); then
    failures=0
    grace=$(date -u -d "-${NO_CHECK_GRACE} seconds" +%Y-%m-%dT%H:%M:%SZ)
    settled=$(jq -r "$(pr_settled_filter "$grace")" <<<"$prs")
    if [ ${#NUMBERS[@]} -gt 0 ]; then
      pattern=$(printf '%s\n' "${NUMBERS[@]}" | paste -sd'|' -)
      settled=$(grep -E "^(GREEN|RED|MENDING|CONFLICT) (${pattern})( |$)" <<<"$settled")
    fi
    # `直し待ち` のPRだけ、コミットの日付を追加で引く。**一覧の `--json` へ `commits` を足しては
    # いけない**——50本ぶんだとGraphQLのノード上限（50万）を超えて `gh` が丸ごと失敗し、**見張り全体が
    # 黙る**（2026-08-25 に実測）。1本ずつ引けば、払うのは差し戻し中のPRがあるときだけで済む。
    while read -r number; do
      [ -n "$number" ] || continue
      pushed=$(gh pr view "$number" --json commits --jq '.commits | last | .committedDate' 2>/dev/null)
      if [ -n "$pushed" ] && [[ "$pushed" > "$SINCE" ]]; then
        settled=$(printf '%s\nFIXED %s' "$settled" "$number")
      fi
    done < <(grep '^MENDING ' <<<"$settled" | awk '{print $2}')
    settled=$(grep -v '^MENDING ' <<<"$settled")

    settled=$(printf '%s\n%s' "$settled" "$(jq -r "$(comment_filter pr)" <<<"$prs")")

    # 見張っている issue を1回引いて、閉じたもの（開いている一覧に居ないもの）と、起動より後に
    # 付いたコメントを拾う。issue の本数が増えても gh の呼び出しは1周につき1回のまま。
    if [ ${#ISSUES[@]} -gt 0 ]; then
      if open_issues=$(gh issue list --state open --limit 100 --json number,labels,comments,blockedBy 2>/dev/null); then
        numbers=$(jq -r '.[].number' <<<"$open_issues")
        for issue in "${ISSUES[@]}"; do
          if ! grep -qx "$issue" <<<"$numbers"; then
            settled=$(printf '%s\nGONE %s' "$settled" "$issue")
          fi
        done
        watched=$(printf '%s\n' "${ISSUES[@]}" | paste -sd'|' -)
        settled=$(printf '%s\n%s' "$settled" \
          "$(jq -r "$(comment_filter issue)" <<<"$open_issues" | grep -E "^COMMENT issue (${watched}) " || true)")
        # 渡された番号に無く、依存も片付いている `task` は、今すぐ着手できる仕事。**待ちを終える
        # 条件は「動いているものが終わること」ではなく「やることが無いこと」**なので、これを出す。
        # 依存が残っているものを出さないのは、投入しても着手できないから——出すと受け取った側が
        # 毎周同じ番号を突き返すことになる。`task` の無い issue（確認の置き場・答え待ち）は、
        # 依存が空でも投入する先が無いので出さない。
        ready=$(jq -r '.[]
            | select([.labels[].name] | index("task"))
            | select([.blockedBy.nodes[] | select(.state == "OPEN")] | length == 0)
            | .number' \
          <<<"$open_issues")
        for issue in $ready; do
          if ! grep -qxE "$watched" <<<"$issue"; then
            settled=$(printf '%s\nTASK %s' "$settled" "$issue")
          fi
        done
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
