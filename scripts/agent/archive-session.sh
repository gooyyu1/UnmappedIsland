#!/usr/bin/env bash
# CCRのセッションを畳む。**畳んでよいかの判定はここが持つ**——呼び手は「畳んでほしい相手」を
# 標準入力へ1行1件で渡すだけでよい。
#
#   printf '%s\n' session_A session_B | bash scripts/agent/archive-session.sh
#   printf '%s\n' session_A | bash scripts/agent/archive-session.sh --keep-working
#   printf '%s\n' session_A | bash scripts/agent/archive-session.sh --keep-untagged task-
#
# 出力は1行1件。`ARCHIVED <ID>`、触らないと決めたものは `KEPT <ID>`、打って失敗したものは
# `UNARCHIVED <ID>`。既に畳まれているものは何も出さない。**終了コードは常に0**——呼び手
# （投入・マージ）の本題は別にあるので、後片付けで落とさない。
#
# ## 判定を呼び手へ配らない
#
# 畳む経路は2つある（[`archive-reviews.sh`](archive-reviews.sh) と
# [`merge-and-close.sh`](merge-and-close.sh)）。**どのセッションを渡すかは経路ごとに違う**——前者は
# `review-<PR番号>` のタグ、後者は `task-<番号>` のタグで選ぶ——が、**渡した後の判定は同じ**。
# 分けて持つと、3つ目の経路を足す人が同じ判定をもう一度書き足さないと壊れる。
#
# だから `get_session` はここが自分で引く。呼び手が引いたものを渡す形にすると、「どの口から引いた
# 値のどのキーを見るか」が呼び手側の知識に戻り、規約がまた散る。
#
# ## 走行中を守るかは呼び手が決める（`--keep-working`）
#
# 「**読み終えたか**」は状態では分からない（[`archive-reviews.sh`](archive-reviews.sh)「状態では
# 判定できない」）が、「**今走っているか**」は別の問いで、`status_bucket` が答える。`archive_session`
# はコンテナを解放するので、判定を書いている最中のレビューを畳むと、そのコメントは出ないまま消える。
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
# **タグで絞ってから渡す経路には要らない**（`archive-reviews.sh` は `review-<PR番号>` で引く）。
# 渡すかどうかを呼び手が決めるのは、`--keep-working` と同じ形。
#
# ## ブリッジで立てたものは畳まない
#
# `--bridge` で立てたセッションはこのPCの環境を使うので、タグはクラウドのものと区別が付かない。
# `claude remote-control` が落ちている間にブリッジのセッションを畳むと、worktree がロックされた
# まま残る（`.claude/parallel-work.md`「終わったセッションは、issue を鍵にして畳む」）。
# `environment_id`（[`ccr-env.sh`](ccr-env.sh) の `BRIDGE_ENV`）で除いて `KEPT` として出す。
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
while [ $# -gt 0 ]; do
  case "$1" in
  --keep-working) KEEP_WORKING=1 ;;
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

while read -r session; do
  [ -n "$session" ] || continue
  # 応答は `<other-session>` の包みに入って返るので、中のJSONだけ取り出す。引けないときは `grep` が
  # 1 を返す。`pipefail` があるので、ここで止めずに空として受ける。
  info=$(printf '{"session_id":"%s"}' "$session" |
    bash "$CCR_META" get_session | grep -o '{"ccr".*' || true)
  [ "$(jq -r '.ccr.session_status // ""' <<<"$info")" != "SESSION_STATUS_ARCHIVED" ] || continue
  if [ -z "$info" ] ||
    { [ "$KEEP_WORKING" -eq 1 ] &&
    [ "$(jq -r '.ccr.status_bucket // ""' <<<"$info")" = "SESSION_STATUS_BUCKET_WORKING" ]; } ||
    { [ -n "$KEEP_UNTAGGED" ] && ! jq -e --arg prefix "$KEEP_UNTAGGED" \
      '[.ccr.tags[]? | select(startswith($prefix))] | length > 0' <<<"$info" >/dev/null; } ||
    [ "$(jq -r '.ccr.environment_id // ""' <<<"$info")" = "$BRIDGE_ENV" ]; then
    echo "KEPT $session"
  elif printf '{"session_id":"%s"}' "$session" | bash "$CCR_META" archive_session >/dev/null; then
    echo "ARCHIVED $session"
  else
    echo "UNARCHIVED $session"
  fi
done
