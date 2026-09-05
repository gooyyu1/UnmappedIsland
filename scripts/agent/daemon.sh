#!/usr/bin/env bash
# 司令塔の機械の部分を回し続ける。**盤面を引き、手を1つ打ち、待つ。**
#
#   bash scripts/agent/daemon.sh start        # 背景で立てる（ログは $DAEMON_LOG へ追記）
#   bash scripts/agent/daemon.sh stop         # 止める（錠が外れるまで待つ）
#   bash scripts/agent/daemon.sh restart      # 版を入れ替えたとき
#   bash scripts/agent/daemon.sh status       # 生きているかだけを見る（生きていれば0）
#   bash scripts/agent/daemon.sh run          # 前に出たまま回す
#   INTERVAL=300 bash scripts/agent/daemon.sh run
#   ONCE=1 bash scripts/agent/daemon.sh run              # 1周だけ回して終わる
#   DRY_RUN=1 ONCE=1 bash scripts/agent/daemon.sh run    # 手を並べるだけで、打たない
#
# 出力は1行1件で、頭に時刻が付く。**そのまま追記のログとして読める**。`run` は前に出したまま流し、
# `start` は `$DAEMON_LOG`（既定 `~/daemon.log`）へ追記する。
#
# ## 止めるのも自分の仕事
#
# **呼び手にプロセスを探させない。** 錠へ自分のPIDを置き、`stop` はそれを撃って錠が外れるまで待つ
# （`CLAUDE.md`「自分のことは自分でする」）。`ps` で名前から絞る手順を呼び手へ書かせると、**関係の
# 無い bash まで巻き込む**——ブリッジの MSYS2 には `pgrep` が無いので、絞り込みは行の切り出しになる。
#
# **寝ている間も撃たれたらすぐ止まる。** `sleep` を前に置くと、bash は前の子が終わるまで signal を
# 握ったままなので、`INTERVAL` ぶん（既定3分）止まらない。背景で寝て `wait` で待つ。
#
# ## 二重に起こさない・生死は心拍で見る
#
# **起こす側に「もう走っているか」を確かめさせない。** 起動のたびに `$STATE_DIR/lock` を `mkdir` で
# 取り、取れなければ何もせずに終わる（`mkdir` は作れるかどうかが不可分なので、`[ -d ]` で見てから
# 作るのと違って隙が無い）。**`start` を何度打っても1本のまま**なので、呼び手は条件を書かなくてよい。
#
# 生きているかは、周ごとに書く**心拍**（`lock/heartbeat`）で見る。プロセスの一覧で見ないのは、
# **ブリッジの bash（MSYS2）に `pgrep` が無い**ため——無い道具で見ると、生きていても
# 「止まっている」と答え続ける。落ちた跡の錠は、心拍が `INTERVAL` の3周ぶん途切れていたら取り上げる。
#
# ## 決めるのはここではない
#
# 盤面から手を決めるのは [`board-move.mjs`](board-move.mjs)。ここがやるのは**引くことと打つこと**
# だけで、判定を1つも持たない。分けているのは、判定だけを実物抜きで検査できるようにするため
# （[`board-design.md`](../../.claude/board-design.md) 2.3）。
#
# 打つのは**1周に1手**。マージが1本入れば他のPRのコンフリクトや `blockedBy` が動くので、盤面は
# 打つたびに変わる。**同じ周に2手目を打つと、変わる前の盤面で決めた手を打つことになる。**
#
# ## 判断が要るものは、ここには無い
#
# 人間の手が要るもの（`判断待ち`・`収束せず` のPR・確定待ちの項目・棚卸しの済んでいない issue）は、
# **黙って止まっているのが正しい。** ラベルと issue に残り続けるので、[`board.sh`](board.sh) で
# いつでも見える。デーモンが拾って人へ届ける口は、まだ無い（`board-design.md` 3.3 の未決）。
#
# ## 引けなかったら、その周は何もしない
#
# `gh` が失敗した周は盤面が欠けているので、**欠けたまま手を決めない**（消えたPRを「無い」と読むと、
# レビューを二重に立てる）。続けて `FAILURE_LIMIT` 回失敗したら止まる——認証切れや通信断で
# 回り続けても、ログが埋まるだけ。

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INTERVAL="${INTERVAL:-30}"
FAILURE_LIMIT="${FAILURE_LIMIT:-5}"
STATE_DIR="${BOARD_STATE:-$HOME/.claude/board-state}"
LEDGER="$STATE_DIR/taken.json"
# チェックが1本も登録されないPRを緑と読むまでの猶予。登録の途中と見分けが付かないので待つ。
SETTLE_MINUTES="${SETTLE_MINUTES:-10}"

DAEMON_LOG="${DAEMON_LOG:-$HOME/daemon.log}"
# `stop` が、撃った相手の錠が外れるのを待つ上限。周の途中で受けたぶんは、その周を終えてから止まる。
STOP_WAIT="${STOP_WAIT:-90}"
# `start` が、立てた相手の心拍を待つ上限。
START_WAIT="${START_WAIT:-30}"

LOCK="$STATE_DIR/lock"
# **心拍は錠の外。** 中に置くと `stop` が錠ごと消してしまい、止めた後の `status` が「一度も起きて
# いない」と答える。最後にいつ回っていたかは、止めた後こそ知りたい。
HEARTBEAT="$STATE_DIR/heartbeat"
# **PIDは錠の中。** 撃つ相手は錠を持っている者そのものなので、寿命が同じでないと嘘になる。
PIDFILE="$LOCK/pid"
# 1周が掛かってよい上限。心拍は周の頭にしか書かないので、**時間の掛かる手（マージ）の最中に錠を
# 取り上げられない**だけの幅が要る。**`INTERVAL` の倍数では表さない**——待つ間隔を詰めると、周に
# 許す時間まで一緒に縮んでしまう。この2つは別のことを測っている。
ROUND_LIMIT="${ROUND_LIMIT:-600}"
# 心拍が途切れてから、落ちたと見なすまで。寝ている間は書かないので、1周ぶんの寝と足す。
STALE_SECONDS=$((INTERVAL + ROUND_LIMIT))

mkdir -p "$STATE_DIR"
[ -f "$LEDGER" ] || echo '{}' >"$LEDGER"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1"; }

# 心拍が新しければ0。**`status` と錠の取り上げが同じ判定を使う**ので、片方だけずれない。
beating() {
  [ -f "$HEARTBEAT" ] || return 1
  local beat now
  beat=$(date -u -d "$(cat "$HEARTBEAT")" +%s 2>/dev/null) || return 1
  now=$(date -u +%s)
  [ $((now - beat)) -lt "$STALE_SECONDS" ]
}

# 走っているか。**錠と心拍の両方を見る**——心拍は錠の外にあるので、綺麗に止めた直後もしばらく
# 新しいままで、心拍だけでは「止めた」と「動いている」が同じに見える。
running() { [ -d "$LOCK" ] && beating; }

report() {
  if running; then
    echo "生きている（最終 $(cat "$HEARTBEAT")）"
    return 0
  fi
  if [ -f "$HEARTBEAT" ]; then
    echo "止まっている（最終 $(cat "$HEARTBEAT")）"
  else
    echo "一度も起きていない"
  fi
  return 1
}

# 撃って、錠が外れるまで待つ。**相手のPIDは錠の中にある**ので、呼び手は探さない。
stop_daemon() {
  if [ ! -d "$LOCK" ]; then
    echo "走っていない"
    return 0
  fi
  local pid='' waited=0
  [ ! -f "$PIDFILE" ] || pid=$(cat "$PIDFILE")
  # 撃つ相手が居ないのに待っても、錠は永久に外れない。**落ちた跡はここで片付ける**——次の `start`
  # まで残すと、心拍が腐るまでの間だけ「走っている」と答え続ける。
  if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
    rm -rf "$LOCK"
    echo "落ちた跡の錠を外した"
    return 0
  fi
  kill "$pid" 2>/dev/null || true
  while [ -d "$LOCK" ] && [ "$waited" -lt "$STOP_WAIT" ]; do
    sleep 1
    waited=$((waited + 1))
  done
  if [ -d "$LOCK" ]; then
    echo "${STOP_WAIT}秒待っても止まらなかった（$pid）" >&2
    return 1
  fi
  echo "止めた（$pid）"
}

# 背景で立てて、心拍が出るまで待つ。**立ったことを確かめてから返す**ので、呼び手は待たない。
start_daemon() {
  if running; then
    echo "既に走っている（最終 $(cat "$HEARTBEAT")）"
    return 0
  fi
  local waited=0
  nohup bash "$HERE/daemon.sh" run >>"$DAEMON_LOG" 2>&1 &
  while [ "$waited" -lt "$START_WAIT" ]; do
    if running; then
      echo "立てた（ログは $DAEMON_LOG）"
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  echo "${START_WAIT}秒待っても心拍が出なかった（$DAEMON_LOG を見る）" >&2
  return 1
}

case "${1:-}" in
run) ;;
status)
  if report; then exit 0; fi
  exit 1
  ;;
stop)
  stop_daemon
  exit
  ;;
start)
  start_daemon
  exit
  ;;
restart)
  stop_daemon
  start_daemon
  exit
  ;;
*)
  echo "使い方: bash ${BASH_SOURCE[0]} run|start|stop|restart|status" >&2
  exit 1
  ;;
esac

if ! mkdir "$LOCK" 2>/dev/null; then
  if beating; then
    log "既に走っているので、二本目は立てない（最終 $(cat "$HEARTBEAT")）"
    exit 0
  fi
  log "落ちた跡の錠を取り上げる（最終 $(cat "$HEARTBEAT" 2>/dev/null || echo 不明)）"
  rm -rf "$LOCK"
  mkdir "$LOCK" || {
    log "錠を取れなかった"
    exit 1
  }
fi

# **撃つ相手を、錠の中に置いていく**（上の「止めるのも自分の仕事」）。錠と同じ寿命にしてあるので、
# 消し忘れが残らない。
echo $$ >"$PIDFILE"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK" "$LOCK"' EXIT

# 打った手を、そのとき盤面がどう見えていたか（指紋）とともに残す。**指紋が変わるまで同じ手は
# 出ない**（`board-move.mjs`）。過去の記録なので、死んでも嘘にならない（1.1）。
remember() {
  jq --arg k "$1" --arg v "$2" '.[$k] = $v' "$LEDGER" >"$WORK/ledger.json" &&
    mv "$WORK/ledger.json" "$LEDGER"
}

gather() {
  gh pr list --state open --limit 50 \
    --json number,isDraft,labels,mergeable,statusCheckRollup,updatedAt,headRefOid,baseRefName,body,files \
    >"$WORK/prs.json" || return 1
  gh issue list --state open --limit 100 --json number,labels,blockedBy \
    >"$WORK/issues.json" || return 1

  # `main` の先頭のCI。**赤い間は差し戻しを打たない**（`board-move.mjs`、`board-design.md` 2.14）。
  # 語彙をPRの `statusCheckRollup` に合わせて渡すので、向こうは1つの判定で両方を読める。
  gh api 'repos/{owner}/{repo}/commits/main/check-runs' \
    --jq '[.check_runs[] | {
      status: (.status | ascii_upcase),
      conclusion: ((.conclusion // "") | ascii_upcase)
    }]' >"$WORK/main-checks.json" || return 1

  # 差し戻す相手は、そのPRのコミットの `Claude-Session:` トレーラで引く（2.11）。**上の一覧には
  # 混ぜられない**——`gh pr list --json commits` はPRごとに全コミットを取りに行き、GraphQL の
  # ノード数の上限（50万）を超えて何も返らなくなる。末尾の何本かだけを指名すれば1回で足りる。
  #
  # **拾うのは、トレーラを持つ最後のコミット。** 手が変われば新しいほうが今の書き手。
  #
  # **引けなかった周は空にして進む。** 差し戻す相手が分からないだけで、他の手は打てる
  # （`board-move.mjs` が覚え書きを出す）。
  gh api graphql \
    -f query='query($owner:String!,$name:String!){repository(owner:$owner,name:$name){pullRequests(states:OPEN,first:50){nodes{number commits(last:20){nodes{commit{message}}}}}}}' \
    -F owner='{owner}' -F name='{repo}' \
    --jq '.data.repository.pullRequests.nodes[] | .number as $n
      | ([.commits.nodes[].commit.message | split("\n")[]
        | select(startswith("Claude-Session:")) | split("/") | last] | last) as $id
      | select($id != null) | "\($n)\t\($id)"' \
    >"$WORK/pr-sessions.tsv" 2>/dev/null || {
    : >"$WORK/pr-sessions.tsv"
    # **黙って空にしない。** 空は「名乗っていない」と同じ形なので、この周の覚え書きは名乗り忘れと
    # 見分けが付かない。ログに並べておけば、人が読むときに取り違えない。
    log "差し戻す相手を引けなかった（この周の「名乗っていない」は当てにならない）"
  }
  # **列がずれていたら、その周ごと捨てる**（下の `error`）。デーモンは動き出したときの
  # [`daemon.sh`](daemon.sh) を握ったまま回るので、**走っている最中に
  # [`live-sessions.sh`](live-sessions.sh) の列を足すと、こちらだけが古いまま噛み合う。**
  # 黙って読み違えると `tags` が空になり、**占有が全部「無い」に見えて投入が止まらない**
  # ——2026-09-05 に、書くセッションが6本立った。**引けなかったのと同じ扱い**にすれば、止まる側へ
  # 倒れる（`FAILURE_LIMIT` 周でデーモンごと落ちるので、気づける）。
  CCR_META="${CCR_META:-$HERE/../../.claude/ccr-meta.sh}" bash "$HERE/live-sessions.sh" \
    >"$WORK/live.tsv" || return 1

  # ワーカーを畳んでよいかは、担当の issue が閉じたかで決まる（2.10）。**探すのはセッションの側から**
  # ——閉じた issue の一覧は増える一方で、畳む相手はそこには居ない。開いている一覧に載っている
  # ぶんは引かないので、打つのは**行き先が消えたタグの数**だけ（普通は0）。
  #
  # 引けなかったものは書かない。**知らないことを「閉じた」として読まない**——畳んだ判定は戻せる
  # とはいえ、次の周にもう一度引ける。
  : >"$WORK/issue-states.tsv"
  while IFS= read -r number; do
    [ -n "$number" ] || continue
    if jq -e --argjson n "$number" 'any(.[]; .number == $n)' "$WORK/issues.json" >/dev/null; then
      continue
    fi
    state=$(gh issue view "$number" --json state --jq '.state' 2>/dev/null) || continue
    printf '%s\t%s\n' "$number" "$state" >>"$WORK/issue-states.tsv"
  done < <(cut -f4 "$WORK/live.tsv" | tr -d '\r' | tr ',' '\n' |
    sed -n 's/^task-\([0-9][0-9]*\)$/\1/p' | sort -u)

  jq -n --slurpfile prs "$WORK/prs.json" --slurpfile issues "$WORK/issues.json" \
    --slurpfile taken "$LEDGER" --rawfile live "$WORK/live.tsv" \
    --rawfile states "$WORK/issue-states.tsv" \
    --rawfile prsessions "$WORK/pr-sessions.tsv" \
    --slurpfile mainchecks "$WORK/main-checks.json" \
    --arg settled "$(date -u -d "-$SETTLE_MINUTES minutes" +%Y-%m-%dT%H:%M:%SZ)" '{
      settledBefore: $settled,
      mainChecks: $mainchecks[0],
      prs: $prs[0],
      issues: $issues[0],
      taken: $taken[0],
      issueStates: ($states | gsub("\r"; "") | split("\n") | map(select(length > 0))
        | map(split("\t") | {key: .[0], value: .[1]}) | from_entries),
      prSessions: ($prsessions | gsub("\r"; "") | split("\n") | map(select(length > 0))
        | map(split("\t") | {key: .[0], value: .[1]}) | from_entries),
      sessions: ($live | gsub("\r"; "") | split("\n") | map(select(length > 0))
        | map(split("\t")
          | if length != 4 then error("live-sessions.sh の列数が合わない") else . end
          | {
            id: .[0],
            status: .[1],
            bucket: .[2],
            tags: (.[3] | split(",") | map(select(length > 0)))
          }))
    }' >"$WORK/board.json" || return 1

  # 消えたPR・畳まれたセッションの記録は捨てる。残すと、番号が回り込んだときに古い指紋が効く。
  #
  # **`.key` を先に束縛する。** `$ids | index(.key[7:])` と書くと `.` が配列に変わった後で `.key` を
  # 読むことになり、台帳が空でなくなった最初の周から毎回落ちる。
  jq -s '.[0] as $taken | .[1] as $board
    | ($board.sessions | map(.id)) as $ids
    | ($board.prs | map(.number | tostring)) as $numbers
    | $taken | with_entries(. as $entry | select(
        (($entry.key | startswith("resume:")) and ($ids | index($entry.key[7:]) != null))
        or (($entry.key | startswith("review:")) and ($numbers | index($entry.key[7:]) != null))
        or (($entry.key | startswith("archive:")) and ($ids | index($entry.key[8:]) != null))
      ))' "$LEDGER" "$WORK/board.json" >"$WORK/pruned.json" && mv "$WORK/pruned.json" "$LEDGER"
}

# 1手打つ。打てたら0、打たなかったら非0（呼び手は次の手へ進む）。
play() {
  local kind="$1" a="${2:-}" b="${3:-}" c="${4:-}" rc=0 out=''
  case "$kind" in
  MERGE)
    # 終了コード2は「マージはできたが後始末が残った」。手は打てているので、次の周は別の手へ進む。
    bash "$HERE/merge-and-close.sh" "$a" || rc=$?
    [ "$rc" = 0 ] || [ "$rc" = 2 ] || return 1
    ;;
  RESUME)
    bash "$HERE/resume-session.sh" "$a" "$b" "$c" || return 1
    remember "resume:$a" "$5"
    ;;
  REVIEW)
    bash "$HERE/dispatch-review.sh" "$a" || return 1
    remember "review:$a" "$b"
    ;;
  ARCHIVE)
    # 畳んでよいかの判定は [`archive-session.sh`](archive-session.sh) が持つ。**終了コードは見ない**
    # ——あちらは1件ずつの結果を行で返す。`--keep-untagged task-` は、ここへ来る相手が必ずワーカーで
    # あること（盤面の側の約束）を、畳む手前でもう一度確かめるため。
    out=$(printf '%s\n' "$a" | bash "$HERE/archive-session.sh" --keep-untagged task-) || return 1
    printf '%s\n' "$out"
    if grep -q "^ARCHIVED $a\$" <<<"$out"; then return 0; fi
    # `KEPT` は「畳んではいけない」という**安定した答え**（ブリッジのもの・素性を引けなかったもの）。
    # 指紋を残さないと、**1周1手のうちの1手がこれで埋まり続ける。** `UNARCHIVED` は失敗なので残さず、
    # 次の周にもう一度試す。
    if grep -q "^KEPT $a\$" <<<"$out"; then remember "archive:$a" "$b"; fi
    return 1
    ;;
  TASK)
    # **補足は無い。** 書けるのはモデルだけで、デーモンには書くものが無い——issue 本文が全部を持つ
    # （`dispatch-task.sh`「重なりが無くて書くことが無いなら、空のファイルでよい」）。
    : >"$WORK/supplement.md"
    bash "$HERE/dispatch-task.sh" "$a" "$WORK/supplement.md" || return 1
    ;;
  *)
    log "知らない手なので打たない: $kind $a $b $c"
    return 1
    ;;
  esac
}

round() {
  bash "$HERE/usage-record.sh" >"$WORK/spent.tsv" || log "使用量を引けなかった"
  while IFS= read -r spent; do
    if [ -n "$spent" ]; then log "消費 $spent"; fi
  done <"$WORK/spent.tsv"

  gather || return 1
  node "$HERE/board-move.mjs" <"$WORK/board.json" >"$WORK/moves.txt"

  grep '^NOTE ' "$WORK/moves.txt" | sed 's/^NOTE /覚え書き: /' | while IFS= read -r note; do
    log "$note"
  done

  if [ -n "${DRY_RUN:-}" ]; then
    grep -v '^NOTE ' "$WORK/moves.txt" | while IFS= read -r move; do log "打たない手: $move"; done
    return 0
  fi

  # 上から順に、**打てた最初の1手**で切り上げる。打てなかった手（手綱で止まっている・相手が
  # 動き出した）で周ごと止めると、止まっている種類と関係のない手まで巻き添えになる。
  while read -r kind a b c d; do
    if [ "$kind" = NOTE ]; then continue; fi
    log "打つ: $kind $a $b $c"
    if play "$kind" "$a" "$b" "$c" "$d"; then
      log "打てた: $kind $a"
      return 0
    fi
    log "打てなかった: $kind $a"
  done <"$WORK/moves.txt"
  return 0
}

# `stop` に撃たれたら、寝ていても待たずに畳む。**周の途中で受けたぶんは、その周を終えてから**
# ——1手の途中で消えると、打った跡と台帳が食い違う。
stopping=''
napping=''
trap 'stopping=1; [ -z "$napping" ] || kill "$napping" 2>/dev/null || true' TERM INT

failures=0
while true; do
  date -u +%Y-%m-%dT%H:%M:%SZ >"$HEARTBEAT"
  if round; then
    failures=0
  else
    failures=$((failures + 1))
    log "盤面を引けなかった（${failures}回目）"
    [ "$failures" -lt "$FAILURE_LIMIT" ] || {
      log "${FAILURE_LIMIT}回続けて失敗したので止まる（認証切れか通信断）"
      exit 1
    }
  fi
  [ -z "${ONCE:-}" ] || break
  [ -z "$stopping" ] || break
  # **背景で寝る。** 前に置くと、bash は前の子が終わるまで signal を握るので、撃たれても
  # `INTERVAL` ぶん止まらない。
  sleep "$INTERVAL" &
  napping=$!
  wait "$napping" || true
  napping=''
  [ -z "$stopping" ] || break
done
[ -z "$stopping" ] || log "止めろと言われたので畳む"
