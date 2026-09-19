#!/usr/bin/env bash
# 周期で起きる係を1本、CCRのセッションへ投入する（`agent-ops/board-design.md` 2.17）。
#
#   bash scripts/daemon/dispatch-chore.sh triage agent-ops/prompts/triage-prompt.md
#   bash scripts/daemon/dispatch-chore.sh triage agent-ops/prompts/triage-prompt.md --bridge  # このPCで走らせる
#   bash scripts/daemon/dispatch-chore.sh values /tmp/…/values-prompt.md --gate values  # 手綱へ訊く種類を変える
#   DRY_RUN=1 bash scripts/daemon/dispatch-chore.sh triage agent-ops/prompts/triage-prompt.md
#   DRY_RUN=full bash scripts/daemon/dispatch-chore.sh triage agent-ops/prompts/triage-prompt.md  # 本文も切らない
#
# 出す行は [`dispatch-steps.sh`](dispatch-steps.sh) の `dispatch_session`。終了コードの
# 読み方は [`dispatch-task.sh`](dispatch-task.sh) と同じ。
#
# ## `dispatch-task.sh` と別なのは、渡すものが issue ではないから
#
# あちらが渡すのは**担当の issue 1件**で、題も本文も投入する条件（開いているか・`判断待ち` か・
# 閉じるPRが既にあるか）も、全部その issue から出る。**周期の係には issue が無い**——仕事の在り処は
# プロンプトが自分で書いてあり、成果もPRではない。**条件を持たない側へ、持つ側のひな形を通すと、
# 通らない条件を毎回すり抜けさせることになる。**
#
# ## 題はプロンプトが名乗る
#
# 頭の語で種類が分かる形にする（2.9）。**題をシェルの文字列にしない**ので、プロンプトの `題:` の
# 行から引いてファイルで node へ渡す。
#
# ## 手綱へ訊く種類は、渡された側が選べる（`--gate`）
#
# **どの鎖を訊くかを決めるのは投入するスクリプト自身**（`agent-ops/board-design.md` 2.4.2。
# [`dispatch-review.sh`](dispatch-review.sh) が `Closes` 先のラベルで `review` と `review-untasked` を
# 選ぶのと同じ）。周期の係は既定で `other` だが、**値の死を告げに行く1本だけ `values`**
# ——手綱を読む手が `gh` そのもので、あの投入が通るのは `gh` が死んでいる周だけだから
# （[`brake.sh`](brake.sh)「読めない周に止まらない種類が1つある」）。**変わるのは読めない周の倒れる
# 向きだけ**で、余力も占有も他の種類と同じものを通る。

set -euo pipefail

NAME="${1:?係の名前を渡す（例: triage）}"
PROMPT="${2:?プロンプトのファイルを渡す（例: agent-ops/prompts/triage-prompt.md）}"
shift 2

WHERE=''
GATE='other'
while [ "$#" -gt 0 ]; do
  case "$1" in
  --bridge) WHERE='--bridge' ;;
  --gate)
    GATE="${2:?--gate には手綱の種類を渡す（例: values）}"
    shift
    ;;
  *)
    echo "知らない引数: $1" >&2
    exit 1
    ;;
  esac
  shift
done

# shellcheck source=scripts/daemon/dispatch-steps.sh
source "$(dirname "${BASH_SOURCE[0]}")/dispatch-steps.sh"
ROOT="$(cd "$DAEMON_DIR/../.." && pwd)"

# **プロンプトはリポジトリからの相対で受ける。** 盤面が持っているのは `CYCLES` に書いた綴りだけで、
# デーモンがどこから叩かれるかは知らない。
case "$PROMPT" in
/* | ?:*) ;;
*) PROMPT="$ROOT/$PROMPT" ;;
esac
[ -r "$PROMPT" ] || {
  echo "読めない: $PROMPT" >&2
  exit 1
}

choose_target "$WHERE"

INSTRUCTION="$WORK/prompt.md"
template_body "$PROMPT" "$INSTRUCTION"

TITLE="$WORK/title.txt"
template_title "$PROMPT" "$TITLE"

# 手綱と占有。種類は既定で `other`（[`brake.sh`](brake.sh) の「その他のエージェント」）で、`--gate` を
# 渡された周だけそちら（上の「手綱へ訊く種類は」）。
#
# **二重に立つことを実際に止めているのは盤面**（[`board-move.mjs`](board-move.mjs) の `CYCLES`）で、
# ここが訊く占有は `--busy`——手が空いたまま残っている前の1本は塞がない。**手で叩いたときに、
# 走っている最中の1本へ重ねないため**に通す。
TAG="chore-$NAME"

dispatch_session "$GATE" "$TAG" -- chore --tag "$TAG" --title "$TITLE" --prompt "$INSTRUCTION"
