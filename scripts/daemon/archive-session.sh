#!/usr/bin/env bash
# CCRのセッションを畳む。**畳んでよいかの判定はここが持つ**——呼び手は「畳んでほしい相手」を
# 標準入力へ1行1件で渡すだけでよい。
#
#   printf '%s\n' session_A session_B | bash scripts/daemon/archive-session.sh
#   printf '%s\n' session_A | bash scripts/daemon/archive-session.sh --keep-untagged task-,review-
#
# 出力は1行1件。`ARCHIVED <ID>`、触らないと決めたものは `KEPT <ID>`、打って失敗したものは
# `UNARCHIVED <ID>: <理由>`、素性を引けずに畳んでよいかが分からなかったものは `UNKNOWN <ID>: <理由>`。
# このPCに worktree を持つ相手には後始末の行が続く（`REMOVED <パス>` / `DIRTY <パス>: <理由>`。
# 既に畳まれているものからも出る）。worktree の無いものが既に畳まれていたときは何も出さない。
# **終了コードは常に0**——呼び手（投入・マージ）の本題は別にあるので、後片付けで落とさない。
#
# ## 片付かなかった行は、`<タグ> <対象>: <理由>` で出す
#
# タグと対象だけを載せると、読んだ側は**失敗した事実しか受け取れない**——権限が足りないのか、相手が
# もう居ないのか、通信が落ちたのかへ辿り着けず、同じコマンドを手で打ち直すところから始めることに
# なる。理由を持っているのは打った側（`ccr-meta.sh`・`git`・`rmdir` の標準エラー）なので、捨てずに
# 同じ行へ載せる（[`tidy-merged-pr.sh`](tidy-merged-pr.sh) の残りの行と同じ形。issue #1557 では、
# パスだけの行を読んだ側が実際に誤読した）。**出力は1行1件**なので、改行は空白へ畳む。
#
# ## 判定を呼び手へ配らない
#
# 渡す相手を選ぶのは呼び手（盤面の `ARCHIVE`）だが、**渡した後の判定はここが持つ**。呼び手を増やす
# たびに同じ判定を書き足す形にすると、書き足し忘れた経路が黙って別の答えを出す。
#
# だから `get_session` はここが自分で引く。呼び手が引いたものを渡す形にすると、「どの口から引いた
# 値のどのキーを見るか」が呼び手側の知識に戻り、規約がまた散る。
#
# ## 走っている相手を除くのは、ここではない
#
# `archive_session` はコンテナを解放するので、手が動いている最中に畳むと、書きかけの出力は出ない
# まま消える。**除くのは渡す側**——盤面は走行中のセッションに手を出さない
# （[`board-move.mjs`](board-move.mjs)）。ここで除くと `KEPT` が返るが、盤面は `KEPT` を
# 「畳んではいけないという**安定した答え**」として指紋に残す（[`daemon.sh`](daemon.sh)）ので、
# **走行中がたまたま重なった1回で、その相手が二度と畳まれなくなる。**
#
# ## その仕事のために立てたものだけを畳む（`--keep-untagged <接頭辞>,<接頭辞>…`）
#
# 畳んでよいのは、**1つの仕事のために立てたセッションだけ**——`task-<番号>`
# （[`dispatch-task.sh`](dispatch-task.sh)）か `review-<PR番号>`
# （[`dispatch-review.sh`](dispatch-review.sh)）のタグを持つもの。相談役のように仕事の単位を持たない
# 相手は、何が終わっても仕事が終わっていない——畳むと、ユーザーが話している窓口ごと閉じる。
# **どの接頭辞にも当たらないもの**を `KEPT` として出す。
#
# ## ブリッジで立てたものも、同じ条件で畳む
#
# `--bridge` で立てたセッションがクラウドのものと違うのは、**このPCに worktree を持つ**という一点
# だけ。それは畳んでよいかの条件ではなく、畳んだ後に何を片付けるかの話なので、畳む条件からは外す。
#
# **`claude remote-control` が生きているかは見ない。** 見に行く手が無いからではなく、**どちらでも
# 答えが変わらない**から——生きていれば畳んだ相手の worktree は下の後始末で外れ、外せない形で掴んで
# いるプロセスが残っていれば `git worktree remove` が断って `DIRTY` として残る。**残る／消えるは
# 打った結果で決まるので、事前に誰かが申告する必要が無い。**
#
# **例外を、呼び手の申告で解かせない。** 渡す者が居なくなっても出るのは `KEPT` だけなので、
# **例外が外れないまま回り続けていることに誰も気づけない**（issue #1558）。
#
# ## 畳んだ相手の worktree は、ここで片付ける
#
# `archive_session` はコンテナを解放するが、**このPCの worktree はロックされたまま残る**。畳んだ
# 相手の worktree を外す者が居ないので、`git worktree list` に残骸が溜まる（2026-08-30 の時点で
# 10本のうち8本）。畳んだ本人がここで外す。
#
# 場所は規約で決まる——**本体のリポジトリ**（`--git-common-dir` は作業ツリーの中から打たれても本体を
# 指す）の `.claude/worktrees/bridge-cse_<IDから接頭辞を落としたもの>`。**`git worktree list` から
# 引かない**——登録だけが消えてディレクトリが残る形があり、一覧から引くとその形を永久に拾えない。
# クラウドのセッションには無いので、登録もディレクトリも無ければ何もしない。**自分が走っている
# worktree も外さない**——外すと足元が消える。
#
# 登録が在れば、`git worktree unlock` してから `git worktree remove`。ロックを掛けるのは
# `claude rc --spawn worktree` で、名乗るPIDは**その親のもの**（登録されているどの作業ツリーも同じ
# PIDを指す）——**そのセッションが生きていることは意味しない**ので、無条件に外す。`unlock` は中身に
# 触らないので、下の「守る」はそのまま効く。
#
# 登録が外れた後もディレクトリだけが残ることがある。そこは `rmdir` で外す——**中に何か在れば断る**
# ので、`--force` を渡さないのと同じ守りになる。
#
# 出すのは `REMOVED <パス>`。**消えなかったものは `DIRTY <パス>: <理由>` として残す**——`git worktree
# remove` は未コミットの変更や未追跡のファイルがあると断るので、`--force` は渡さない。**戻せない
# ものを黙って消すより、残骸が1つ残るほうがよい。** 理由を同じ行へ載せるのは上の「片付かなかった行
# は…」のとおりで、パスだけの行は「未コミットの変更が残っている」と読まれた（issue #1557）。
#
# ## 引けなかったものは畳まない。ただし `KEPT` とは別の行で出す
#
# 上の「守る」条件は、どれも**引けた値**で判定する。`get_session` が引けないと全部のキーが空に
# 落ち、**何も持たないもの**として扱われる——`--keep-untagged` を渡さない呼び手には、それがその
# まま畳む側へ倒れる。**知らないことを、否定として読んでいる。** 畳んで消えたコメントも、消した
# worktree も戻せないので、引けなかったものには手を出さない。
#
# **出す行は `UNKNOWN <ID>: <理由>` で、`KEPT` ではない。** `KEPT` は**畳んではいけないと分かった**
# ことで、盤面はそれを**同じ指紋のあいだ変わらない答え**として残し、次の周からその相手を渡さなく
# なる（[`board-round.mjs`](board-round.mjs) の `ARCHIVE`）。引けなかった1回をそこへ混ぜると、
# **通信が落ちたその周かぎりで、その相手が二度と畳まれなくなる。** 引けなかったのは答えではないので、
# 次の周にもう一度引く。
#
# **引けたが読めなかったぶんも、同じ行で出す。** 取り出すのは `grep` が当てた1行なので、JSONとして
# 完いとは限らない。**`jq` は偽でも読めなくても非0**なので、読めるかを確かめずに `! jq -e` でタグを
# 判定すると、**読めなかったぶんがそのまま `KEPT` に化ける**——判定を打つ前に1回だけ確かめる。

set -euo pipefail

KEEP_UNTAGGED=''
while [ $# -gt 0 ]; do
  case "$1" in
  --keep-untagged)
    KEEP_UNTAGGED="${2:?タグの接頭辞をカンマ区切りで渡す（例: task-,review-）}"
    shift
    ;;
  *)
    echo "知らない引数: $1" >&2
    exit 1
    ;;
  esac
  shift
done

# `%/*` は区切りが無いと文字列をそのまま返す。
HERE="${BASH_SOURCE[0]%/*}"
if [[ "$HERE" == "${BASH_SOURCE[0]}" ]]; then HERE='.'; fi
HERE="$(cd "$HERE" && pwd)"
# 試験は差し替える（パスで呼ぶため PATH では差し替わらない）。
CCR_META="${CCR_META:-$HERE/../../.claude/ccr-meta.sh}"

# 片付かなかったことを、打った側の言葉で出す（上の「片付かなかった行は…」）。**出力は1行1件**なので
# 改行は空白へ畳む。
unfinished() {
  echo "$1 $2: ${3//$'\n'/ }"
}

# 畳んだ相手の worktree を外す（上の「worktree は、ここで片付ける」）。
remove_worktree() {
  local session="$1" name common path here registered err
  name="bridge-cse_${session#session_}"
  common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 0
  path="$(dirname "$common")/.claude/worktrees/$name"
  if git worktree list --porcelain 2>/dev/null | grep -Fxq "worktree $path"; then
    registered=true
  else
    registered=false
  fi
  [ "$registered" = true ] || [ -d "$path" ] || return 0
  here=$(git rev-parse --show-toplevel 2>/dev/null) || true
  [ "$path" != "${here:-}" ] || return 0
  if [ "$registered" = true ]; then
    git worktree unlock "$path" >/dev/null 2>&1 || true
    if ! err=$(git worktree remove "$path" 2>&1 >/dev/null); then
      unfinished DIRTY "$path" "$err"
      return 0
    fi
  fi
  if [ -d "$path" ] && ! err=$(rmdir "$path" 2>&1); then
    unfinished DIRTY "$path" "$err"
    return 0
  fi
  echo "REMOVED $path"
}

while read -r session; do
  [ -n "$session" ] || continue
  # 応答は `<other-session>` の包みに入って返るので、中のJSONだけ取り出す。引けないときは
  # `ccr-meta.sh` が転ぶか、転ばなくても `grep` が 1 を返す。`pipefail` があるのでどちらもここで
  # 拾えるが、**理由は標準エラーに在る**——この口は標準出力が値なので、混ぜずに受ける。
  stderr=$(mktemp)
  info=$(printf '{"session_id":"%s"}' "$session" |
    bash "$CCR_META" get_session 2>"$stderr" | grep -o '{"ccr".*') || info=''
  err=$(cat "$stderr")
  # 引けなかったことは、畳まなかったことと別の行で出す（上の「引けなかったものは畳まない。ただし
  # `KEPT` とは別の行で出す」）。**何も言わずに返らなかった分も同じ行**——読む側に要るのは、状態が
  # 分かっていないことと、打った口が言ったことの全部。
  if [ -z "$info" ]; then
    unfinished UNKNOWN "$session" "${err:-素性が返らなかった}"
    rm -f "$stderr"
    continue
  fi
  # **読めることを、下の判定を打つ前に1回だけ確かめる。** 取り出したのは `grep` が当てた1行で、
  # JSONとして完いとは限らない（応答が整形されて複数行に渡れば途中で切れる）。下はどれも `jq` で
  # 引くので、読めないまま進むと**転倒が既定値（空文字・偽）に化けて、そのまま状態として読まれる**
  # ——`.ccr.session_status // ""` は「畳まれていない」へ、`jq -e` は偽と同じ非0なので `KEPT` へ。
  # ここで止めれば、下の `jq` はどれも「読めたJSONを引いている」と言える。
  if ! status=$(jq -r '.ccr.session_status // ""' <<<"$info" 2>"$stderr"); then
    unfinished UNKNOWN "$session" "$(cat "$stderr")"
    rm -f "$stderr"
    continue
  fi
  rm -f "$stderr"
  # 既に畳まれているものでも、worktree は残っていることがある。畳み直すことは無いが、後始末だけは
  # やる——**畳んだ相手を渡し直せる口はここしか無い。**
  if [ "$status" = "SESSION_STATUS_ARCHIVED" ]; then
    remove_worktree "$session"
    continue
  fi
  # 読めることは上で確かめてあるので、ここの非0は**偽**（どの接頭辞にも当たらなかった）だけ。
  if [ -n "$KEEP_UNTAGGED" ] && ! jq -e --arg prefixes "$KEEP_UNTAGGED" \
    '($prefixes | split(",")) as $ps
     | any(.ccr.tags[]?; . as $t | any($ps[]; . as $p | $t | startswith($p)))' \
    <<<"$info" >/dev/null; then
    echo "KEPT $session"
  elif err=$(printf '{"session_id":"%s"}' "$session" |
    bash "$CCR_META" archive_session 2>&1 >/dev/null); then
    echo "ARCHIVED $session"
    remove_worktree "$session"
  else
    unfinished UNARCHIVED "$session" "$err"
  fi
done
