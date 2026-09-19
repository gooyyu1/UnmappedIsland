#!/usr/bin/env bash
# 止まったセッションを1本、`send_message` で起こす。
#
#   bash scripts/daemon/resume-session.sh cse_012ABC mend 1512
#   bash scripts/daemon/resume-session.sh cse_012ABC stall 1400
#   DRY_RUN=1 bash scripts/daemon/resume-session.sh cse_012ABC mend 1512   # 送る本文を見るだけ
#
# 本文は [`agent-ops/prompts/resume-prompt.md`](../../agent-ops/prompts/resume-prompt.md) の `## <理由>` 節から読む。
# **書き足すものは無い**——理由は盤面から機械的に決まり（[`board-move.mjs`](board-move.mjs)）、
# そのPRで何が起きているかは、起こされた本人がPRを見れば分かる。
#
# **理由は、起こされた側がやることで割ってある**（`board-design.md` 1.3節）。差し戻し・コンフリクト・
# CIの赤は同じ `mend`（どれも「PRを見て直す」）だが、ユーザーの差し戻しと画面の証跡は
# 作業が違うので別の節を持つ。**節を足せば、盤面が出す語をそのまま新しい理由にできる。**
#
# 出力は1行1件。
#   SENT <セッションID>
#   終了コード 0 … 届いた
#   終了コード 3 … 人が手綱で止めている（[`brake.sh`](brake.sh)）
#   終了コード 4 … 使用量の余力が足りない（[`headroom.sh`](headroom.sh)）
#   終了コード 1 … それ以外で送らなかった（走行中・引けなかった）
#
# ## 立てるのではなく起こすので、`may-dispatch.sh` は通らない
#
# 見るのは**このセッション1本が今動いているか**で、タグの指す仕事が占有されているかではない
# （[`board-design.md`](../../agent-ops/board-design.md) 1.2節）。同じ相手へ二度送っても2本にはならない
# ——増えるのは無駄な指示だけ。**通らないのは占有の問いだけ**で、モデルを使わせてよいか
# （手綱と余力）は立てる経路と同じ [`may-spend.sh`](may-spend.sh) に訊く（2.5.2）。
#
# **起こせなかった周は、起こしたことにならない。** 盤面は起こした印を打てた手にしか残さないので
# （[`board-round.mjs`](board-round.mjs) の `remember`）、**止まった周は次の窓で人へ返す段まで進まず**、
# 枠が明けた周にそのまま起こし直される（2.5.2・2.15.3）。
#
# **同じ盤面へ二度送らないのは呼び手の側**（`board-move.mjs` の `taken`）。ここは1回ぶんを送る。

set -euo pipefail

SESSION="${1:?セッションIDを渡す}"
KIND="${2:?理由を渡す（resume-prompt.md の節の名前）}"
NUMBER="${3:?対象の番号を渡す}"

# `%/*` は区切りが無いと文字列をそのまま返す。
HERE="${BASH_SOURCE[0]%/*}"
if [[ "$HERE" == "${BASH_SOURCE[0]}" ]]; then HERE='.'; fi
HERE="$(cd "$HERE" && pwd)"
TEMPLATE="${RESUME_PROMPT:-$HERE/../../agent-ops/prompts/resume-prompt.md}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# **取り出しは投入と同じ1つ**（[`prompt-template.sh`](prompt-template.sh)）。ここで写すと、片方だけ
# 直したときに、起こす経路だけが黙って別の中身を渡す。埋めるのはここが持つ——`<番号>` は理由の
# 節ごとではなく、起こす相手ごとに変わる。
# shellcheck source=scripts/daemon/prompt-template.sh
source "$HERE/prompt-template.sh"

RAW="$WORK/section.md"
template_body "$TEMPLATE" "$RAW" "$KIND"

BODY="$WORK/message.md"
sed "s/<番号>/$NUMBER/g" "$RAW" >"$BODY"

if [ -n "${DRY_RUN:-}" ]; then
  cat "$BODY"
  exit 0
fi

# **流してよいかは、立てる経路と同じ1つに訊く**（[`may-spend.sh`](may-spend.sh)）。**終了コードは
# そのまま自分のものになる**（`set -e`。人が止めている＝3、余力が足りない＝4）。
bash "$HERE/may-spend.sh" resume

# 走っている相手へ送ると、仕上げの最中に別の仕事を積むことになる。**手が動いているかを言うのは
# `session_status` だけ**——`status_bucket` は手番が終わった後の要約から決まるので、どの値も
# 「処理中」を意味しない（[`board-design.md`](../../agent-ops/board-design.md) 1.6節）。
if ! live=$(bash "$HERE/live-sessions.sh"); then
  echo "セッションの一覧を引けなかった" >&2
  exit 1
fi
state=$(printf '%s\n' "$live" | awk -F'\t' -v id="$SESSION" '$1 == id { print $2 "|" $3 }')
case "$state" in
'')
  echo "畳まれているか、居ないセッション: $SESSION" >&2
  exit 1
  ;;
SESSION_STATUS_RUNNING\|*)
  echo "まだ動いているので起こさない: $SESSION $state" >&2
  exit 1
  ;;
esac

# **本文をシェルの文字列にしない**（危ないのは文字の符号ではなく**シェルの展開**なので、構文ごとに
# 載せてよいかを判断せず、載せないほうを決めておく。
# [`.claude/ccr-meta.sh`](../../.claude/ccr-meta.sh)「指示は Write で書く」）。ファイルのまま渡して、
# 読むのも組み立てるのも送るのも [`send-message.mjs`](send-message.mjs) の中で済ませる。
node "$HERE/send-message.mjs" "$SESSION" "$BODY" || {
  echo "送れなかった: $SESSION" >&2
  exit 1
}
echo "SENT $SESSION"
