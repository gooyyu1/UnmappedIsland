#!/bin/bash
# Viteの開発サーバーをバックグラウンドで起動し、"ready in"がログに出るまで待って結果を報告する。
# これ単体は1回のBash呼び出しで完結してよい（不安定になるのは、この直後に同じ呼び出し内で
# ブラウザ自動化スクリプトまで実行しようとした場合）。スクリーンショット等のブラウザ操作は
# 必ず別のBash呼び出しに分けること。
set -euo pipefail

PORT="${1:?使い方: start-dev-server.sh <port> <logfile> [project-dir]}"
LOGFILE="${2:?使い方: start-dev-server.sh <port> <logfile> [project-dir]}"
PROJECT_DIR="${3:-.}"
# 起動を待つ上限（秒）と、見に行く刻み。**別のことなので別に持つ**——上限は「どこまで待つか」、
# 刻みは「どれくらい細かく見に行くか」。
READY_WAIT="${READY_WAIT:-10}"
POLL_SECONDS=0.05

cd "$PROJECT_DIR"
mkdir -p "$(dirname "$LOGFILE")"

nohup npx vite --port "$PORT" > "$LOGFILE" 2>&1 &
disown

# **寝る前に見て、上限は時計で測る。** 寝てから見ると、もう出ている回にも刻みぶん払う。回数で
# 数えると、`READY_WAIT` の意味が秒ではなく「見に行く回数」になる。
deadline_ms=$(($(date +%s%3N) + READY_WAIT * 1000))
while :; do
  if grep -q "ready in" "$LOGFILE" 2>/dev/null; then
    echo "起動確認OK: http://localhost:$PORT/"
    cat "$LOGFILE"
    exit 0
  fi
  [ "$(date +%s%3N)" -lt "$deadline_ms" ] || break
  sleep "$POLL_SECONDS"
done

echo "${READY_WAIT}秒待っても起動確認できませんでした。ログ:" >&2
cat "$LOGFILE" >&2
exit 1
