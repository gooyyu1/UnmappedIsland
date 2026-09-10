#!/usr/bin/env bash
# PRを1本、レビュー用のCCRセッションへ投入して、届いたことの確認まで済ませる。
#
#   bash scripts/agent/dispatch-review.sh 1152
#   bash scripts/agent/dispatch-review.sh 1152 --bridge   # このPCで走らせる
#   DRY_RUN=1 bash scripts/agent/dispatch-review.sh 1152     # 渡す引数を見るだけ
#   DRY_RUN=full bash scripts/agent/dispatch-review.sh 1152  # 指示の本文も切らずに出す
#
# 指示は [`.claude/review-prompt.md`](../../.claude/review-prompt.md) から読む。**補足は無い**——
# 見どころはPRごとに変わらないので、投入する側が書き足すものが無い（`dispatch-task.sh` との違いはここ）。
#
# **前のレビューを畳むのはここではない**——盤面が毎周見て打つ
# （[`board-move.mjs`](board-move.mjs)、`board-design.md` 2.10.3）。
#
# 出す行は [`dispatch-steps.sh`](dispatch-steps.sh) の `dispatch_session`。`SOURCES` が出す
# リビジョンは、下の「`main` ではなくPRのブランチで起動する」のとおりPRのブランチ。
#   終了コード 0 … 投入できて、指示も一致した
#   終了コード 1 … どこかで失敗した（出た行がどこまで進んだかを示す）
#
# ## `main` ではなくPRのブランチで起動する
#
# レビューは**差分の外**まで読む——同じ誤りの兄弟を grep で探し、名前と中身が噛み合っているかを見る。
# `main` で起動すると、その全部が「変更後のコードを見ずに」行われる。`gh pr diff` だけで済ませられる
# のは差分の中だけで、そこで止めると**差分の外を誰も読まない**——盤面が読むのは本文の節と触った
# ファイルの一覧だけなので、レビューを1本立てた意味が無くなる。
#
# ## 再レビューでも、前のセッションを起こさずに新しく立てる
#
# このスクリプトに使い回しの経路が無いのは意図。直す側（`dispatch-task.sh` で立てたセッション）は
# `send_message` で起こして使い回すが、レビュー側は逆にする。直しは「指摘された行を直す」ではなく
# 「原則として受け取って兄弟も直す」（`CLAUDE.md` 5節）なので、**2回目のヘッドは1回目とは別物**。
# 自分の出した判定を自分で再判定すると「言ったことが直っているか」だけを見る方向に寄り、**直しが
# 新しく壊したものが誰にも読まれない**——2026-08-29 の PR #1191 で、2回目のレビューが前回の3件を
# 確かめたうえで前回は見ていなかった箇所の嘘を見つけた。読み直しの費用は、この読み直しそのもの。
#
# ## 結果は `send_message` ではなくPRのコメント
#
# コメントの1行目から `board-labels.yml` が結論のラベルを付けるので、**投入した側は返事を待たない。**
# レビューのセッションを覚えておく必要も無い。**タグは `review-` で始める**——`task-` で始めると
# デーモンが「PRを出さないまま止まっている」と読み、レビューのセッションを毎周起こしに行く
# （[`board-move.mjs`](board-move.mjs)）。

set -euo pipefail

PR="${1:?PRの番号を渡す（例: 1152）}"
WHERE="${2:-}"

# shellcheck source=scripts/agent/dispatch-steps.sh
source "$(dirname "${BASH_SOURCE[0]}")/dispatch-steps.sh"
TEMPLATE="$AGENT_DIR/../../.claude/review-prompt.md"

choose_target "$WHERE"

RAW="$WORK/template.md"
template_body "$TEMPLATE" "$RAW"
INSTRUCTION="$WORK/prompt.md"

# **題も本文もシェルの文字列にしない。** gh の出力はファイルへ落とし、JSONの組み立ては node に
# やらせる。危ないのは文字の符号ではなく**シェルの展開**なので、構文ごとに載せてよいかを判断せず、
# 載せないほうを決めておく（[`.claude/ccr-meta.sh`](../../.claude/ccr-meta.sh)「指示は Write で書く」）。
gh pr view "$PR" --json title,state,headRefName,body,comments >"$WORK/pr.json"

# 閉じた・マージ済みのPRへ立てると、読むものが在るだけに**それらしいコメントが付いて**しまう。
state=$(jq -r '.state' "$WORK/pr.json")
[ "$state" = "OPEN" ] || {
  echo "PR #$PR は開いていない（state=$state）。投入しない。" >&2
  exit 1
}

# 何回目の判定か・前の周が読んだ版・送る本文の組み立ては
# [`dispatch-session.mjs`](dispatch-session.mjs) の `review`。**埋めた値（`<番号>`・`<前の版>`）を
# 確かめるなら `DRY_RUN=full`**——本文の途中に出るので、切ったほうではちょうど落ちる
# （[`dispatch-steps.sh`](dispatch-steps.sh)）。
#
# 見るのは前のレビューだけではない。**そのPRを直しているセッションが走っていたら立てない。**
# `直し待ち` のラベルは「直しが要る」しか言わず、**直している最中か誰も居ないかを区別しない**
# （[`board-design.md`](../../.claude/board-design.md) 1.3）。区別は占有の側にしか無いので、
# `Closes #N` から直す側のタグ（`task-N`）を起こして一緒に渡す。
# 脚注のセッションIDではなくタグで引くのは、**同じ issue へ2回投入されていても両方が同じタグを
# 持つ**ため。生きているほうを取り逃がさない。
#
# **同じ `Closes` から、手綱に訊く種類も決まる。** `kind:task` の issue を閉じるPRはデーモンが
# 配った仕事で、そうでないPR（人と直接話した結果のもの）は別の系統。**読ませるかを別々に
# 切り替えられるようにする**ため、種類を分けて渡す（`board-design.md` 2.4）。
# `Closes` を書き忘れたPRも「task を持たない」側に入る——**盤面には出るが誰も読まない**ので、
# 子の手綱を外すなら本文の `Closes` が要る。
#
# **本文の `\r` は落とさない**——受けるのが `grep -o` だけで、抜き出すのは数字なので入らない
# （[`tidy-merged-pr.sh`](tidy-merged-pr.sh) の「`\r` を落とす側と落とさない側」）。
TAG="review-$PR"
review_tags=("$TAG")
kind=review-untasked
while read -r issue; do
  [ -n "$issue" ] || continue
  review_tags+=("task-$issue")
  if gh issue view "$issue" --json labels -q '.labels[].name' 2>/dev/null | grep -qx kind:task; then
    kind=review
  fi
done < <(jq -r '.body // ""' "$WORK/pr.json" |
  grep -oiE 'closes[[:space:]]+#[0-9]+' | grep -oE '[0-9]+' | sort -u || true)

# 手綱と占有。**再レビューは止まらない**——判定に使うのは走行中かどうかで、判定を書き終えた
# レビューは占有していない（[`board-design.md`](../../.claude/board-design.md) 1.2）。
dispatch_session "$kind" "${review_tags[@]}" -- \
  review --tag "$TAG" --pr "$PR" --pr-json "$WORK/pr.json" --template "$RAW" --prompt "$INSTRUCTION"
