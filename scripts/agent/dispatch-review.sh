#!/usr/bin/env bash
# PRを1本、レビュー用のCCRセッションへ投入して、届いたことの確認まで済ませる。
#
#   bash scripts/agent/dispatch-review.sh 1152
#   bash scripts/agent/dispatch-review.sh 1152 --bridge   # このPCで走らせる
#   DRY_RUN=1 bash scripts/agent/dispatch-review.sh 1152  # 渡す引数を見るだけ
#
# 指示は [`.claude/review-prompt.md`](../../.claude/review-prompt.md) から読む。**補足は無い**——
# 見どころはPRごとに変わらないので、司令塔が書き足すものが無い（`dispatch-task.sh` との違いはここ）。
#
# 出力は1行1件。
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
# のは差分の中だけで、そこで止めると**差分の外を誰も読まない**——司令塔が見るのは `## 仮決め` と
# 触ったファイルの一覧だけなので、レビューを1本立てた意味が無くなる。
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
# コメントなら `watch-prs.sh` の `REVIEWED` が拾うので、**司令塔は今までどおり見張るだけでよい。**
# レビューのセッションを覚えておく必要も、返事を待つ必要も無い。**タグは `review-` で始める**——
# `task` で始めると `STALLED` の対象になり、PRを出さないレビューのセッションが毎周「止まっている」
# として出続ける。

set -euo pipefail

PR="${1:?PRの番号を渡す（例: 1152）}"
WHERE="${2:-}"

# クラウドが既定。ブリッジ（このPC）はリポジトリを既に持っているので `source_url` を渡さない。
CLOUD_ENV='env_01JEqw2RUbL6EFo4p8EgRLSC'
BRIDGE_ENV='env_018uF5fo4jU3HVotrg51gqLe'
REPO_URL="https://github.com/$(gh repo view --json nameWithOwner --jq '.nameWithOwner')"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CCR_META="$HERE/../../.claude/ccr-meta.sh"
CHECK_PROMPT="$HERE/../../.claude/ccr-check-prompt.sh"
TEMPLATE="$HERE/../../.claude/review-prompt.md"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

INSTRUCTION="$WORK/prompt.md"
awk '/^```$/ { inside = !inside; next } inside' "$TEMPLATE" |
  sed "s/<番号>/$PR/g" >"$INSTRUCTION"
[ -s "$INSTRUCTION" ] || {
  echo "ひな形から指示を取り出せない: $TEMPLATE" >&2
  exit 1
}

# **日本語はシェル変数に載せない。** Windowsのnodeは argv も環境変数もANSIで受け取るので、題を
# `$(...)` で渡すと黙って化ける。題も本文もファイル経由で node へ渡す。
gh pr view "$PR" --json title,state,headRefName >"$WORK/pr.json"

# 閉じた・マージ済みのPRへ立てると、読むものが在るだけに**それらしいコメントが付いて**しまう。
state=$(jq -r '.state' "$WORK/pr.json")
[ "$state" = "OPEN" ] || {
  echo "PR #$PR は開いていない（state=$state）。投入しない。" >&2
  exit 1
}

node -e '
  const fs = require("node:fs");
  const [prPath, promptPath, pr, envId, repoUrl] = process.argv.slice(1);
  const info = JSON.parse(fs.readFileSync(prPath, "utf8"));
  const args = {
    environment_id: envId,
    title: `レビュー: ${info.title.trim()} (PR #${pr})`,
    prompt: fs.readFileSync(promptPath, "utf8"),
    tags: [`review-${pr}`],
  };
  if (repoUrl) {
    args.source_url = repoUrl;
    args.source_revision = info.headRefName;
  }
  process.stdout.write(JSON.stringify(args));
' "$WORK/pr.json" "$INSTRUCTION" "$PR" \
  "$([ "$WHERE" = "--bridge" ] && echo "$BRIDGE_ENV" || echo "$CLOUD_ENV")" \
  "$([ "$WHERE" = "--bridge" ] || echo "$REPO_URL")" >"$WORK/args.json"

# 立てずに、渡す引数だけを見る（`DRY_RUN=1 bash …`）。指示ファイルを差し替えたときの確認用。
if [ -n "${DRY_RUN:-}" ]; then
  jq '.prompt |= (split("\n") | .[0:3] | join("\n") + "\n…")' "$WORK/args.json"
  exit 0
fi

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
