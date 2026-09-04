#!/usr/bin/env bash
# 司令塔を次のセッションへ引き継ぐ。**ブリッジ（このPC）にしか立てない。**
#
#   bash scripts/agent/handover.sh
#   bash scripts/agent/handover.sh <補足ファイル>
#   DRY_RUN=1 bash scripts/agent/handover.sh   # 渡す引数を見るだけ
#
# 指示は [`.claude/commander-prompt.md`](../../.claude/commander-prompt.md) から読む。
#
# 出力は1行1件。
#   DAEMON <生死>         … 盤面を回している [`daemon.sh`](daemon.sh) が走っているか
#   PREDECESSOR <ID>      … 後継に畳ませる前任
#   SESSION <ID>
#   一致 / 不一致          … 送った指示が化けずに届いたか
#   終了コード 0 … 立てられて、指示も一致した
#   終了コード 1 … どこかで失敗した（上の行がどこまで出たかで分かる）
#
# ## 申し送りは渡さない
#
# 状況はラベルと issue とデーモンのログに在り、後継は [`board.sh`](board.sh) でいつでも引ける。
# **引き継ぎが正規の手順を通るとは限らない**——Claudeが落ちれば、渡す文そのものが存在しない。
# 渡す文にしか無い情報は、そのとき丸ごと失われる（[`policies.md`](../../.claude/policies.md)
# 「置き場と形式の選び方」）。
#
# だから `DAEMON` を先頭に出す。**引き継ぎで確かめる価値があるのは、盤面を回す側が生きているか
# だけ**——止まっていることは他のどこにも現れない（[`parallel-work.md`](../../.claude/parallel-work.md)
# 「盤面を回す仕組みを止めたままにしない」）。補足ファイルは、次の司令塔だけに伝わればよい私信の
# ためにだけ在る。**既定は渡さない。**
#
# ## 前任を畳むのは後継
#
# 畳む相手をひな形の `<前任>` へ埋めて、**後継の最初の仕事にする**。ここで畳まないのは2つの理由から。
#
# - **自分で自分を畳むと、走っているプロセスごと消える。** 後片付けの出力を誰も読めない。
# - **後継が起動できたことが、畳んでよい条件そのもの。** `claude remote-control` が落ちている間に
#   ブリッジのセッションを畳むと worktree がロックされたまま残る
#   （[`archive-session.sh`](archive-session.sh)）。立ち上がりに失敗した後継が前任を畳む事故も無くなる。
#
# 畳み損ねても次の引き継ぎで拾えるように、渡すのは**`commander` タグの、まだ畳まれていないもの
# 全部**。タグを毎回手で付けていた間は綴りが揺れていた（`parallel-work,shirei` と `commander`）
# ので、ここで固定する。

set -euo pipefail

EXTRA="${1:-}"
[ -z "$EXTRA" ] || [ -f "$EXTRA" ] || {
  echo "補足ファイルが無い: $EXTRA" >&2
  exit 1
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/agent/ccr-env.sh
source "$HERE/ccr-env.sh"
CCR_META="${CCR_META:-$HERE/../../.claude/ccr-meta.sh}"
CHECK_PROMPT="$HERE/../../.claude/ccr-check-prompt.sh"
TEMPLATE="$HERE/../../.claude/commander-prompt.md"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 生死の判定は [`daemon.sh`](daemon.sh) 自身が持つ（心拍の鮮度は `INTERVAL` から決まる）。
echo "DAEMON $(bash "$HERE/daemon.sh" --status || true)"

# `commander` タグの、まだ畳まれていないセッション。**この時点では後継がまだ居ない**ので、
# 出てくるのは前任だけ。
predecessors=$(bash "$CCR_META" list_sessions <<<'{"mine":true,"limit":100}' |
  grep -o '{"ccr".*' |
  jq -r '(.ccr.data // [])[]
    | select([.tags[]? | select(. == "commander")] | length > 0)
    | select(.session_status != "SESSION_STATUS_ARCHIVED")
    | .id' | tr -d '\r' | sort -u || true)
for id in $predecessors; do echo "PREDECESSOR $id"; done

INSTRUCTION="$WORK/prompt.md"
awk '/^```$/ { inside = !inside; next } inside' "$TEMPLATE" |
  sed "s/<前任>/$(printf '%s' "$predecessors" | paste -sd' ' -)/" >"$INSTRUCTION"
[ -s "$INSTRUCTION" ] || {
  echo "ひな形から指示を取り出せない: $TEMPLATE" >&2
  exit 1
}
# 私信は後ろへ付ける。ひな形の側を書き換えないので、次の引き継ぎには残らない。
[ -z "$EXTRA" ] || {
  printf '\n## 前任からの私信\n\n' >>"$INSTRUCTION"
  cat "$EXTRA" >>"$INSTRUCTION"
}

# **日本語はシェル変数に載せない。** Windowsのnodeは argv も環境変数もANSIで受け取るので、題を
# `$(...)` で渡すと黙って化ける。題も本文もファイル経由で node へ渡す。
printf '司令塔（引き継ぎ %s）' "$(date '+%Y-%m-%d %H:%M')" >"$WORK/title.txt"

node -e '
  const fs = require("node:fs");
  const [titlePath, promptPath, envId] = process.argv.slice(1);
  process.stdout.write(JSON.stringify({
    environment_id: envId,
    title: fs.readFileSync(titlePath, "utf8"),
    prompt: fs.readFileSync(promptPath, "utf8"),
    tags: ["commander"],
  }));
' "$WORK/title.txt" "$INSTRUCTION" "$BRIDGE_ENV" >"$WORK/args.json"

# 立てずに、渡す引数だけを見る（`DRY_RUN=1 bash …`）。ひな形を直したときの確認用。
if [ -n "${DRY_RUN:-}" ]; then
  jq '.prompt |= (split("\n") | .[0:6] | join("\n") + "\n…")' "$WORK/args.json"
  exit 0
fi

# 応答は `<other-session>` の包みに入って返るので、中のJSONだけ取り出す。
session=$(bash "$CCR_META" create_session <"$WORK/args.json" | grep -o '{"ccr".*' | jq -r '.ccr.id')
[ -n "$session" ] && [ "$session" != "null" ] || {
  echo "セッションを立てられなかった" >&2
  exit 1
}
echo "SESSION $session"

bash "$CHECK_PROMPT" "$session" "$INSTRUCTION"
