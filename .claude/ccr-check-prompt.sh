#!/usr/bin/env bash
# `create_session` で送った指示が、化けずに届いたかを確かめる。
#
#   bash .claude/ccr-check-prompt.sh session_012... "$LOCALAPPDATA/Temp/instruction.md"
#
#   一致                 … 送ったファイルと届いた本文が同じ（終了コード 0）
#   不一致               … 長さと、届いた先頭300字が出る（終了コード 1）
#
# **化けても壊れても、セッションは普通に動き出す。** 立てた直後にこれを通すこと
# （[`ccr-meta.sh`](./ccr-meta.sh)「立てたら、届いた本文を読んで確かめる」）。それらしくファイルを
# 読み始めた、は判断材料にならない。
#
# 見るのは `inbound_origin` が `mcp_create_session` の user イベント1つだけ。**`send_message` で
# 送った本文は対象外**——あちらは `<` `>` が実体参照になるので、同じ比較では常に不一致になる。
#
# ## 手で書くと必ず踏む3つ
#
# これを書くまでは、セッションを立てるたびに毎回この3つを踏み直していた。
#
# - `ccr-meta.sh` の出力は `<other-session>` の4行に包まれている。そのまま `JSON.parse` すると
#   包みの `<` で落ちる。**`{"ccr"` で始まる行だけ**を取る。
# - 本文の在り処は `user.internal_anthropic_catchall.message.content`。`role` も `user.content` も
#   無いので、素直に書くと空振りする。
# - `list_events` が返すのは**新しい側から**。種の指示は最も古い1件なので、最初のページには
#   居ないことがある。`before_id` に前のページの `first_id` を渡して遡る。

set -euo pipefail

SESSION="${1:?セッションIDを渡す（例: session_012...）}"
SENT="${2:?送った指示のファイルのパスを渡す}"

[ -r "$SENT" ] || {
  echo "読めない: $SENT" >&2
  exit 2
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

before=''
for _ in $(seq 1 30); do
  if [ -n "$before" ]; then
    printf '{"session_id":"%s","limit":100,"before_id":"%s"}' "$SESSION" "$before" >"$WORK/args.json"
  else
    printf '{"session_id":"%s","limit":100}' "$SESSION" >"$WORK/args.json"
  fi
  bash "$HERE/ccr-meta.sh" list_events <"$WORK/args.json" >"$WORK/page.txt"

  # 判定は1行のトークンで返し、人が読む中身は stderr へ出す。
  verdict=$(node -e '
    const fs = require("node:fs");
    const raw = fs.readFileSync(process.argv[1], "utf8");
    const line = raw.split(/\r?\n/).find((l) => l.trim().startsWith("{\"ccr\""));
    if (!line) {
      console.log("ERROR 応答に JSON の行が無い");
      process.exit(0);
    }
    const page = JSON.parse(line.trim()).ccr;
    const seed = (page.data || []).find((e) => {
      const u = e.user && e.user.internal_anthropic_catchall;
      return u && u.inbound_origin === "mcp_create_session" && typeof (u.message || {}).content === "string";
    });
    if (!seed) {
      console.log(page.has_more && page.first_id ? "MORE " + page.first_id : "NOTFOUND");
      process.exit(0);
    }
    const got = seed.user.internal_anthropic_catchall.message.content.trim();
    const sent = fs.readFileSync(process.argv[2], "utf8").trim();
    if (got === sent) {
      console.log("MATCH");
    } else {
      console.error("--- 届いた先頭300字 ---");
      console.error(got.slice(0, 300));
      console.log("DIFF " + sent.length + " " + got.length);
    }
  ' "$WORK/page.txt" "$SENT")

  case "$verdict" in
    MATCH)
      echo "一致"
      exit 0
      ;;
    DIFF*)
      set -- $verdict
      echo "不一致（送った $2 字 / 届いた $3 字）"
      exit 1
      ;;
    MORE*)
      next="${verdict#MORE }"
      [ "$next" != "$before" ] || {
        echo "遡っても種の指示が見つからない" >&2
        exit 1
      }
      before="$next"
      ;;
    NOTFOUND)
      echo "種の指示が見つからない（create_session で立てたセッションか確かめる）" >&2
      exit 1
      ;;
    *)
      echo "$verdict" >&2
      exit 2
      ;;
  esac
done

echo "30ページ遡っても種の指示が見つからない" >&2
exit 1
