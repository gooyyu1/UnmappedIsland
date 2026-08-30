#!/usr/bin/env bash
# CCRのセッションを畳む。**畳んでよいかの判定はここが持つ**——呼び手は「畳んでほしい相手」を
# 標準入力へ1行1件で渡すだけでよい。
#
#   printf '%s\n' session_A session_B | bash scripts/agent/archive-session.sh
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
# ## 走っている最中のものは畳まない
#
# 「**読み終えたか**」は状態では分からない（[`archive-reviews.sh`](archive-reviews.sh)「状態では
# 判定できない」）が、「**今走っているか**」は別の問いで、`status_bucket` が答える。`archive_session`
# はコンテナを解放するので、判定を書いている最中のレビューを畳むと、そのコメントは出ないまま消える。
# 次の出来事（新しいレビューの投入・次のマージ）でもう一度渡されるので、取りこぼしにはならない。
#
# ## ブリッジで立てたものは畳まない
#
# `--bridge` で立てたセッションはこのPCの環境を使うので、タグはクラウドのものと区別が付かない。
# `claude remote-control` が落ちている間にブリッジのセッションを畳むと、worktree がロックされた
# まま残る（`.claude/parallel-work.md`「終わったセッションは、issue を鍵にして畳む」）。
# `environment_id`（[`ccr-env.sh`](ccr-env.sh) の `BRIDGE_ENV`）で除いて `KEPT` として出す。

set -euo pipefail

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
  if [ "$(jq -r '.ccr.status_bucket // ""' <<<"$info")" = "SESSION_STATUS_BUCKET_WORKING" ] ||
    [ "$(jq -r '.ccr.environment_id // ""' <<<"$info")" = "$BRIDGE_ENV" ]; then
    echo "KEPT $session"
  elif printf '{"session_id":"%s"}' "$session" | bash "$CCR_META" archive_session >/dev/null; then
    echo "ARCHIVED $session"
  else
    echo "UNARCHIVED $session"
  fi
done
