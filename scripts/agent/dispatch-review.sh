#!/usr/bin/env bash
# PRを1本、レビュー用のCCRセッションへ投入して、届いたことの確認まで済ませる。
#
#   bash scripts/agent/dispatch-review.sh 1152
#   bash scripts/agent/dispatch-review.sh 1152 --bridge   # このPCで走らせる
#   DRY_RUN=1 bash scripts/agent/dispatch-review.sh 1152  # 渡す引数を見るだけ
#
# 指示は [`.claude/review-prompt.md`](../../.claude/review-prompt.md) から読む。**補足は無い**——
# 見どころはPRごとに変わらないので、投入する側が書き足すものが無い（`dispatch-task.sh` との違いはここ）。
#
# 出力は1行1件。**前のレビューを畳むのはここではない**——盤面が毎周見て打つ
# （[`board-move.mjs`](board-move.mjs)、`board-design.md` 2.10.3）。
#   SESSION <セッションID>
#   SOURCES <リポジトリのURL>@<リビジョン>   … PRのブランチで起動していることの確認
#   一致 / 不一致                            … 送った指示が化けずに届いたか
#   終了コード 0 … 投入できて、指示も一致した
#   終了コード 1 … どこかで失敗した（上の行がどこまで出たかで分かる）
#
# ## `main` ではなくPRのブランチで起動する
#
# レビューは**差分の外**まで読む——同じ誤りの兄弟を grep で探し、名前と中身が噛み合っているかを見る。
# `main` で起動すると、その全部が「変更後のコードを見ずに」行われる。`gh pr diff` だけで済ませられる
# のは差分の中だけで、そこで止めると**差分の外を誰も読まない**——ユーザーが見るのは本文の
# `## ユーザーへ` の節と触ったファイルの一覧だけなので、レビューを1本立てた意味が無くなる。
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

REPO_URL="https://github.com/$(gh repo view --json nameWithOwner --jq '.nameWithOwner')"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/agent/ccr-env.sh
source "$HERE/ccr-env.sh"
CCR_META="$HERE/../../.claude/ccr-meta.sh"
CHECK_PROMPT="$HERE/../../.claude/ccr-check-prompt.sh"
TEMPLATE="$HERE/../../.claude/review-prompt.md"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# **立てる先が決まれば、渡すものは全部決まる**（`ccr-env.sh`）。ブリッジはリポジトリを既に持って
# いるので `source_url` を渡さず、承認モードも無指定。**クラウドで `auto` を渡さないと、差分に
# `.claude/**` が含まれるPRのレビューが、そこを読もうとした時点で承認を待って止まる**（#1567）。
if [ "$WHERE" = "--bridge" ]; then
  ENV_ID="$BRIDGE_ENV"
  MODE="$BRIDGE_MODE"
  SOURCE=""
else
  ENV_ID="$CLOUD_ENV"
  MODE="$CLOUD_MODE"
  SOURCE="$REPO_URL"
fi

RAW="$WORK/template.md"
awk '/^```$/ { inside = !inside; next } inside' "$TEMPLATE" >"$RAW"
[ -s "$RAW" ] || {
  echo "ひな形から指示を取り出せない: $TEMPLATE" >&2
  exit 1
}
INSTRUCTION="$WORK/prompt.md"

# **日本語はシェル変数に載せない。** Windowsのnodeは argv も環境変数もANSIで受け取るので、題を
# `$(...)` で渡すと黙って化ける。題も本文もファイル経由で node へ渡す。
gh pr view "$PR" --json title,state,headRefName,body,comments >"$WORK/pr.json"

# 閉じた・マージ済みのPRへ立てると、読むものが在るだけに**それらしいコメントが付いて**しまう。
state=$(jq -r '.state' "$WORK/pr.json")
[ "$state" = "OPEN" ] || {
  echo "PR #$PR は開いていない（state=$state）。投入しない。" >&2
  exit 1
}

node -e '
  const fs = require("node:fs");
  const [prPath, rawPath, promptPath, pr, envId, repoUrl, mode] = process.argv.slice(1);
  const info = JSON.parse(fs.readFileSync(prPath, "utf8"));
  // 判定のコメント（`board-design.md` 2.9）。**見分け方は `board-labels.yml` の `verdict` と同じ**
  // ——1行目が結論の文そのもの。緩めると、ラベルが付かなかったコメントで番号だけが進む。
  const verdict = /^\[レビュー\] (通してよい|直しが要る)[ \t]*$/;
  const verdicts = (info.comments ?? []).filter((c) =>
    verdict.test((c.body ?? "").split("\n")[0].replace(/\r$/, "")),
  );
  // 何回目の判定になるはずか。**数えて出すので状態を持たない。** 判定を書かずに落ちたレビューは
  // 数に入らず、次の1本が同じ番号を名乗る。
  const round = verdicts.length + 1;
  // 前の周が読んだ版（`review-prompt.md`「読んだ版」の節）。**盤面の指紋では引かない**——あちらは
  // 投入するたびに動くので、判定を書かずに落ちた周のぶんだけ進み、次の1本が読んでいない範囲を
  // 「前の周が見た」ことにしてしまう。数と版が同じコメントから出れば、その食い違いが起きない。
  const previous =
    /^読んだ版:[ \t]*([0-9a-fA-F]{7,40})[ \t]*$/m.exec(
      (verdicts.at(-1)?.body ?? "").replace(/\r/g, ""),
    )?.[1] ?? "なし";
  fs.writeFileSync(
    promptPath,
    fs.readFileSync(rawPath, "utf8").replaceAll("<番号>", pr).replaceAll("<前の版>", previous),
  );
  const args = {
    environment_id: envId,
    title: `レビュー #${pr}:${round} ${info.title.trim()}`,
    prompt: fs.readFileSync(promptPath, "utf8"),
    tags: [`review-${pr}`],
  };
  if (repoUrl) {
    args.source_url = repoUrl;
    args.source_revision = info.headRefName;
  }
  // **空なら渡さない。** 渡さないこと自体が1つの選択（`ccr-env.sh`）。
  if (mode) args.permission_mode = mode;
  process.stdout.write(JSON.stringify(args));
' "$WORK/pr.json" "$RAW" "$INSTRUCTION" "$PR" "$ENV_ID" "$SOURCE" "$MODE" >"$WORK/args.json"

# 立てずに、渡す引数だけを見る（`DRY_RUN=1 bash …`）。指示ファイルを差し替えたときの確認用なので、
# **指示は切らずに出す**——埋めた値（`<番号>`・`<前の版>`）は本文の途中に出るので、頭だけ見せると
# 確かめたいものがちょうど落ちる。
if [ -n "${DRY_RUN:-}" ]; then
  jq . "$WORK/args.json"
  exit 0
fi

# 見るのは前のレビューだけではない。**そのPRを直しているセッションが走っていたら立てない。**
# `直し待ち` のラベルは「直しが要る」しか言わず、**直している最中か誰も居ないかを区別しない**
# （[`board-design.md`](../../.claude/board-design.md) 1.3）。区別は占有の側にしか無いので、
# `Closes #N` から直す側のタグ（`task-N`）を起こして一緒に渡す。
# 脚注のセッションIDではなくタグで引くのは、**同じ issue へ2回投入されていても両方が同じタグを
# 持つ**ため。生きているほうを取り逃がさない。
#
# **同じ `Closes` から、手綱に訊く種類も決まる。** `task` ラベルの issue を閉じるPRはデーモンが
# 配った仕事で、そうでないPR（人と直接話した結果のもの）は別の系統。**読ませるかを別々に
# 切り替えられるようにする**ため、種類を分けて渡す（`board-design.md` 2.4）。
# `Closes` を書き忘れたPRも「task を持たない」側に入る——**盤面には出るが誰も読まない**ので、
# 子の手綱を外すなら本文の `Closes` が要る。
review_tags=("review-$PR")
kind=review-untasked
while read -r issue; do
  [ -n "$issue" ] || continue
  review_tags+=("task-$issue")
  if gh issue view "$issue" --json labels -q '.labels[].name' 2>/dev/null | grep -qx task; then
    kind=review
  fi
done < <(jq -r '.body // ""' "$WORK/pr.json" | tr -d '\r' |
  grep -oiE 'closes[[:space:]]+#[0-9]+' | grep -oE '[0-9]+' | sort -u || true)

# 手綱と占有。**再レビューは止まらない**——判定に使うのは走行中かどうかで、判定を書き終えた
# レビューは占有していない（[`board-design.md`](../../.claude/board-design.md) 1.2）。
CCR_META="$CCR_META" bash "$HERE/may-dispatch.sh" "$kind" "${review_tags[@]}"

# 応答は `<other-session>` の包みに入って返るので、中のJSONだけ取り出す。
session=$(bash "$CCR_META" create_session <"$WORK/args.json" | grep -o '{"ccr".*' | jq -r '.ccr.id')
[ -n "$session" ] && [ "$session" != "null" ] || {
  echo "セッションを立てられなかった" >&2
  exit 1
}
echo "SESSION $session"

if [ "$WHERE" != "--bridge" ]; then
  printf '{"session_id":"%s"}' "$session" >"$WORK/get.json"
  sources=$(bash "$CCR_META" get_session <"$WORK/get.json" | grep -o '{"ccr".*' |
    jq -r '.ccr.session_context.sources[]?.git_repository | "\(.url)@\(.revision)"')
  [ -n "$sources" ] || {
    echo "リポジトリが入っていない（空の箱で起動している）。畳んで立て直す。" >&2
    exit 1
  }
  echo "SOURCES $sources"
fi

bash "$CHECK_PROMPT" "$session" "$INSTRUCTION"
