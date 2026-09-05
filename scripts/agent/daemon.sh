#!/usr/bin/env bash
# 司令塔の機械の部分を回し続ける。**1周を回し、待つ。**
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
# ## 1周の中身はここには無い
#
# 引くことも決めることも打つことも [`board-round.mjs`](board-round.mjs) が持つ。ここに残るのは
# **回し続けること**だけ——錠・心拍・待ち・シグナル。1周は1つの node に収めてあり
# （あちらの「1周をプロセス1つに収める」）、ここが知っているのは**引けたかどうか**（終了コード）
# だけ。
#
# ## 引けなかったら、その周は何もしない
#
# 盤面が欠けた周は手を決めない（`board-round.mjs`）。続けて `FAILURE_LIMIT` 回失敗したら止まる
# ——認証切れや通信断で回り続けても、ログが埋まるだけ。

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INTERVAL="${INTERVAL:-30}"
FAILURE_LIMIT="${FAILURE_LIMIT:-5}"
STATE_DIR="${BOARD_STATE:-$HOME/.claude/board-state}"

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

trap 'rm -rf "$LOCK"' EXIT

# `stop` に撃たれたら、寝ていても待たずに畳む。**周の途中で受けたぶんは、その周を終えてから**
# ——1手の途中で消えると、打った跡と台帳が食い違う。
stopping=''
napping=''
trap 'stopping=1; [ -z "$napping" ] || kill "$napping" 2>/dev/null || true' TERM INT

failures=0
while true; do
  date -u +%Y-%m-%dT%H:%M:%SZ >"$HEARTBEAT"
  if BOARD_STATE="$STATE_DIR" node "$HERE/board-round.mjs"; then
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
