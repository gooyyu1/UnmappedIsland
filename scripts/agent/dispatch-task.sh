#!/usr/bin/env bash
# task の issue を1件、CCRのセッションへ投入して、届いたことの確認まで済ませる。
#
#   bash scripts/agent/dispatch-task.sh 1029 "$LOCALAPPDATA/Temp/ui-1029.md"
#   bash scripts/agent/dispatch-task.sh 1029 <補足ファイル> --bridge   # このPCで走らせる
#   DRY_RUN=1 bash scripts/agent/dispatch-task.sh 1029 <補足ファイル>     # 渡す引数を見るだけ
#   DRY_RUN=full bash scripts/agent/dispatch-task.sh 1029 <補足ファイル>  # 指示の本文も切らずに出す
#
# **渡すのは補足だけ。** 共通のひな形（[`.claude/dispatch-prompt.md`](../../.claude/dispatch-prompt.md)）は
# ここで読んで前へ付ける。ひな形自身が「手で書き写すと必ず何かが落ちる」と書いているものを、
# 投入のたびに投入する側へ書き写させていた。
#
# 補足は**先に Write でファイルへ書いておく**（ヒアドキュメントやシェル変数を通すと化ける。
# [`.claude/ccr-meta.sh`](../../.claude/ccr-meta.sh)「指示は Write で書く」）。**書くことが無いなら、
# 空のファイルでよい。**
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
# - **`tags` を渡し忘れると、盤面から見えないセッションになる。** デーモンが占有も止まりも読むのは
#   `task-<番号>` のタグからなので、タグの無いセッションは二重投入も空回りも防げない。
# - `environment_id` と `permission_mode` は必須（この経路には呼び元が無いので継げない）。
#   **どちらも投入先で決まる**ので、[`ccr-env.sh`](ccr-env.sh) から取って下の分岐で選ぶ。
#   `permission_mode` は空のことがあり、**そのときは渡さない**（それがブリッジの選び方）。
# - **閉じた issue へ立てると、空待ちになる。** 題を引くのと同じ `gh issue view` で `state` も見る。

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

# **立てる先が決まれば、渡すものは全部決まる**（`ccr-env.sh`）。ブリッジはリポジトリを既に持って
# いるので `source_url` を渡さず、承認モードも無指定（[`ccr-env.sh`](ccr-env.sh)）。
# **渡す文面は投入先で変わらない**（`.claude/dispatch-prompt.md`「走る場所で文面を変えない」）。
if [ "$WHERE" = "--bridge" ]; then
  ENV_ID="$BRIDGE_ENV"
  MODE="$BRIDGE_MODE"
  SOURCE=""
else
  ENV_ID="$CLOUD_ENV"
  MODE="$CLOUD_MODE"
  SOURCE="$REPO_URL"
fi

# ひな形は手で書き写さない。**書き写すと必ず何かが落ちる**——2026-08-27 に「PRを見張らない」の
# 一文が3本すべてから抜け、3セッションが承認待ちで止まった。ここで `dispatch-prompt.md` の
# ``` の中を読み、`<番号>` を埋めて、渡された補足を末尾へ足す。投入する側が書くのは補足だけ。
INSTRUCTION="$WORK/prompt.md"
# **読むのは最初のブロックだけ**（`exit`）。ひな形の説明が後ろで例を挙げても、本体へ混ざらない。
awk '/^```$/ { inside = !inside; if (!inside) exit; next } inside' "$TEMPLATE" |
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
gh issue view "$ISSUE" --json title,state,labels >"$WORK/issue.json"

# 閉じた issue へ立てると、セッションは「仕事は無い」と正しく判断して即終了する。PRが出ないまま
# 生き続けるので、盤面からは「投入済みで、まだ書いている」と見える。
state=$(jq -r '.state' "$WORK/issue.json")
[ "$state" = "OPEN" ] || {
  echo "issue #$ISSUE は開いていない（state=$state）。投入しない。" >&2
  exit 1
}

# 人へ返された issue は、人が答えるまで配らない（2.15）。**`task` は付いたままなので、この判定が
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

node -e '
  const fs = require("node:fs");
  const [issuePath, promptPath, issue, envId, repoUrl, mode] = process.argv.slice(1);
  const args = {
    environment_id: envId,
    // 頭の語で種類が分かる形（`board-design.md` 2.9）。
    title: `作業 #${issue} ${JSON.parse(fs.readFileSync(issuePath, "utf8")).title.trim()}`,
    prompt: fs.readFileSync(promptPath, "utf8"),
    tags: [`task-${issue}`],
  };
  if (repoUrl) {
    args.source_url = repoUrl;
    args.source_revision = "main";
  }
  // **空なら渡さない。** 渡さないこと自体が1つの選択（`ccr-env.sh`）。
  if (mode) args.permission_mode = mode;
  process.stdout.write(JSON.stringify(args));
' "$WORK/issue.json" "$INSTRUCTION" "$ISSUE" "$ENV_ID" "$SOURCE" "$MODE" >"$WORK/args.json"

# 立てずに、渡す引数だけを見る（`DRY_RUN=1 bash …`）。指示ファイルを差し替えたときの確認用。
# **本文は頭だけに切る**——目で見たいのは引数の形（環境ID・タグ・`source_url`）で、指示の全文は
# 邪魔になる。**`DRY_RUN=full` なら切らない**（渡す本文そのものを確かめる側が使う）。
if [ -n "${DRY_RUN:-}" ]; then
  if [ "$DRY_RUN" = full ]; then
    cat "$WORK/args.json"
  else
    jq '.prompt |= (split("\n") | .[0:3] | join("\n") + "\n…")' "$WORK/args.json"
  fi
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
