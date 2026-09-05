#!/usr/bin/env bash
# CCRのセッションを畳む。**畳んでよいかの判定はここが持つ**——呼び手は「畳んでほしい相手」を
# 標準入力へ1行1件で渡すだけでよい。
#
#   printf '%s\n' session_A session_B | bash scripts/agent/archive-session.sh
#   printf '%s\n' session_A | bash scripts/agent/archive-session.sh --keep-working
#   printf '%s\n' session_A | bash scripts/agent/archive-session.sh --keep-untagged task-
#   printf '%s\n' session_A | bash scripts/agent/archive-session.sh --force-bridge
#
# 出力は1行1件。`ARCHIVED <ID>`、触らないと決めたものは `KEPT <ID>`、打って失敗したものは
# `UNARCHIVED <ID>`。`--force-bridge` のときは worktree の後始末も出す（`REMOVED <パス>` /
# `DIRTY <パス>`。既に畳まれているものからも出る）。それ以外に既に畳まれているものは何も出さない。
# **終了コードは常に0**——呼び手（投入・マージ）の本題は別にあるので、後片付けで落とさない。
#
# ## 判定を呼び手へ配らない
#
# 畳む経路は2つある（[`archive-reviews.sh`](archive-reviews.sh) と
# [`merge-and-close.sh`](merge-and-close.sh)）。**どのセッションを渡すかは経路ごとに違う**——前者は
# `review-` で始まるタグ、後者は `task-<番号>` のタグで選ぶ——が、**渡した後の判定は同じ**。
# 分けて持つと、3つ目の経路を足す人が同じ判定をもう一度書き足さないと壊れる。
#
# だから `get_session` はここが自分で引く。呼び手が引いたものを渡す形にすると、「どの口から引いた
# 値のどのキーを見るか」が呼び手側の知識に戻り、規約がまた散る。
#
# ## 走行中を守るかは呼び手が決める（`--keep-working`）
#
# 「**読み終えたか**」は状態では分からない（[`archive-reviews.sh`](archive-reviews.sh)「状態では
# 判定できない」）が、「**今走っているか**」は別の問いで、`session_status` が答える（見方は
# [`board-design.md`](../../.claude/board-design.md) 1.6）。`archive_session` はコンテナを解放するので、
# 判定を書いている最中のレビューを畳むと、そのコメントは出ないまま消える。
#
# **ただし除いたものは `KEPT` として残るだけで、誰かがもう一度渡さない限り二度と畳まれない。**
# だから守るのは、**その出力を読む相手がまだ居るとき**だけ——開いているPRのレビューがこれで、次の
# レビューの投入かマージのときにもう一度渡される。**マージ済みのPRのセッションは、判定を書き終えても
# 読む相手が無く、渡す出来事も二度と起きない**ので、走行中でも畳む。どちらかは呼び手が知っている。
#
# ## その仕事のために立てたものだけを畳む（`--keep-untagged <接頭辞>`）
#
# マージの後片付けで畳んでよいのは、**1つの issue のために立てたセッションだけ**（`task-<番号>` の
# タグを持つ。[`dispatch-task.sh`](dispatch-task.sh) が必ず付ける）。相談役のように issue を持たない
# 相手は、PR1本がマージされても仕事が終わっていない——畳むと、ユーザーが話している窓口ごと閉じる。
# 接頭辞で始まるタグを1つも持たないものを `KEPT` として出す。
#
# **タグで絞ってから渡す経路には要らない**（`archive-reviews.sh` は `review-` で始まるタグで引く）。
# 渡すかどうかを呼び手が決めるのは、`--keep-working` と同じ形。
#
# ## ブリッジで立てたものは、呼び手が畳んでよいと言ったときだけ畳む（`--force-bridge`）
#
# `--bridge` で立てたセッションはこのPCの環境を使うので、タグはクラウドのものと区別が付かない。
# `claude remote-control` が落ちている間にブリッジのセッションを畳むと、worktree がロックされた
# まま残る（`.claude/parallel-work.md`「終わったセッションは、issue を鍵にして畳む」）。既定では
# `environment_id`（[`ccr-env.sh`](ccr-env.sh) の `BRIDGE_ENV`）で除いて `KEPT` として出す。
#
# **`claude remote-control` が生きていることを知っているのは呼び手だけ**なので、判定ではなく引数で
# 受ける（`--keep-working` と同じ形）。渡すのは司令塔の引き継ぎ
# （[`handover.sh`](handover.sh)）で、**後継が起動できている＝生きている**。
#
# ## 畳んだブリッジのセッションは、worktree まで片付ける
#
# `archive_session` はコンテナを解放するが、**このPCの worktree はロックされたまま残る**。畳んだ
# 相手の worktree を外す者が居ないので、`git worktree list` に残骸が溜まる（2026-08-30 の時点で
# 10本のうち8本）。畳んだ本人がここで外す。
#
# 引くのは**カレントディレクトリのリポジトリ**（司令塔はリポジトリの中から打つ）。名前は
# `bridge-cse_<IDから接頭辞を落としたもの>`。クラウドのセッションには無いので、見つからなければ
# 何もしない。**自分が走っている worktree も外さない**——外すと足元が消える。
#
# 出すのは `REMOVED <パス>`。**消えなかったものは `DIRTY <パス>` として残す**——`git worktree
# remove` は未コミットの変更や未追跡のファイルがあると断るので、`--force` は渡さない。**戻せない
# ものを黙って消すより、残骸が1つ残るほうがよい。**
#
# ## 引けなかったものは畳まない
#
# 上の3つの「守る」条件は、どれも**引けた値**で判定する。`get_session` が引けないと全部のキーが
# 空に落ち、走行中でもブリッジでもないものとして畳む側へ倒れる——**知らないことを、否定として
# 読んでいる。** 畳んで消えたコメントも、ロックされたまま残る worktree も戻せないので、引けなかった
# ものは `KEPT` として出す。守って残ったものは手で畳める。

set -euo pipefail

KEEP_WORKING=0
KEEP_UNTAGGED=''
FORCE_BRIDGE=0
while [ $# -gt 0 ]; do
  case "$1" in
  --keep-working) KEEP_WORKING=1 ;;
  --force-bridge) FORCE_BRIDGE=1 ;;
  --keep-untagged)
    KEEP_UNTAGGED="${2:?タグの接頭辞を渡す（例: task-）}"
    shift
    ;;
  *)
    echo "知らない引数: $1" >&2
    exit 1
    ;;
  esac
  shift
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/agent/ccr-env.sh
source "$HERE/ccr-env.sh"
# 試験は差し替える（パスで呼ぶため PATH では差し替わらない）。
CCR_META="${CCR_META:-$HERE/../../.claude/ccr-meta.sh}"

# 畳んだ相手の worktree を外す（上の「worktree まで片付ける」）。
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
  # 既に畳まれているものでも、worktree は残っていることがある（畳む口と外す口が別だった間の
  # 残骸）。畳み直すことは無いが、後始末だけは同じ引数でやる。
  if [ "$(jq -r '.ccr.session_status // ""' <<<"$info")" = "SESSION_STATUS_ARCHIVED" ]; then
    if [ "$FORCE_BRIDGE" -eq 1 ]; then remove_worktree "$session"; fi
    continue
  fi
  # 走行中の見方は 1.6。**`..._BLOCKED` を足しているのは仮説で、実測していない**（承認待ちが
  # `RUNNING` を保つのか `IDLE` へ落ちるのかを見ていない）。落ちる場合に備えて or で残してある
  # ——外れていても `KEPT` が1本増えるだけで、書きかけのコメントは消えない。
  if [ -z "$info" ] ||
    { [ "$KEEP_WORKING" -eq 1 ] &&
    { [ "$(jq -r '.ccr.session_status // ""' <<<"$info")" = "SESSION_STATUS_RUNNING" ] ||
    [ "$(jq -r '.ccr.status_bucket // ""' <<<"$info")" = "SESSION_STATUS_BUCKET_BLOCKED" ]; }; } ||
    { [ -n "$KEEP_UNTAGGED" ] && ! jq -e --arg prefix "$KEEP_UNTAGGED" \
      '[.ccr.tags[]? | select(startswith($prefix))] | length > 0' <<<"$info" >/dev/null; } ||
    { [ "$FORCE_BRIDGE" -eq 0 ] &&
    [ "$(jq -r '.ccr.environment_id // ""' <<<"$info")" = "$BRIDGE_ENV" ]; }; then
    echo "KEPT $session"
  elif printf '{"session_id":"%s"}' "$session" | bash "$CCR_META" archive_session >/dev/null; then
    echo "ARCHIVED $session"
    remove_worktree "$session"
  else
    echo "UNARCHIVED $session"
  fi
done
