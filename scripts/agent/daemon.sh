#!/usr/bin/env bash
# 司令塔の機械の部分を回し続ける。**1周を回し、待つ。**
#
#   bash scripts/agent/daemon.sh start        # 背景で立てる（ログは $DAEMON_LOG へ追記）
#   bash scripts/agent/daemon.sh stop         # 止める（錠が外れるまで待つ）
#   bash scripts/agent/daemon.sh restart      # 直接 push した版や環境変数を、すぐ効かせるとき
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
# **回し続けること**だけ——錠・心拍・待ち・シグナルと、**周とは別の間隔で叩くもの**（次の節）。
# 1周は1つの node に収めてあり（あちらの「1周をプロセス1つに収める」）、ここが知っているのは
# **引けたかどうか**（終了コード）だけ。
#
# ## 盤面は、人が読める issue へ周期で書き出す
#
# 手元で [`board.sh`](board.sh) を叩ける者しか盤面を見られないので、常設の issue の本文へ書き出す
# （2.20）。書くのは [`board-publish.mjs`](board-publish.mjs) で、**間隔を持つのはこちら**
# （`PUBLISH_INTERVAL`）——1周ごとに書くと、読む人が読み切れない速さで issue が書き換わる。
#
# **書けなかった周は、ログへ1行残して次へ進む。** 古くなるのは読む先だけで、打つ手には関わらない。
#
# ## 走るのは複製。入れ替わったら、新しい版で回り直す
#
# **回っている bash は、最初に読んだ版のまま。** `MERGE` を打つと本体が `main` へ進む（`SYNCED`）ので、
# 隣の道具は次の周から新しい版で動くのに、この1本だけが古いまま残る。**古い呼び手が新しい道具を叩くと、
# 噛み合わないまま黙って何もしない周が続く**——単体では走らなくなった `board-move.mjs` を旧 `daemon.sh`
# が叩き、手を1つも出さないまま8分止まった（2026-09-05）。周の終わりに複製元と見比べて、変わって
# いたら `exec` で入れ替わる。**錠は外さずに渡す**——`exec` はPIDを持ち越すので、錠の中のPIDが自分
# なら、それは自分が置いていったもの。
#
# **走るのはリポジトリの1本ではなく、`$STATE_DIR` への複製。** bash はスクリプトを読み進めながら
# 実行するので、**走っている最中に中身が変わると、次に読む位置が別の中身を指す**（ループの中は先に
# 読み終えているので起きないが、抜けた後の行で起きる）。**回り続けるあいだ読んでいるのが複製なら、
# この窓は開いたままにならない**——走り出しの前半だけは複製元から読むが、錠を取ってすぐ移る。隣の
# 道具の在り処は複製が知らないので、複製元が `DAEMON_ORIGIN` で渡す。
#
# 入れ替えた先が壊れていればそこで終わる。**古い版で黙って回り続けるよりは、止まったほうが後から
# 追える**——心拍が腐れば `status` が「止まっている」と答える。
#
# ## 引けなかったら、その周は何もしない
#
# 盤面が欠けた周は手を決めない（`board-round.mjs`）。続けて `FAILURE_LIMIT` 回失敗したら、待つ間隔を
# `RETRY_INTERVAL` へ落として回り続ける——同じ速さで叩き続けるとログが埋まるが、**止まってしまうと、
# 直っても誰かが立て直すまで盤面が動かない。**
#
# **止めないのは、いちばん多い理由が自分では直せず、放っておくと直るものだから。** アクセストークンは
# 数時間で切れ、切れている間は `list_sessions` が 401 を返す。**貼り直すのは Claude Code 本体**（この
# デーモンでも `ccr-meta.sh` でもない）なので、こちらにできるのは直るまで待つことだけ
# （2026-09-06 00:27Z、`OAuth access token has expired` で5回続けて落ちて止まった）。
# 意図して止めるための手綱は `stop` の側にある。

set -euo pipefail

# `%/*` は区切りが無いと文字列をそのまま返す。
HERE="${BASH_SOURCE[0]%/*}"
if [[ "$HERE" == "${BASH_SOURCE[0]}" ]]; then HERE='.'; fi
HERE="$(cd "$HERE" && pwd)"
# **隣の道具の在り処は、複製元だけが知っている**（上の「走るのは複製」）。複製から走っているとき、
# `$HERE` が指すのは複製の置き場なので、道具も版の出どころもこちらで引く。
ORIGIN="${DAEMON_ORIGIN:-$HERE}"
SOURCE="$ORIGIN/daemon.sh"
INTERVAL="${INTERVAL:-30}"
# 盤面を常設の issue へ書き出す間隔（2.20）。**周と同じ速さでは書かない**——読むのは人で、
# 30秒ごとに書き換えても読み切れないうえ、issue の編集履歴がそれで埋まる。
PUBLISH_INTERVAL="${PUBLISH_INTERVAL:-300}"
FAILURE_LIMIT="${FAILURE_LIMIT:-5}"
# 続けて引けなくなった後の、待つ間隔。**`ROUND_LIMIT` より短くしておく**——心拍の間隔がそのまま
# 延びるので、越えると `status` が生きているものを「止まっている」と答える。
RETRY_INTERVAL="${RETRY_INTERVAL:-300}"
STATE_DIR="${BOARD_STATE:-$HOME/.claude/board-state}"

DAEMON_LOG="${DAEMON_LOG:-$HOME/daemon.log}"
# `stop` が、撃った相手の錠が外れるのを待つ上限。周の途中で受けたぶんは、その周を終えてから止まる。
STOP_WAIT="${STOP_WAIT:-90}"
# `start` が、立てた相手の心拍を待つ上限。
START_WAIT="${START_WAIT:-30}"

# 走る実体。**錠の外に置く**——錠より長生きで、`stop` して `start` し直しても同じ場所を使う。
COPY="$STATE_DIR/daemon-running.sh"

LOCK="$STATE_DIR/lock"
# **心拍は錠の外。** 中に置くと `stop` が錠ごと消してしまい、止めた後の `status` が「一度も起きて
# いない」と答える。最後にいつ回っていたかは、止めた後こそ知りたい。
HEARTBEAT="$STATE_DIR/heartbeat"
# 最後に盤面を書き出した時刻（エポック秒）。**心拍と同じく錠の外**——`stop` して `start` し直した
# だけで書き出しの周期が頭から始まると、立て直すたびに1回ずつ余分に書く。
PUBLISHED="$STATE_DIR/published"
# **PIDは錠の中。** 撃つ相手は錠を持っている者そのものなので、寿命が同じでないと嘘になる。
PIDFILE="$LOCK/pid"
# 1周が掛かってよい上限。心拍は周の頭にしか書かないので、**時間の掛かる手（マージ）の最中に錠を
# 取り上げられない**だけの幅が要る。**`INTERVAL` の倍数では表さない**——待つ間隔を詰めると、周に
# 許す時間まで一緒に縮んでしまう。この2つは別のことを測っている。
ROUND_LIMIT="${ROUND_LIMIT:-600}"
# 心拍が途切れてから、落ちたと見なすまで。寝ている間は書かないので、1周ぶんの寝と足す。
# **足すのは長いほうの寝**——引けない間は `RETRY_INTERVAL` で寝るので、そちらで測らないと、
# 生きて待っているデーモンを落ちたと読む。
STALE_SECONDS=$(((RETRY_INTERVAL > INTERVAL ? RETRY_INTERVAL : INTERVAL) + ROUND_LIMIT))

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

# 盤面を常設の issue へ書き出す（2.20）。**間隔が満ちていなければ何もしない。**
#
# **書けなくても周は止めない。** 読む先が古くなるだけで、打つ手には関わらない——ここで諦める側へ
# 倒さないと、GitHubが数分沈むたびに盤面ごと止まる。
publish_board() {
  local now last=0
  now=$(date -u +%s)
  [ ! -f "$PUBLISHED" ] || last=$(cat "$PUBLISHED")
  # 読めた中身が数でなければ、一度も書いていないものとして扱う（次の1回で書き直る）。
  [[ "$last" =~ ^[0-9]+$ ]] || last=0
  [ $((now - last)) -ge "$PUBLISH_INTERVAL" ] || return 0
  # **叩いた時刻は、成否によらず控える。** 失敗のたびに次の周で叩き直すと、GitHubが沈んでいる間
  # 30秒おきに打ち続けることになる——遅れて困るのは読む人だけなので、周期のぶんは待ってよい。
  echo "$now" >"$PUBLISHED"
  node "$ORIGIN/board-publish.mjs" || log "盤面を書き出せなかった（次の周期でやり直す）"
}

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
  nohup bash "$SOURCE" run >>"$DAEMON_LOG" 2>&1 &
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
  # **錠の中のPIDが自分なら、置いていったのは自分**（`exec` はPIDを持ち越す）。複製へ移った直後と、
  # 新しい版へ入れ替わった直後がこれで、錠は外さずにそのまま使う——外して取り直すと、その隙に
  # `start` が二本目を立てられる。
  if [ -f "$PIDFILE" ] && [ "$(<"$PIDFILE")" = "$$" ]; then
    :
  elif beating; then
    log "既に走っているので、二本目は立てない（最終 $(cat "$HEARTBEAT")）"
    exit 0
  else
    log "落ちた跡の錠を取り上げる（最終 $(cat "$HEARTBEAT" 2>/dev/null || echo 不明)）"
    rm -rf "$LOCK"
    mkdir "$LOCK" || {
      log "錠を取れなかった"
      exit 1
    }
  fi
fi

# **撃つ相手を、錠の中に置いていく**（上の「止めるのも自分の仕事」）。錠と同じ寿命にしてあるので、
# 消し忘れが残らない。
echo $$ >"$PIDFILE"

trap 'rm -rf "$LOCK"' EXIT

# **リポジトリの1本を直に読ませない**（上の「走るのは複製」）。**錠を取ってから複製する**——先に
# 複製すると、既に走っている相手の実体を二本目が上書きしうる。錠は置いたPIDのまま引き継がれる。
if [ -z "${DAEMON_ORIGIN:-}" ]; then
  cp "$SOURCE" "$COPY"
  DAEMON_ORIGIN="$HERE" exec bash "$COPY" run
fi

# `stop` に撃たれたら、寝ていても待たずに畳む。**周の途中で受けたぶんは、その周を終えてから**
# ——1手の途中で消えると、打った跡と台帳が食い違う。
stopping=''
napping=''
trap 'stopping=1; [ -z "$napping" ] || kill "$napping" 2>/dev/null || true' TERM INT

# **回っている版そのもの**（＝走っている複製の中身）。周の終わりに、複製元をここと見比べる。
loaded=$(<"$COPY")

failures=0
while true; do
  date -u +%Y-%m-%dT%H:%M:%SZ >"$HEARTBEAT"
  if BOARD_STATE="$STATE_DIR" node "$ORIGIN/board-round.mjs"; then
    [ "$failures" -lt "$FAILURE_LIMIT" ] || log "引けるようになったので、${INTERVAL}秒おきへ戻る"
    failures=0
  else
    failures=$((failures + 1))
    log "盤面を引けなかった（${failures}回目）"
    [ "$failures" -ne "$FAILURE_LIMIT" ] ||
      log "${FAILURE_LIMIT}回続けて失敗したので、${RETRY_INTERVAL}秒おきへ落とす（認証切れか通信断。直れば自分で戻る）"
  fi
  publish_board
  [ -z "${ONCE:-}" ] || break
  [ -z "$stopping" ] || break
  # 寝る前に見るのは、**古い版のまま `INTERVAL` ぶん待たせない**ため（上の「走るのは複製」）。複製元へ
  # 戻ってから複製を取り直させるので、走っている自分を上書きすることにはならない。
  if [ "$(<"$SOURCE")" != "$loaded" ]; then
    log "自分の版が入れ替わったので、新しい版で回り直す"
    DAEMON_ORIGIN='' exec bash "$SOURCE" run
  fi
  # **背景で寝る。** 前に置くと、bash は前の子が終わるまで signal を握るので、撃たれても
  # `INTERVAL` ぶん止まらない。
  nap="$INTERVAL"
  [ "$failures" -lt "$FAILURE_LIMIT" ] || nap="$RETRY_INTERVAL"
  sleep "$nap" &
  napping=$!
  wait "$napping" || true
  napping=''
  [ -z "$stopping" ] || break
done
[ -z "$stopping" ] || log "止めろと言われたので畳む"
