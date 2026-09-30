#!/usr/bin/env bash
# 使用量を引いて行で出す。**この口の外は書き換えない。**
#
#   $ bash scripts/daemon/usage.sh
#   five_hour 9 2026-09-04T20:10:00.441803+00:00 -
#   seven_day 14 2026-09-10T15:59:59.441827+00:00 -
#
#   $ bash scripts/daemon/usage.sh --last   # 最後に引けた行を、口を叩かずに読み直す
#
# 1行が `<枠> <utilization> <resets_at> <locked_reason>`。`locked_reason` が無いときは `-`。
# **引けなかったときは標準出力へ何も出さずに1で終わる**ので、呼び手は終了コードだけで止まる側へ
# 倒せる（[`occupancy.sh`](occupancy.sh) と同じ向き）。**落ちた理由は標準エラーへ出す**——読むのは
# 呼び手ではなく、後からログを見る人間。
#
# ## 叩ける間隔には上限がある。それを持つのはこの口
#
# **この口は、前の呼び出しから間を詰めた1回で `429 rate_limit_error` を返し、そこから1時間閉じる**
# （2026-09-30 に実測。前の呼び出しの60秒後で閉じ、180秒おきなら閉じない。閉じている間に叩いても
# 延びず、`retry-after` が開くまでの秒数を数え下ろす）。**間を数えるのは呼び手ごとではなく、同じ
# トークンを使う全員の通し**——Claude Code の本体も同じ口を叩く（2.1.285 から経路が増えた）ので、
# **こちらが詰めて叩くほど、本体の1回が口を閉じさせる。** 何秒に1回なら通るかはこの口の性質なので、
# 呼び手ではなくここが持つ。
#
# 前に叩いた時刻を `$BOARD_STATE/usage-polled` へ置き、`USAGE_MIN_SECONDS` を空けずに呼ばれたら
# **何も出さずに終了コード2**で返す。**印を付けるのは叩いたときで、読めたときではない**——読めな
# かった回にも間隔を空けないと、切れた資格情報を相手に叩き続けることになる。
#
# **閉じた口の開く時刻は `$BOARD_STATE/usage-closed` へ置き、それまでは叩かずに2で返す。** 叩いても
# 同じ `429` が返るだけで、開いた周にすぐ引けるかどうかは、開く時刻を知っているかで決まる。
# `USAGE_MIN_SECONDS=0`（順番を待たずに叩け）でも叩かず、**開くまでの秒数を標準エラーへ出して1**
# で終わる——人が確かめる打ち方なので、答えは「閉じている」でよい。
#
# **2は失敗ではなく「今は読む番ではない」。** 1（引けなかった）と分けるのは、呼び手が**黙って
# 見送るのか、報せるのか**を選べるようにするため——分けないと、待つだけの周まで異常として並び、
# 本物の失敗が埋もれる（35秒ごとに叩いていた頃、ログの半分がこれだった）。
#
# ## 毎周値が要る側のために、引けた行を控える（`--last`）
#
# **叩ける間隔より短い周期で値が要る呼び手が居る**——投入の関門（[`headroom.sh`](headroom.sh)）は
# 1周（35秒）のうちに答えなければならない。その呼び手に毎周叩かせると、**間隔が空いた周にしか答えが
# 出ないうえ、割り当ての側（[`usage-record.sh`](usage-record.sh)）の番を奪う**（間隔は1つしか無い）。
# **控えが無い・古い周にあちらが自分で1回叩くのは別の話**——そこは控えが在れば通らない経路で、
# 判断はあちらが持つ。
#
# **控えを持つのはここ。** 「値が何秒で古くなるか」は叩ける間隔から出るので、この口の性質
# （`CLAUDE.md`「自分のことは自分でする」）。`--last` は控えを出し、**`USAGE_MAX_AGE_SECONDS` より
# 古ければ何も出さずに1**で終わる——**古い値で投入を通すと、上限に当たってから気づく。**
# 既定の30分は、引けた回が数回続けて途切れた長さ。**口が閉じた1時間のうち、控えが古くなった後ろの
# 側は、ここで投入が止まる**——閉じている間の余力は分からないので、止まる側に置く（`board-design.md` 2.5.2節）。
#
# **控えるのは引けた行だけで、叩いた印（`usage-polled`）とは別の話。** 引けなかった回に控えを
# 書き換えると、**「引けなかった」が「余力が在る」として読まれる。**
#
# ## `limits[].severity` は出さない
#
# 基盤の出す段階は「どれだけ使ったか」を粗く言うだけで、**こちらが知りたい「あと1本投入して
# よいか」には答えない**（[`board-design.md`](../../agent-ops/board-design.md) 2.5.1節）。要るのは残量
# そのものではなく**残量と1本あたりの消費の比較**なので、比較は呼び手が自分の計測でする。
#
# 応答には他にも枠が並ぶ（`seven_day_opus` など）。**どの枠を出すかと、行をどう読むかは
# [`usage-windows.mjs`](usage-windows.mjs) が持つ。**
#
# ## トークンは呼ぶたびに読み直す
#
# 理由は [`ccr-meta.sh`](../../.claude/ccr-meta.sh) の冒頭と同じ——掴んだままにすると、走っている
# 最中に切れたときそのセッションから二度と使えない。**モデルは要らない**ので、この口は使用量が
# 満杯でも通る。

set -euo pipefail

STATE_DIR="${BOARD_STATE:-$HOME/.claude/board-state}"
POLLED="$STATE_DIR/usage-polled"
# 控えの1行目は引けた時刻（エポック秒）、2行目から枠の行。**時刻を別のファイルにしない**
# ——2つに分けると、片方だけ書けた回に「新しい印の付いた古い値」ができる。
LATEST="$STATE_DIR/usage-latest"
CLOSED="$STATE_DIR/usage-closed"
# **間隔は、本体が割り込める隙間の広さ。** 1回叩くとその前後は誰が叩いても口が閉じる（幅は60〜180秒
# のどこかで、上限は測っていない）ので、180秒おきでは本体の入る隙間がほぼ残らない。**詰めても得は無い**——欲しいのは全体の増分で、
# 粗く測っても総和は変わらない（`board-design.md` 2.5.3節「間隔は粗くてよい」）。
USAGE_MIN_SECONDS="${USAGE_MIN_SECONDS:-600}"
USAGE_MAX_AGE_SECONDS="${USAGE_MAX_AGE_SECONDS:-1800}"

# 時刻を取るのも、前に叩いた時刻を読むのも、bash の中で閉じる（`%(…)T` と `$(<…)`）。
# **見送る周のほうが多い**ので、そこは外部プロセス0個で返る。
printf -v now '%(%s)T' -1

# 口が開くまでの秒数。**読めない印は無いのと同じ**に扱う——叩くだけなので、余力の側へは倒れない。
closed_for=0
if [ -f "$CLOSED" ]; then
  closed_at=$(<"$CLOSED")
  if [[ "$closed_at" =~ ^[0-9]+$ ]] && ((closed_at > now)); then closed_for=$((closed_at - now)); fi
fi

if [ "${1:-}" = '--last' ]; then
  if [ ! -f "$LATEST" ]; then
    echo "使用量をまだ一度も引けていない" >&2
    exit 1
  fi
  mapfile -t cached <"$LATEST"
  read_at="${cached[0]:-}"
  # **控えが壊れていたら古いのと同じ扱い。** 読めない値を0として比べると、**0秒前に引けた**ことに
  # なる書き方（`((now - 読めない))` が0を返す形）へ落ちうる。
  if [[ ! "$read_at" =~ ^[0-9]+$ ]]; then
    echo "控えた使用量が読めない: $LATEST" >&2
    exit 1
  fi
  if ((now - read_at > USAGE_MAX_AGE_SECONDS)); then
    closed=''
    if ((closed_for > 0)); then closed="。口はあと${closed_for}秒閉じている"; fi
    echo "最後に引けた使用量が古い（$((now - read_at))秒前${closed}）" >&2
    exit 1
  fi
  printf '%s\n' "${cached[@]:1}"
  exit 0
fi

if ((closed_for > 0)); then
  if ((USAGE_MIN_SECONDS == 0)); then
    echo "使用量の口はあと${closed_for}秒閉じている（429 の retry-after）" >&2
    exit 1
  fi
  exit 2
fi

if [ -f "$POLLED" ] && ((now - $(<"$POLLED") < USAGE_MIN_SECONDS)); then exit 2; fi

[ -d "$STATE_DIR" ] || mkdir -p "$STATE_DIR"
printf '%s\n' "$now" >"$POLLED"

# **中身は隣の [`usage.mjs`](usage.mjs)。ここは間隔の番と入口だけ。** トークンの読み出し・通信・
# 取り出しを**プロセスを跨がずに1つの node の中で済ませる**理由は
# [`ccr-meta.sh`](../../.claude/ccr-meta.sh) と同じ——Windowsでは `node` の起動だけで1回44.5ms
# かかり（2026-09-05 の実測）、手綱がここを毎周叩くので、境界の数がそのまま常時の固定費になる。
#
# **トークンを引数にも環境変数にも載せない。** `SHELLOPTS=xtrace` を伝播させて数えると、シェルに
# 渡した値はそのままトレースへ写る。

# `%/*` は区切りが無いと文字列をそのまま返す。
HERE="${BASH_SOURCE[0]%/*}"
if [[ "$HERE" == "${BASH_SOURCE[0]}" ]]; then HERE='.'; fi

# **控えを書くのは、引けたときだけ。** 3は口が閉じた回で、出てくるのは開くまでの秒数。
status=0
lines=$(node "$HERE/usage.mjs") || status=$?
if ((status != 0)); then
  if ((status == 3)) && [[ "$lines" =~ ^[0-9]+$ ]]; then printf '%s\n' "$((now + lines))" >"$CLOSED"; fi
  exit 1
fi
printf '%s\n%s\n' "$now" "$lines" >"$LATEST"
printf '%s\n' "$lines"
