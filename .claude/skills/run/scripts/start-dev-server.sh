#!/bin/bash
# Viteの開発サーバーをバックグラウンドで起動し、"ready in"がログに出るまで待って結果を報告する。
# これ単体は1回のBash呼び出しで完結してよい（不安定になるのは、この直後に同じ呼び出し内で
# ブラウザ自動化スクリプトまで実行しようとした場合）。スクリーンショット等のブラウザ操作は
# 必ず別のBash呼び出しに分けること。
set -euo pipefail

PORT="${1:?使い方: start-dev-server.sh <port> <logfile> [project-dir]}"
LOGFILE="${2:?使い方: start-dev-server.sh <port> <logfile> [project-dir]}"
PROJECT_DIR="${3:-.}"

cd "$PROJECT_DIR"
mkdir -p "$(dirname "$LOGFILE")"

nohup npx vite --port "$PORT" > "$LOGFILE" 2>&1 &
disown

for _ in $(seq 1 10); do
  sleep 1
  if grep -q "ready in" "$LOGFILE" 2>/dev/null; then
    echo "起動確認OK: http://localhost:$PORT/"
    cat "$LOGFILE"
    exit 0
  fi
done

echo "起動確認できませんでした。ログ:" >&2
cat "$LOGFILE" >&2
exit 1
