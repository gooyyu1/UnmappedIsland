#!/bin/bash
# 環境に事前インストール済みのChromium実行ファイルのパスを解決して標準出力へ書き出す。
# playwright-coreを直接使う場合はPLAYWRIGHT_BROWSERS_PATHの自動解決が働かないため、
# バージョン番号付きディレクトリ（例: chromium-1194）を自分で探す必要がある。
set -euo pipefail

BROWSERS_DIR="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"

DIR=$(ls "$BROWSERS_DIR" | grep -E '^chromium-[0-9]+$' | sort -V | tail -1)
if [ -z "$DIR" ]; then
  echo "chromium-<版数>ディレクトリが $BROWSERS_DIR に見つかりません。" >&2
  exit 1
fi

EXECUTABLE="$BROWSERS_DIR/$DIR/chrome-linux/chrome"
if [ ! -x "$EXECUTABLE" ]; then
  echo "$EXECUTABLE が見つからないか実行できません。" >&2
  exit 1
fi

echo "$EXECUTABLE"
