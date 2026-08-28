#!/usr/bin/env bash
# task の issue を1件、CCRのセッションへ投入して、届いたことの確認まで済ませる。
#
#   bash scripts/agent/dispatch-task.sh 1029 "$LOCALAPPDATA/Temp/ui-1029.md"
#   bash scripts/agent/dispatch-task.sh 1029 <指示ファイル> --bridge   # このPCで走らせる
#   DRY_RUN=1 bash scripts/agent/dispatch-task.sh 1029 <指示ファイル>  # 渡す引数を見るだけ
#
# 指示の本文は**先に Write でファイルへ書いておく**（ヒアドキュメントやシェル変数を通すと化ける。
# [`.claude/ccr-meta.sh`](../../.claude/ccr-meta.sh)「指示は Write で書く」）。
#
# 出力は1行1件。
#   SESSION <セッションID>
#   SOURCES <リポジトリのURL>@<リビジョン>   … 空の箱で起動していないことの確認
#   一致 / 不一致                            … 送った指示が化けずに届いたか
#   終了コード 0 … 投入できて、指示も一致した
#   終了コード 1 … どこかで失敗した（上の行がどこまで出たかで分かる）
#
# ## 畳んだのは、毎回手で組んでいたJSONと、忘れがちな2つの確認
#
# `create_session` の引数は毎回ほぼ同じなのに手で組んでいたので、**渡し忘れが事故になっていた**。
#
# - **`source_url` を渡し忘れると、リポジトリの無い `/home/user` で走り出す。** 立てた直後に
#   `get_session` で確かめるところまでを、ここに含める。
# - **`tags` を渡し忘れると、`watch-prs.sh` の `STALLED` が永久に出ない。** あちらは
#   `tags` が `task` で始まるセッションだけを見るので、タグの無いセッションは止まっても気づけない。
#   ここで必ず `task-<番号>` を付ける。
# - `environment_id` は必須（この経路には呼び元が無いので継げない）。`permission_mode` は逆に
#   渡してはいけない（親セッションを要求されて撥ねられる）。
# - **閉じた issue へ立てると、空待ちになる。** 題を引くのと同じ `gh issue view` で `state` も見る。

set -euo pipefail

ISSUE="${1:?issueの番号を渡す（例: 1029）}"
INSTRUCTION="${2:?指示のファイルのパスを渡す}"
WHERE="${3:-}"

[ -r "$INSTRUCTION" ] || {
  echo "読めない: $INSTRUCTION" >&2
  exit 1
}

# クラウドが既定。ブリッジ（このPC）はリポジトリを既に持っているので `source_url` を渡さない。
CLOUD_ENV='env_01JEqw2RUbL6EFo4p8EgRLSC'
BRIDGE_ENV='env_018uF5fo4jU3HVotrg51gqLe'
REPO_URL="https://github.com/$(gh repo view --json nameWithOwner --jq '.nameWithOwner')"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CCR_META="$HERE/../../.claude/ccr-meta.sh"
CHECK_PROMPT="$HERE/../../.claude/ccr-check-prompt.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# **日本語はシェル変数に載せない。** Windowsのnodeは argv も環境変数もANSIで受け取るので、題を
# `$(...)` で渡すと黙って化ける。題も本文もファイル経由で node へ渡す。
gh issue view "$ISSUE" --json title,state >"$WORK/issue.json"

# 閉じた issue へ立てると、セッションは「仕事は無い」と正しく判断して即終了する。PRが出ないので
# `watch-prs.sh` には何も届かず、タイムアウトまでの空待ちになる。
state=$(jq -r '.state' "$WORK/issue.json")
[ "$state" = "OPEN" ] || {
  echo "issue #$ISSUE は開いていない（state=$state）。投入しない。" >&2
  exit 1
}

node -e '
  const fs = require("node:fs");
  const [issuePath, promptPath, issue, envId, repoUrl] = process.argv.slice(1);
  const args = {
    environment_id: envId,
    title: `${JSON.parse(fs.readFileSync(issuePath, "utf8")).title.trim()} (#${issue})`,
    prompt: fs.readFileSync(promptPath, "utf8"),
    tags: [`task-${issue}`],
  };
  if (repoUrl) {
    args.source_url = repoUrl;
    args.source_revision = "main";
  }
  process.stdout.write(JSON.stringify(args));
' "$WORK/issue.json" "$INSTRUCTION" "$ISSUE" \
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
