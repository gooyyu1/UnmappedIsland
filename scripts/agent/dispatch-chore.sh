#!/usr/bin/env bash
# 周期で起きる係を1本、CCRのセッションへ投入する（`.claude/board-design.md` 2.17）。
#
#   bash scripts/agent/dispatch-chore.sh triage .claude/triage-prompt.md --bridge
#   DRY_RUN=1 bash scripts/agent/dispatch-chore.sh triage .claude/triage-prompt.md
#
# 出力と終了コードは [`dispatch-task.sh`](dispatch-task.sh) と同じ。
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
# 頭の語で種類が分かる形にする（2.9）。**日本語をシェル変数に載せない**ので、プロンプトの `題:` の
# 行から引いてファイルで node へ渡す。

set -euo pipefail

NAME="${1:?係の名前を渡す（例: triage）}"
PROMPT="${2:?プロンプトのファイルを渡す（例: .claude/triage-prompt.md）}"
WHERE="${3:-}"

# `%/*` は区切りが無いと文字列をそのまま返す。
HERE="${BASH_SOURCE[0]%/*}"
if [[ "$HERE" == "${BASH_SOURCE[0]}" ]]; then HERE='.'; fi
HERE="$(cd "$HERE" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

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

# shellcheck source=scripts/agent/ccr-env.sh
source "$HERE/ccr-env.sh"
CCR_META="$HERE/../../.claude/ccr-meta.sh"
CHECK_PROMPT="$HERE/../../.claude/ccr-check-prompt.sh"
REPO_URL="https://github.com/$(gh repo view --json nameWithOwner --jq '.nameWithOwner')"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [ "$WHERE" = "--bridge" ]; then
  ENV_ID="$BRIDGE_ENV"
  MODE="$BRIDGE_MODE"
  SOURCE=""
else
  ENV_ID="$CLOUD_ENV"
  MODE="$CLOUD_MODE"
  SOURCE="$REPO_URL"
fi

# 渡すのは囲みの中だけ（`dispatch-task.sh` と同じ形）。**最初のブロックで切る**ので、後ろに例を
# 置いても本体へ混ざらない。
INSTRUCTION="$WORK/prompt.md"
awk '/^````$/ { inside = !inside; if (!inside) exit; next } inside' "$PROMPT" >"$INSTRUCTION"
[ -s "$INSTRUCTION" ] || {
  echo "プロンプトの囲み（\`\`\`\`）が空: $PROMPT" >&2
  exit 1
}

TITLE="$WORK/title.txt"
sed -n 's/^題: *//p' "$PROMPT" | head -1 >"$TITLE"
[ -s "$TITLE" ] || {
  echo "プロンプトに \`題:\` の行が無い: $PROMPT" >&2
  exit 1
}

node -e '
  const fs = require("node:fs");
  const [titlePath, promptPath, name, envId, repoUrl, mode] = process.argv.slice(1);
  const args = {
    environment_id: envId,
    title: fs.readFileSync(titlePath, "utf8").trim(),
    prompt: fs.readFileSync(promptPath, "utf8"),
    tags: [`chore-${name}`],
  };
  if (repoUrl) {
    args.source_url = repoUrl;
    args.source_revision = "main";
  }
  if (mode) args.permission_mode = mode;
  process.stdout.write(JSON.stringify(args));
' "$TITLE" "$INSTRUCTION" "$NAME" "$ENV_ID" "$SOURCE" "$MODE" >"$WORK/args.json"

if [ -n "${DRY_RUN:-}" ]; then
  if [ "$DRY_RUN" = full ]; then
    cat "$WORK/args.json"
  else
    jq '.prompt |= (split("\n") | .[0:3] | join("\n") + "\n…")' "$WORK/args.json"
  fi
  exit 0
fi

# 手綱と占有。種類は `other`（[`brake.sh`](brake.sh) の「その他のエージェント」）。
#
# **二重に立つことを実際に止めているのは盤面**（[`board-move.mjs`](board-move.mjs) の `CYCLES`）で、
# ここが訊く占有は `--busy`——手が空いたまま残っている前の1本は塞がない。**手で叩いたときに、
# 走っている最中の1本へ重ねないため**に通す。
CCR_META="$CCR_META" bash "$HERE/may-dispatch.sh" other "chore-$NAME"

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
