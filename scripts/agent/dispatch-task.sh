#!/usr/bin/env bash
# `kind:task` の issue を1件、CCRのセッションへ投入して、届いたことの確認まで済ませる。
#
#   bash scripts/agent/dispatch-task.sh 1029 "$LOCALAPPDATA/Temp/ui-1029.md"
#   bash scripts/agent/dispatch-task.sh 1029 <補足ファイル> --bridge   # このPCで走らせる
#   DRY_RUN=1 bash scripts/agent/dispatch-task.sh 1029 <補足ファイル>     # 渡す引数を見るだけ
#   DRY_RUN=full bash scripts/agent/dispatch-task.sh 1029 <補足ファイル>  # 指示の本文も切らずに出す
#
# **渡すのは補足だけ。** 共通のひな形（[`agent-ops/prompts/dispatch-prompt.md`](../../agent-ops/prompts/dispatch-prompt.md)）は
# ここで読んで前へ付ける。ひな形自身が「手で書き写すと必ず何かが落ちる」と書いているものを、
# 投入のたびに投入する側へ書き写させていた。
#
# 補足は**先に Write でファイルへ書いておく**（区切りを引用しないヒアドキュメントへ載せると、
# バッククォートで囲んだ識別子がコマンドとして実行されて消える。
# [`.claude/ccr-meta.sh`](../../.claude/ccr-meta.sh)「指示は Write で書く」）。**書くことが無いなら、
# 空のファイルでよい。**
#
# 出す行は [`dispatch-steps.sh`](dispatch-steps.sh) の `dispatch_session`。
#   終了コード 0 … 投入できて、指示も一致した
#   終了コード 3 … 人が手綱で止めている（[`brake.sh`](brake.sh)）
#   終了コード 1 … それ以外で失敗した（出た行がどこまで進んだかを示す）
#
# ## 畳んだのは、毎回手で組んでいたJSONと、忘れがちな確認
#
# `create_session` の引数は毎回ほぼ同じなのに手で組んでいたので、**渡し忘れが事故になっていた**。
#
# - **`source_url` を渡し忘れると、リポジトリの無い `/home/user` で走り出す。** 立てた直後に
#   `get_session` で確かめるところまでを、投入の段取り（[`dispatch-steps.sh`](dispatch-steps.sh)）が
#   持つ。
# - **`tags` を渡し忘れると、盤面から見えないセッションになる。** デーモンが占有も止まりも読むのは
#   `task-<番号>` のタグからなので、タグの無いセッションは二重投入も空回りも防げない。
# - `environment_id` と `permission_mode` は必須（この経路には呼び元が無いので継げない）。
#   **どちらも投入先で決まる**ので、[`dispatch-steps.sh`](dispatch-steps.sh) の `choose_target` から
#   取る。`permission_mode` は空のことがあり、**そのときは渡さない**（それがブリッジの選び方）。
# - **閉じた issue へ立てると、空待ちになる。** 題を引くのと同じ `gh issue view` で `state` も見る。

set -euo pipefail

ISSUE="${1:?issueの番号を渡す（例: 1029）}"
SUPPLEMENT="${2:?補足のファイルのパスを渡す}"
WHERE="${3:-}"

[ -r "$SUPPLEMENT" ] || {
  echo "読めない: $SUPPLEMENT" >&2
  exit 1
}

# shellcheck source=scripts/agent/dispatch-steps.sh
source "$(dirname "${BASH_SOURCE[0]}")/dispatch-steps.sh"
TEMPLATE="$AGENT_DIR/../../agent-ops/prompts/dispatch-prompt.md"

choose_target "$WHERE"

# ここで `dispatch-prompt.md` の囲みの中を読み、`<番号>` を埋めて、渡された補足を末尾へ足す。
# 投入する側が書くのは補足だけ。
INSTRUCTION="$WORK/prompt.md"
template_body "$TEMPLATE" "$INSTRUCTION"
sed -i "s/<番号>/$ISSUE/g" "$INSTRUCTION"
# ひな形の最後の行は補足の置き場を説明する山括弧なので、補足そのものへ差し替える。
grep -q '^<このタスク固有の補足' "$INSTRUCTION" || {
  echo "ひな形から補足の置き場が消えている: $TEMPLATE" >&2
  exit 1
}
sed -i '/^<このタスク固有の補足/,$d' "$INSTRUCTION"
cat "$SUPPLEMENT" >>"$INSTRUCTION"

# **題も本文もシェルの文字列にしない。** gh の出力はファイルへ落とし、JSONの組み立ては node に
# やらせる。危ないのは文字の符号ではなく**シェルの展開**なので、構文ごとに載せてよいかを判断せず、
# 載せないほうを決めておく（[`.claude/ccr-meta.sh`](../../.claude/ccr-meta.sh)「指示は Write で書く」）。
gh issue view "$ISSUE" --json title,state,labels >"$WORK/issue.json"

# 閉じた issue へ立てると、セッションは「仕事は無い」と正しく判断して即終了する。PRが出ないまま
# 生き続けるので、盤面からは「投入済みで、まだ書いている」と見える。
state=$(jq -r '.state' "$WORK/issue.json")
[ "$state" = "OPEN" ] || {
  echo "issue #$ISSUE は開いていない（state=$state）。投入しない。" >&2
  exit 1
}

# 人へ返された issue は、人が答えるまで配らない（2.15）。**`kind:task` は付いたままなので、この判定が
# 無ければ次の周にそのまま投入し直される**——返した意味が消えて、同じところで止まる相手が増える。
# 不変条件は投入する側が持つ（1.4）ので、盤面だけでなくここでも見る。
if jq -r '[.labels[].name] | join("\n")' "$WORK/issue.json" | grep -qxF 判断待ち; then
  echo "issue #$ISSUE は人へ返されている（判断待ち）。投入しない。" >&2
  exit 1
fi

# その issue を閉じるPRが既に開いていないか。**生きているセッションは下の `may-dispatch.sh` が
# 塞ぐが、畳まれた後にPRだけ残っている場合は素通りする**——#1415 は同じ issue が2本へ渡り、
# 両方が独立に同じ設計へ到達して、片方が push する瞬間のブランチ名の衝突で気づいた。
#
# **ブランチ名では見ない。** `claude/issue-1488` と `claude/homesickness-1412` のように綴りが
# 揃っておらず、番号から引き当てられない。
existing=$(gh pr list --state open --limit 50 --json number,body |
  jq -r --arg issue "$ISSUE" \
    '.[] | select(.body // "" | test("closes\\s+#" + $issue + "(\\D|$)"; "i")) | .number')
[ -z "$existing" ] || {
  echo "issue #$ISSUE を閉じるPRが既に開いている。投入しない。" >&2
  echo "$existing" | sed 's/^/  PR #/' >&2
  # **直す相手のセッションが畳まれたPR**（`board-move.mjs` が `覚え書き:` で出す）を立て直したい
  # ときも、ここで止まる。逃げ道は付けない——**そのPRを閉じてから投入し直す**のが、2本目のPRを
  # 増やさない唯一の形。
  echo "  立て直すなら、そのPRを閉じてから叩き直す。" >&2
  exit 1
}

# 手綱と占有。**立ててよいかの判定は [`may-dispatch.sh`](may-dispatch.sh) が持つ**ので、ここは
# 種類とタグを渡すだけ。**訊くタグと、セッションへ付けるタグは同じ変数から出す**——別の文字列を
# 見に行くと、判定は通るのに二重に立つ。
TAG="task-$ISSUE"

dispatch_session new-task "$TAG" -- \
  task --tag "$TAG" --issue "$ISSUE" --issue-json "$WORK/issue.json" --prompt "$INSTRUCTION"
