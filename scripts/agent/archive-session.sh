#!/usr/bin/env bash
# CCRのセッションを畳む。**畳んでよいかの判定はここが持つ**——呼び手は「畳んでほしい相手」を
# 標準入力へ1行1件で渡すだけでよい。
#
#   printf '%s\n' session_A session_B | bash scripts/agent/archive-session.sh
#   printf '%s\n' session_A | bash scripts/agent/archive-session.sh --keep-untagged task-,review-
#
# 出力は1行1件。`ARCHIVED <ID>`、触らないと決めたものは `KEPT <ID>`、打って失敗したものは
# `UNARCHIVED <ID>`。このPCに worktree を持つ相手には後始末の行が続く（`REMOVED <パス>` /
# `DIRTY <パス>`。既に畳まれているものからも出る）。worktree の無いものが既に畳まれていたときは
# 何も出さない。
# **終了コードは常に0**——呼び手（投入・マージ）の本題は別にあるので、後片付けで落とさない。
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
# 引くのは**カレントディレクトリのリポジトリ**（呼び手はリポジトリの中から打つ）。名前は
# `bridge-cse_<IDから接頭辞を落としたもの>`。クラウドのセッションには無いので、見つからなければ
# 何もしない。**自分が走っている worktree も外さない**——外すと足元が消える。
#
# 出すのは `REMOVED <パス>`。**消えなかったものは `DIRTY <パス>` として残す**——`git worktree
# remove` は未コミットの変更や未追跡のファイルがあると断るので、`--force` は渡さない。**戻せない
# ものを黙って消すより、残骸が1つ残るほうがよい。**
#
# ## 引けなかったものは畳まない
#
# 上の「守る」条件は、どれも**引けた値**で判定する。`get_session` が引けないと全部のキーが空に
# 落ち、**何も持たないもの**として扱われる——`--keep-untagged` を渡さない呼び手には、それがその
# まま畳む側へ倒れる。**知らないことを、否定として読んでいる。** 畳んで消えたコメントも、消した
# worktree も戻せないので、引けなかったものは `KEPT` として出す。守って残ったものは手で畳める。

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

# 畳んだ相手の worktree を外す（上の「worktree は、ここで片付ける」）。
remove_worktree() {
  local session="$1" name path here
  name="bridge-cse_${session#session_}"
  path=$(git worktree list --porcelain 2>/dev/null |
    sed -n 's|^worktree ||p' | grep -E "/${name}\$" | head -1) || true
  [ -n "$path" ] || return 0
  here=$(git rev-parse --show-toplevel 2>/dev/null) || true
  [ "$path" != "${here:-}" ] || return 0
  git worktree unlock "$path" >/dev/null 2>&1 || true
  if git worktree remove "$path" >/dev/null 2>&1; then
    echo "REMOVED $path"
  else
    echo "DIRTY $path"
  fi
}

while read -r session; do
  [ -n "$session" ] || continue
  # 応答は `<other-session>` の包みに入って返るので、中のJSONだけ取り出す。引けないときは `grep` が
  # 1 を返す。`pipefail` があるので、ここで止めずに空として受ける。
  info=$(printf '{"session_id":"%s"}' "$session" |
    bash "$CCR_META" get_session | grep -o '{"ccr".*' || true)
  # 既に畳まれているものでも、worktree は残っていることがある。畳み直すことは無いが、後始末だけは
  # やる——**畳んだ相手を渡し直せる口はここしか無い。**
  if [ "$(jq -r '.ccr.session_status // ""' <<<"$info")" = "SESSION_STATUS_ARCHIVED" ]; then
    remove_worktree "$session"
    continue
  fi
  if [ -z "$info" ] ||
    { [ -n "$KEEP_UNTAGGED" ] && ! jq -e --arg prefixes "$KEEP_UNTAGGED" \
      '($prefixes | split(",")) as $ps
       | any(.ccr.tags[]?; . as $t | any($ps[]; . as $p | $t | startswith($p)))' \
      <<<"$info" >/dev/null; }; then
    echo "KEPT $session"
  elif printf '{"session_id":"%s"}' "$session" | bash "$CCR_META" archive_session >/dev/null; then
    echo "ARCHIVED $session"
    remove_worktree "$session"
  else
    echo "UNARCHIVED $session"
  fi
done
