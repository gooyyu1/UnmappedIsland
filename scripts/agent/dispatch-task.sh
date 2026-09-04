#!/usr/bin/env bash
# task の issue を1件、CCRのセッションへ投入して、届いたことの確認まで済ませる。
#
#   bash scripts/agent/dispatch-task.sh 1029 "$LOCALAPPDATA/Temp/ui-1029.md"
#   bash scripts/agent/dispatch-task.sh 1029 <補足ファイル> --bridge   # このPCで走らせる
#   DRY_RUN=1 bash scripts/agent/dispatch-task.sh 1029 <補足ファイル>  # 渡す引数を見るだけ
#
# **渡すのは補足だけ。** 共通のひな形（[`.claude/dispatch-prompt.md`](../../.claude/dispatch-prompt.md)）は
# ここで読んで前へ付ける。ひな形自身が「手で書き写すと必ず何かが落ちる」と書いているものを、
# 投入のたびに司令塔へ書き写させていた。
#
# 補足は**先に Write でファイルへ書いておく**（ヒアドキュメントやシェル変数を通すと化ける。
# [`.claude/ccr-meta.sh`](../../.claude/ccr-meta.sh)「指示は Write で書く」）。**重なりが無くて
# 書くことが無いなら、空のファイルでよい。**
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
# - **`## 担当` に、セッションが触れない領域が挙がっていないかを見る。** ひな形・司令塔の道具・運用の
#   文書は司令塔が `main` へ直接入れる領域で、セッションからは編集ツールが拒否される。気づかずに
#   投入すると壁に当たり、往復が1回まるごと無駄になる（2026-08-30・#1398。担当に
#   `.claude/parallel-work.md` が載ったまま投入し、セッションは拒否された経路を回避して書き込む
#   ところまで行った）。**同じ `gh issue view` で `body` も引く**ので、往復は増えない。

set -euo pipefail

ISSUE="${1:?issueの番号を渡す（例: 1029）}"
SUPPLEMENT="${2:?補足のファイルのパスを渡す}"
WHERE="${3:-}"

[ -r "$SUPPLEMENT" ] || {
  echo "読めない: $SUPPLEMENT" >&2
  exit 1
}

REPO_URL="https://github.com/$(gh repo view --json nameWithOwner --jq '.nameWithOwner')"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/agent/ccr-env.sh
source "$HERE/ccr-env.sh"
CCR_META="$HERE/../../.claude/ccr-meta.sh"
CHECK_PROMPT="$HERE/../../.claude/ccr-check-prompt.sh"
TEMPLATE="$HERE/../../.claude/dispatch-prompt.md"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ひな形は司令塔が書き写さない。**書き写すと必ず何かが落ちる**——2026-08-27 に「PRを見張らない」の
# 一文が3本すべてから抜け、3セッションが承認待ちで止まった。ここで `dispatch-prompt.md` の
# ``` の中を読み、`<番号>` を埋めて、渡された補足を末尾へ足す。司令塔が書くのは補足だけ。
INSTRUCTION="$WORK/prompt.md"
awk '/^```$/ { inside = !inside; next } inside' "$TEMPLATE" |
  sed "s/<番号>/$ISSUE/g" >"$INSTRUCTION"
# ひな形の最後の行は補足の置き場を説明する山括弧なので、補足そのものへ差し替える。
grep -q '^<このタスク固有の補足' "$INSTRUCTION" || {
  echo "ひな形から補足の置き場が消えている: $TEMPLATE" >&2
  exit 1
}
sed -i '/^<このタスク固有の補足/,$d' "$INSTRUCTION"
cat "$SUPPLEMENT" >>"$INSTRUCTION"

# **日本語はシェル変数に載せない。** Windowsのnodeは argv も環境変数もANSIで受け取るので、題を
# `$(...)` で渡すと黙って化ける。題も本文もファイル経由で node へ渡す。
gh issue view "$ISSUE" --json title,state,body >"$WORK/issue.json"

# 閉じた issue へ立てると、セッションは「仕事は無い」と正しく判断して即終了する。PRが出ないので
# `watch-prs.sh` には何も届かず、タイムアウトまでの空待ちになる。
state=$(jq -r '.state' "$WORK/issue.json")
[ "$state" = "OPEN" ] || {
  echo "issue #$ISSUE は開いていない（state=$state）。投入しない。" >&2
  exit 1
}

# `## 担当` に、セッションが書けない領域が挙がっていないか。`.claude/**` はクラウドセッションからの
# 書き込みが必ずユーザー承認を求められ、そこで止まる。`scripts/agent/**` と `CLAUDE.md` は司令塔が
# `main` へ直接入れる領域。どれも投入した時点で往復が1回無駄になる。
owned=$(jq -r '.body' "$WORK/issue.json" | tr -d '\r' |
  awk '/^##[[:space:]]/ { inside = /^##[[:space:]]+担当[[:space:]]*$/; next } inside' |
  grep -oE '(\.claude/[^`)[:space:]]*|scripts/agent/[^`)[:space:]]*|CLAUDE\.md)' | sort -u || true)
[ -z "$owned" ] || {
  echo "issue #$ISSUE の「担当」に、セッションが書けない領域が挙がっている。投入しない。" >&2
  echo "$owned" | sed 's/^/  /' >&2
  echo '  司令塔が `main` へ直接入れる領域（.claude/parallel-work.md「司令塔の手入れは main へ直接 push する」）。' >&2
  echo '  司令塔が先に入れて担当から外すか、issue を割ってから投入する。' >&2
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

# 手綱と占有。**立ててよいかの判定は [`may-dispatch.sh`](may-dispatch.sh) が持つ**ので、ここは
# 種類とタグを渡すだけ。タグは下の `create_session` へ渡すものと同じ文字列であること——**別の
# 文字列を見に行くと、判定は通るのに二重に立つ。**
CCR_META="$CCR_META" bash "$HERE/may-dispatch.sh" new-task "task-$ISSUE"

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
