#!/usr/bin/env bash
# 盤面を回し続ける。**1周を回し、待つ。**
#
#   bash scripts/daemon/daemon.sh start        # 背景で立てる（ログは $DAEMON_LOG へ追記）
#   bash scripts/daemon/daemon.sh stop         # 止める（錠が外れるまで待つ）
#   bash scripts/daemon/daemon.sh restart      # 直接 push した版や環境変数を、すぐ効かせるとき
#   bash scripts/daemon/daemon.sh status       # 生きているかだけを見る（生きていれば0）
#   bash scripts/daemon/daemon.sh run          # 前に出たまま回す
#   INTERVAL=300 bash scripts/daemon/daemon.sh run
#   ONCE=1 bash scripts/daemon/daemon.sh run              # 1周だけ回して終わる
#   DRY_RUN=1 ONCE=1 bash scripts/daemon/daemon.sh run    # 手を並べるだけで、打たない
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
# 手元で [`board.sh`](../agent/board.sh) を叩ける者しか盤面を見られないので、常設の issue の本文へ書き出す
# （2.20）。書くのは [`board-publish.mjs`](board-publish.mjs) で、**間隔を持つのはこちら**
# （`PUBLISH_INTERVAL`）——1周ごとに書くと、読む人が読み切れない速さで issue が書き換わる。
#
# **セッションの一覧を渡すのは、盤面を引けた周だけ**（1.7）。**引けなかった周も書き出す**
# ——引けない間は誰もセッションを立てられないので、直せるのは人だけで、**その人へ届く先はここしか
# 無い**（2.21）。表は前のままでも、**引けていないことは断りとして本文に出る。**
#
# **書けなかった周は、ログへ1行残して次へ進む。** 古くなるのは読む先だけで、打つ手には関わらない。
#
# ## 盤面が動くのに要る値の生死を見回る
#
# 環境IDと資格情報は、死んでも誰も言わない（2.22）。見回るのは
# [`check-values.mjs`](check-values.mjs) で、**間隔を持つのはこちら**（`CHECK_INTERVAL`）。
#
# **周期の係（2.17）には載せられない。** 係を立てるかを決めるのは1周の中（`board-round.mjs`）で、
# **`gh` が死ぬとその1周が引けない**——いちばん告げてほしい死のときに、告げる者が立たない。
#
# **引けなかった周こそ見回る。** 引けない理由がまさにこの値なので、盤面の成否では回さない。
#
# ## 走るのは複製。入れ替わったら、新しい版で回り直す
#
# **回っている bash は、最初に読んだ版のまま。** 本体が `main` へ進むと（下の「本体を `origin/main` へ
# 寄せるのは」）、隣の道具は次の周から新しい版で動くのに、この1本だけが古いまま残る。**古い呼び手が新しい道具を叩くと、
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
# ## 本体を `origin/main` へ寄せるのは、立てるときと、周の終わり
#
# **立て直しは、古い版で回り出す機会でもある。** 落ちた跡から起こすのは起こす係（2.19）で、打つのは
# `start` だけ——寄せる者がここに居ないと、**落ちた時点の版で1周目を回す**ことになる（下の周の寄せが
# 効くのは、その1周を終えた後）。**寄せるのは
# `start` が持ち、起こす係には持たせない**（出どころ: ユーザーの指示・2026-09-06）。同じ更新をする
# 仕組みを2つ置くと、どちらが進めたのかが読めなくなる。
#
# **回り続けている間も、周の終わりに寄せる**（2.3.2）。`start` だけが寄せる形では、走っている間に
# 本体が進むのは**盤面が自分でマージを打った周**（`tidy-merged-pr.sh` の `SYNCED`）しか無く、
# **人がGitHubの画面から入れたぶん**と `main` への直接 push が届かない——次に盤面がマージを打つまで、
# 隣の道具もひな形も古い版で読まれ続ける。**誰がマージしたかで追従の仕方を分けない**（出どころ:
# ユーザーの指示・2026-09-07）。寄せるのは `start` と同じ関数なので、判定も入れ直しも1箇所のまま。
#
# **`git fetch` は毎周打つ。** 動いていない参照の取得は1往復で済み、周（既定30秒）に元から入っている
# `gh` の往復に対して増える分は小さい。間隔を別に持たせると、**古い版で回る窓をその間隔ぶん開ける**
# ことになり、塞ぎたかった穴が小さくなるだけで残る。
#
# **ログへ出すのは、本体が動いた周だけ。** 毎周書くと同じ1行が周期ぶん溜まり、動いたことが埋もれる。
# 寄せられなかったときの言い分は、`git` 自身が `$DAEMON_LOG` へ流している。
#
# 寄せる先は `tidy-merged-pr.sh` が `TIDY` のたびに進めるのと同じ本体で、未コミットの変更が
# あるときは触らない（あちらの `DIRTY` と同じ判定）。**進めたら依存も入れ直す**——作業ツリーが共有して
# いるので、本体だけ進めると古い版が解決されて一部だけ壊れる（あちらの「本体を追随させるのは」）。
# **寄せられなくても立てる**——古い版で回ることより、盤面が1ミリも動かないことのほうが重い。
#
# **寄せる先と立てる先が同じでなければ、何も進めない。** 立てるのは複製元（`$ORIGIN`）の1本なので、
# 作業ツリーから打つと、進めた本体は走らず、走る1本は古いまま残る。
#
# **`start` が出すのは1行。** 読むのは人（起こす係のタスクが残す実行結果とログ）だけなので、寄せた
# 結果は「立てた」の行へ畳み、道具の言い分は `$DAEMON_LOG` へ流す。**打った結果を数行に散らすと、
# 立ったのかどうかを読むのに全部を読む必要が出る。**
#
# **`start` の枝の `exit` を `case` の外へ出さない。** 寄せると走っている自分の中身が入れ替わるので、
# `case` を抜けてから読む行が残っていると、そこで別の中身を読む（`case` は `esac` まで読んでから
# 実行に入るので、枝の中で終わるかぎりこの窓は開かない）。
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
# 盤面が動くのに要る値を見回る間隔（2.22）。**死んだと言うまでの猶予は見回る側が持つ**ので、ここが
# 決めるのは「どれだけ細かく見るか」だけ。
CHECK_INTERVAL="${CHECK_INTERVAL:-3600}"
FAILURE_LIMIT="${FAILURE_LIMIT:-5}"
# 続けて引けなくなった後の、待つ間隔。**`ROUND_LIMIT` より短くしておく**——心拍の間隔がそのまま
# 延びるので、越えると `status` が生きているものを「止まっている」と答える。
RETRY_INTERVAL="${RETRY_INTERVAL:-300}"
STATE_DIR="${BOARD_STATE:-$HOME/.claude/board-state}"

DAEMON_LOG="${DAEMON_LOG:-$HOME/daemon.log}"
# `stop` が、撃った相手の錠が外れるのを待つ上限。周の途中で受けたぶんは、その周を終えてから止まる。
STOP_WAIT="${STOP_WAIT:-90}"
# `start` が、立てた相手が畳む備えまで進むのを待つ上限（下の `READYFILE`）。
START_WAIT="${START_WAIT:-30}"
# 待ち合わせで見に行く刻み。**上の2つとは別のこと**——あちらは「どこまで待つか」、こちらは
# 「どれくらい細かく見に行くか」。1秒刻みで見ると、ミリ秒で終わった起動・停止にもまるまる1秒を
# 足して返すので、**待った時間が相手の速さではなく刻みで決まる。**
POLL_SECONDS=0.05

# 走る実体。**錠の外に置く**——錠より長生きで、`stop` して `start` し直しても同じ場所を使う。
COPY="$STATE_DIR/daemon-running.sh"

LOCK="$STATE_DIR/lock"
# **心拍は錠の外。** 中に置くと `stop` が錠ごと消してしまい、止めた後の `status` が「一度も起きて
# いない」と答える。最後にいつ回っていたかは、止めた後こそ知りたい。
HEARTBEAT="$STATE_DIR/heartbeat"
# 最後に盤面を書き出した時刻（エポック秒）。**心拍と同じく錠の外**——`stop` して `start` し直した
# だけで書き出しの周期が頭から始まると、立て直すたびに1回ずつ余分に書く。
PUBLISHED="$STATE_DIR/published"
# 最後に値を見回った時刻（エポック秒）。**`PUBLISHED` と同じく錠の外**——立て直すたびに頭から
# 数え直すと、`start` を打つだけで見回りが1回ずつ余分に走る。
CHECKED="$STATE_DIR/checked"
# **PIDは錠の中。** 撃つ相手は錠を持っている者そのものなので、寿命が同じでないと嘘になる。
# **入るのは bash のPID空間の番号で、撃つのも bash から。** MSYS2（ブリッジ）ではこれが Windows の
# PIDと別物なので、Windows のプロセスとして撃つと、届かないか無関係なプロセスに当たる。
PIDFILE="$LOCK/pid"
# **畳む備えができたと名乗る印。錠の中に、名乗った者のPIDを置く。** `start` はこれが自分の立てた
# PIDになるまで待つ（下の「背景で立てて」）。**PIDファイルでは代われない**——あちらは錠を取った
# 直後、まだ `trap` を張る前に書くので、撃たれたら錠を残したまま死ぬ地点でも既に在る。
READYFILE="$LOCK/ready"
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

# 錠が外れていれば0。**`running` の裏ではない**——`running` は心拍も見るが、`stop` が待っているのは
# 錠が外れることそのもの（心拍は錠の外なので、綺麗に止めた直後もしばらく新しいまま）。
lock_gone() { [ ! -d "$LOCK" ]; }

# `$1` で立てたものが、畳む備えまで進んだか。**`running` では答えられない**——心拍は錠の外なので
# `stop` した直後もしばらく新しいままで、`running` は「錠が在る」だけに縮む。錠を作るのは立ち上がり
# の頭なので、立てたばかりの相手が**まだ `trap` を張っていない地点**でも真になってしまう。
ready_as() { [ "$(cat "$READYFILE" 2>/dev/null)" = "$1" ]; }

# `$1` 秒を上限に、残りの引数が表すコマンドが0で終わるまで待つ。待ちきったら非0。
#
#   wait_for "$START_WAIT" running
#
# **上限は時計で測り、刻みの回数では数えない。** 数えると `$1` の意味が「秒」から「見に行く回数」へ
# 変わるので、刻みを細かくしたぶんだけ上限が縮み、負荷で刻みが伸びたぶんは上限に乗らない。
wait_for() {
  local deadline_ms
  deadline_ms=$(($(date -u +%s%3N) + $1 * 1000))
  shift
  while ! "$@"; do
    [ "$(date -u +%s%3N)" -lt "$deadline_ms" ] || return 1
    sleep "$POLL_SECONDS"
  done
}

# 周とは別の間隔で叩くものの、時計。**満ちていれば0を返し、叩いた時刻を控える。**
#
#   due_now "$PUBLISHED" "$PUBLISH_INTERVAL" || return 0
#
# **控えるのは成否によらず。** 失敗のたびに次の周で叩き直すと、相手が沈んでいる間ずっと30秒おきに
# 打ち続けることになる——遅れて困るのは読む人だけなので、周期のぶんは待ってよい。
due_now() {
  local mark="$1" interval="$2" now last=0
  now=$(date -u +%s)
  [ ! -f "$mark" ] || last=$(cat "$mark")
  # 読めた中身が数でなければ、一度も叩いていないものとして扱う（次の1回で書き直る）。
  [[ "$last" =~ ^[0-9]+$ ]] || last=0
  [ $((now - last)) -ge "$interval" ] || return 1
  echo "$now" >"$mark"
}

# 盤面を常設の issue へ書き出す（2.20）。**間隔が満ちていなければ何もしない。**
#
#   publish_board fresh   # この周に盤面を引けた（一覧もこの周のぶんが在る）
#   publish_board         # 引けなかった
#
# **セッションの一覧は、この周のぶんを渡す**——書き出す側に引き直させると、`list_sessions` を叩く
# 回数がそのまま盤面の回る速さの天井に効く（1.7）。同じ周の答えを使うので、**issue に出る表と、
# その周に打った手の根拠が同じ一覧**になる。
#
# **引けなかった周も書き出す**（2.21）。書き出す側は**表とその周の断りを分けて出せる**ので
# （[`board.mjs`](board.mjs) の `issueBody`）、**引けないまま止まっていることが読む人へ届く。**
# ただし**前の周の一覧は渡さない**——渡すと、古い写しが今の一覧として表に載る。
#
# **書けなくても周は止めない。** 読む先が古くなるだけで、打つ手には関わらない——ここで諦める側へ
# 倒さないと、GitHubが数分沈むたびに盤面ごと止まる。
publish_board() {
  due_now "$PUBLISHED" "$PUBLISH_INTERVAL" || return 0
  # 引けていない印と見回りの記録は、どちらもデーモンの手元に在る
  # （[`board-state.mjs`](board-state.mjs)）ので、置き場を渡す。
  local -a pass=("BOARD_STATE=$STATE_DIR")
  [ "${1:-}" != 'fresh' ] || pass+=("LIVE_SESSIONS_TSV=$STATE_DIR/live-sessions.tsv")
  env "${pass[@]}" node "$ORIGIN/board-publish.mjs" ||
    log "盤面を書き出せなかった（次の周期でやり直す）"
}

# 盤面が動くのに要る値の生死を見回る（2.22）。**間隔が満ちていなければ何もしない。**
#
# **盤面を引けたかは渡さない。** 引けない理由がまさにこの値なので、成否で回すと**告げてほしい周だけ
# 見回らない**。台帳（死んでいる値と、いつからか）の置き場は1周を回す側と同じ。
check_values() {
  due_now "$CHECKED" "$CHECK_INTERVAL" || return 0
  BOARD_STATE="$STATE_DIR" node "$ORIGIN/check-values.mjs" ||
    log "値を見回れなかった（次の周期でやり直す）"
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
  local pid=''
  [ ! -f "$PIDFILE" ] || pid=$(cat "$PIDFILE")
  # 撃つ相手が居ないのに待っても、錠は永久に外れない。**落ちた跡はここで片付ける**——次の `start`
  # まで残すと、心拍が腐るまでの間だけ「走っている」と答え続ける。
  if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
    rm -rf "$LOCK"
    echo "落ちた跡の錠を外した"
    return 0
  fi
  kill "$pid" 2>/dev/null || true
  if ! wait_for "$STOP_WAIT" lock_gone; then
    echo "${STOP_WAIT}秒待っても止まらなかった（$pid）" >&2
    return 1
  fi
  echo "止めた（$pid）"
}

# 直前の `sync_origin` の結果を表す短い1語句。呼び手が自分の1行へ畳んで載せる。
synced_said=''
# 直前の `sync_origin` で本体の `HEAD` が動いたか。**語句と別に持つのは、読む側が2つあるため**
# ——`start` は動いたかによらず結果を1行へ載せ、周の側は動いた周だけログへ出す（上の「ログへ出すのは」）。
synced_moved=''

# 本体のチェックアウトを `origin/main` へ寄せる（上の「本体を `origin/main` へ寄せるのは」）。**答えは標準出力では
# なく上の2つへ置く**——`$(sync_origin)` は子シェルなので、そこで立てた印は呼び手へ戻らない。
# **寄せられなくても立てられるように、失敗はすべて0で返す。** 道具の言い分（`git`・`npm` が出す
# もの）は `$DAEMON_LOG` へ流す。
sync_origin() {
  local common='' main_dir='' before='' was='' head=''
  synced_said=''
  synced_moved=''
  # **引けなければ空のまま**（[`daemon-wake-task.sh`](../agent/daemon-wake-task.sh) と同じ）。既定値を置くと、
  # 当てずっぽうの場所を本体として進めにいく。`--path-format=absolute` を明示するのは、既定が相対で
  # 返りうるため。
  common=$(git -C "$ORIGIN" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || common=''
  [ -z "$common" ] || main_dir=$(dirname "$common")
  if [ -z "$main_dir" ]; then
    synced_said='本体が見つからない'
    return 0
  fi
  # **寄せる先と立てる先が同じでなければ、何も進めない。** 立てるのは `$SOURCE`（＝`$ORIGIN` の側）
  # なので、作業ツリーから打つと、進めた本体は走らず、走る1本は古いまま残る。
  if [ "$(git -C "$ORIGIN" rev-parse --path-format=absolute --show-toplevel 2>/dev/null)" != "$main_dir" ]; then
    synced_said='本体の外から立てている'
    return 0
  fi
  # 未追跡は見ない（`tidy-merged-pr.sh` と同じ）。本体を進める妨げになるなら、`checkout` が失敗して分かる。
  if [ -n "$(git -C "$main_dir" status --porcelain --untracked-files=no 2>/dev/null)" ]; then
    synced_said='本体に未コミットの変更がある'
    return 0
  fi
  before=$(git -C "$main_dir" rev-parse HEAD:package-lock.json 2>/dev/null) || before=''
  # **寄せる前の先頭も控える。** 周の側はこれと寄せた後を見比べて、動いた周だけログへ出す。
  was=$(git -C "$main_dir" rev-parse HEAD 2>/dev/null) || was=''
  if ! git -C "$main_dir" fetch --quiet origin main >>"$DAEMON_LOG" 2>&1 ||
    ! git -C "$main_dir" checkout --quiet --detach origin/main >>"$DAEMON_LOG" 2>&1; then
    synced_said='本体を寄せられなかった'
    return 0
  fi
  [ "$was" = "$(git -C "$main_dir" rev-parse HEAD 2>/dev/null)" ] || synced_moved=1
  head=$(git -C "$main_dir" rev-parse --short HEAD 2>/dev/null)
  # **進めた側が依存も入れ直す**（`tidy-merged-pr.sh`「本体を追随させるのは」）。作業ツリーは本体の
  # `node_modules` を遡って共有するので、古いままだと**古い版が解決されて一部だけ壊れる**。ここが
  # 跨ぐのは後片付けの外で `main` が動いたぶん（盤面を回す仕組みの直接 push・`DIRTY` で寄せられなかった
  # 周・止まっている間に窓から出たぶん）なので、`tidy-merged-pr.sh` が打った後とは限らない。
  # **入れ直しの最中は共有先が揺れる**ので、
  # 自分が跨いだ差に依存の更新が混じっていたときだけ打つ。**元から入っていないぶんは見ない**
  # ——寄せたことで嘘になった木を直すのがここの役目で、一度も入れていない本体はここの落ち度ではない。
  if [ "$before" = "$(git -C "$main_dir" rev-parse HEAD:package-lock.json 2>/dev/null)" ]; then
    synced_said="本体は $head"
    return 0
  fi
  if (cd "$main_dir" && npm install --no-fund --no-audit) >>"$DAEMON_LOG" 2>&1; then
    synced_said="本体は $head・依存も入れ直した"
  else
    synced_said="本体は $head・依存を入れ直せなかった"
  fi
}

# 背景で立てて、**立てたものが畳む備えまで進むのを待つ**。確かめてから返すので、呼び手は待たない。
#
# **待つ相手は「誰かが走っていること」ではなく「自分が立てたものが立ったこと」。** `restart` のように
# 直前まで別のものが走っていた場では、前の心拍が残っているので前者は当てにならない。
start_daemon() {
  if running; then
    echo "既に走っている（最終 $(cat "$HEARTBEAT")）"
    return 0
  fi
  # **寄せてから読ませる。** `nohup` が `$SOURCE` を開くのは寄せ終わった後なので、寄せられたなら
  # 立つのは新しい版。
  sync_origin
  nohup bash "$SOURCE" run >>"$DAEMON_LOG" 2>&1 &
  # **立てたもののPIDで待つ。** `exec` はPIDを持ち越すので、複製へ移った先が名乗るのも同じ番号。
  if wait_for "$START_WAIT" ready_as "$!"; then
    echo "立てた（$synced_said。ログは $DAEMON_LOG）"
    return 0
  fi
  echo "${START_WAIT}秒待っても立ち上がらなかった（$synced_said。$DAEMON_LOG を見る）" >&2
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
# 複製元を読めないまま回っているか。**読めなくなった1周だけ言う**ための印（下の「複製元は `cat` で読む」）。
unreadable=''
trap 'stopping=1; [ -z "$napping" ] || kill "$napping" 2>/dev/null || true' TERM INT

# **畳む備えができたと名乗るのはここ**（上の `READYFILE`）——撃たれても錠を残さずに終われる地点。
# **`trap` を張る前に名乗らない。** 複製へ移る `exec` は trap を落としていくので、そこから張り直す
# までの間に撃たれると、錠だけが残って `stop` が待ちきることになる。
echo $$ >"$READYFILE"

# **回っている版そのもの**（＝走っている複製の中身）。周の終わりに、複製元をここと見比べる。
loaded=$(<"$COPY")

failures=0
while true; do
  date -u +%Y-%m-%dT%H:%M:%SZ >"$HEARTBEAT"
  if BOARD_STATE="$STATE_DIR" node "$ORIGIN/board-round.mjs"; then
    [ "$failures" -lt "$FAILURE_LIMIT" ] || log "引けるようになったので、${INTERVAL}秒おきへ戻る"
    failures=0
    publish_board fresh
  else
    failures=$((failures + 1))
    log "盤面を引けなかった（${failures}回目）"
    # **引けない周こそ書き出す**（2.21）。引けない間は誰もセッションを立てられないので、直せるのは
    # 人だけ——**ログを読めるのは手元で叩ける人だけ**なので、届く先は常設の issue しか無い。
    publish_board
    [ "$failures" -ne "$FAILURE_LIMIT" ] ||
      log "${FAILURE_LIMIT}回続けて失敗したので、${RETRY_INTERVAL}秒おきへ落とす（認証切れか通信断。直れば自分で戻る）"
  fi
  check_values
  # **畳む周では寄せない。** 使う周がもう無いうえ、依存の入れ直しが `STOP_WAIT` を越えると、
  # `stop` が「止まらなかった」と答える。
  [ -z "$stopping" ] || break
  # **本体を寄せるのは周の終わり**（上の「本体を `origin/main` へ寄せるのは」）。
  # **入れ替わりの見比べより手前に置く**——ここで `daemon.sh` が新しくなったぶんを、下の `exec` が
  # 同じ周のうちに拾う。**`DRY_RUN` の周では寄せない**——打たないつもりで叩いた1周が、本体の `HEAD`
  # を動かす（上の使い方の `DRY_RUN=1`）。
  if [ -z "${DRY_RUN:-}" ]; then
    sync_origin
    [ -z "$synced_moved" ] || log "$synced_said"
  fi
  [ -z "${ONCE:-}" ] || break
  # 寝る前に見るのは、**古い版のまま `INTERVAL` ぶん待たせない**ため（上の「走るのは複製」）。複製元へ
  # 戻ってから複製を取り直させるので、走っている自分を上書きすることにはならない。
  #
  # **複製元は `cat` で読む。** `$(<…)` は読めなかったときに非対話シェルをその場で終わらせるので、
  # 複製元が動いた・消えた周に、ログ行すら残さずデーモンごと落ちる。**在るかを先に見るだけでは
  # 足りない**——見てから読むまでの間に消えれば同じ死に方をするので、読み取り自体が殺さない形にする。
  if ! source_now="$(cat "$SOURCE" 2>/dev/null)"; then
    # **読めない間は、今の版のまま回り続ける。** 走っているのは複製なので、複製元が要るのは
    # 入れ替えるときだけ——読めないことは、周を止める理由にならない。
    [ -n "$unreadable" ] || log "複製元（$SOURCE）を読めないので、今の版のまま回り続ける"
    unreadable=1
  else
    unreadable=''
    if [ "$source_now" != "$loaded" ]; then
      log "自分の版が入れ替わったので、新しい版で回り直す"
      DAEMON_ORIGIN='' exec bash "$SOURCE" run
    fi
  fi
  # **背景で寝る。** 前に置くと、bash は前の子が終わるまで signal を握るので、撃たれても
  # `INTERVAL` ぶん止まらない。
  nap="$INTERVAL"
  [ "$failures" -lt "$FAILURE_LIMIT" ] || nap="$RETRY_INTERVAL"
  sleep "$nap" &
  napping=$!
  # **寝る相手を控えてから、撃たれていないかを見る。** 上の `trap` は控えたものしか撃てないので、
  # **控える前に受けたぶんは誰も起こしに来ない**——`stopping` が立っているのに寝入って、次に見るのが
  # 寝終わった後になる（周の終わりに撃たれると `INTERVAL`、引けずにいれば `RETRY_INTERVAL` ぶん）。
  # 見るのを寝床に入った後へ置けば、受けたのが控える前でも後でも、どちらかが必ず起こす。
  [ -z "$stopping" ] || kill "$napping" 2>/dev/null || true
  wait "$napping" || true
  napping=''
  [ -z "$stopping" ] || break
done
[ -z "$stopping" ] || log "止めろと言われたので畳む"
