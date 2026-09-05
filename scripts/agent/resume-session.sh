#!/usr/bin/env bash
# 止まったセッションを1本、`send_message` で起こす。
#
#   bash scripts/agent/resume-session.sh cse_012ABC mend 1512
#   bash scripts/agent/resume-session.sh cse_012ABC stall 1400
#   DRY_RUN=1 bash scripts/agent/resume-session.sh cse_012ABC mend 1512   # 送る本文を見るだけ
#
# 本文は [`.claude/resume-prompt.md`](../../.claude/resume-prompt.md) の `## <理由>` 節から読む。
# **司令塔が書き足すものは無い**——理由は盤面から機械的に決まり（[`board-move.mjs`](board-move.mjs)）、
# そのPRで何が起きているかは、起こされた本人がPRを見れば分かる。
#
# 出力は1行1件。
#   SENT <セッションID>
#   終了コード 0 … 届いた
#   終了コード 1 … 送らなかった（手綱・走行中・引けなかった）
#
# ## 立てるのではなく起こすので、`may-dispatch.sh` は通らない
#
# 見るのは**このセッション1本が今動いているか**で、タグの指す仕事が占有されているかではない
# （[`board-design.md`](../../.claude/board-design.md) 1.2）。同じ相手へ二度送っても2本にはならない
# ——増えるのは無駄な指示だけ。手綱（[`brake.sh`](brake.sh)）は「投入」の一種として掛ける。
#
# **同じ盤面へ二度送らないのは呼び手の側**（`board-move.mjs` の `taken`）。ここは1回ぶんを送る。

set -euo pipefail

SESSION="${1:?セッションIDを渡す}"
KIND="${2:?理由を渡す（mend / stall）}"
NUMBER="${3:?対象の番号を渡す}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CCR_META="${CCR_META:-$HERE/../../.claude/ccr-meta.sh}"
TEMPLATE="${RESUME_PROMPT:-$HERE/../../.claude/resume-prompt.md}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

BODY="$WORK/message.md"
awk -v want="$KIND" '
  $1 == "##" && $2 == want { found = 1; next }
  found && /^```$/ { inside = !inside; if (!inside) exit; next }
  inside { print }
' "$TEMPLATE" | sed "s/<番号>/$NUMBER/g" >"$BODY"
[ -s "$BODY" ] || {
  echo "ひな形に「## $KIND」の節が無い: $TEMPLATE" >&2
  exit 1
}

if [ -n "${DRY_RUN:-}" ]; then
  cat "$BODY"
  exit 0
fi

if ! brake=$(bash "$HERE/brake.sh" resume); then
  echo "投入の手綱で止まっている: $brake" >&2
  exit 1
fi

# 走っている相手へ送ると、仕上げの最中に別の仕事を積むことになる。**手が動いているかを言うのは
# `session_status`**——`status_bucket` は手が空いても `..._WORKING` のまま固まることがあり、そちらで
# 見ると**起こす相手がちょうど起こせなくなる**（[`board-design.md`](../../.claude/board-design.md) 1.6）。
#
# **`..._BLOCKED` を足しているのは仮説で、実測していない。** 承認待ちのセッションが
# `SESSION_STATUS_RUNNING` を保つのか `..._IDLE` へ落ちるのかを見ていないので、落ちる場合に備えて
# or で残してある（許可が下りれば書き始めるので、届くのは書き終わった後になる）。
# **実測が付いたら、要らない側を消すこと。**
if ! live=$(CCR_META="$CCR_META" bash "$HERE/live-sessions.sh"); then
  echo "セッションの一覧を引けなかった" >&2
  exit 1
fi
state=$(printf '%s\n' "$live" | awk -F'\t' -v id="$SESSION" '$1 == id { print $2 "|" $3 }')
case "$state" in
'')
  echo "畳まれているか、居ないセッション: $SESSION" >&2
  exit 1
  ;;
SESSION_STATUS_RUNNING\|* | *\|SESSION_STATUS_BUCKET_BLOCKED)
  echo "まだ動いているので起こさない: $SESSION $state" >&2
  exit 1
  ;;
esac

# **日本語はシェル変数に載せない**（Windowsのnodeは argv も環境変数もANSIで受け取る）。本文は
# ファイル経由でJSONへ入れる。
node -e '
  const fs = require("node:fs");
  const [session, bodyPath] = process.argv.slice(1);
  process.stdout.write(JSON.stringify({
    session_id: session,
    message: fs.readFileSync(bodyPath, "utf8"),
  }));
' "$SESSION" "$BODY" >"$WORK/args.json"

bash "$CCR_META" send_message <"$WORK/args.json" >"$WORK/out.txt" || {
  echo "送れなかった: $SESSION" >&2
  exit 1
}
echo "SENT $SESSION"
