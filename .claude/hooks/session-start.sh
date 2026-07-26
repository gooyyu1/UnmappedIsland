#!/bin/bash
# SessionStart hook: Claude Code on the web で `npm run lint` / `npm run typecheck` /
# `npm test` と run skill の開発サーバがそのまま動く状態にする。
#
# 同期実行（`{"async": true}` を出さない）。セッションが始まった時点で node_modules が
# 揃っていることを保証し、準備前にテストやリンタを走らせてしまう競合を避ける。
# 冪等・非対話。既定では Claude Code on the web（CLAUDE_CODE_REMOTE=true）でのみ動く。
set -euo pipefail

# --- web(remote) 以外では何もしない -------------------------------------------
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

REPO_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$REPO_DIR"

# --- C#時代の生成物の後始末 ---------------------------------------------------
# Unity/C#からTypeScriptへ移行した際、追跡対象のC#ファイルはcheckoutで消えたが、
# dotnet restoreが作ったTests/obj以下（未追跡）はgitが触らないため環境に残りうる。
# gitが1つも追跡していないことを確かめてから消す（誤って実体を消さないため）。
if [ -d Tests ] && [ -z "$(git ls-files Tests)" ]; then
  echo "[session-start] C#時代の残骸 Tests/ を削除します。"
  rm -rf Tests
fi

# --- 依存の導入 ---------------------------------------------------------------
# コンテナの状態はフック完了後にキャッシュされるため、差分だけを入れ直せる
# npm install を使う（npm ci は毎回node_modulesを作り直す）。
echo "[session-start] npm install を実行します..."
npm install --no-fund --no-audit

echo "[session-start] 準備完了。'npm run lint' / 'npm run typecheck' / 'npm test' が利用できます。"
