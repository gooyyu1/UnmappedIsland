#!/bin/bash
# PostToolUse hook: Claudeが書き換えたファイルへ prettier をかける。
#
# CIは `npm run lint` / `npm run typecheck` / `npm test` に加えて `npm run format:check`
# （prettier --check）も走らせる。整形のずれは lint では検出できない（eslint-config-prettierが
# 整形系ルールを無効化しているため）ので、書いた時点で整えてしまい、CIで初めて気付く状態をなくす。
#
# 冪等・非対話。prettierが扱えない拡張子と.prettierignore対象は黙って飛ばす。
set -euo pipefail

HERE="${BASH_SOURCE[0]%/*}"
if [[ "$HERE" == "${BASH_SOURCE[0]}" ]]; then HERE='.'; fi
REPO_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$HERE/../.." && { pwd -W 2>/dev/null || pwd; })}"

# フックの入力はstdinのJSON。Write/Editの書き込み先を取り出す。
file=$(jq -r '.tool_response.filePath // .tool_input.file_path // empty')

# 比べる前に綴りを `/` 区切りへ揃える。Windowsでは書き込み先が `C:\...` で届き、根は
# `CLAUDE_PROJECT_DIR` なら `C:\...`、自分の置き場から引けば `pwd -W` の `C:/...`（MSYS2 の bash の
# `pwd` は `/c/...` を返すので使わない）——揃えないと、中のファイルが全部「外」に見える。
REPO_DIR="${REPO_DIR//\\//}"
file="${file//\\//}"

# リポジトリの外（スクラッチパッド等）には触らない。
case "$file" in
"$REPO_DIR"/*) ;;
*) exit 0 ;;
esac

cd "$REPO_DIR"
npx --no-install prettier --write --ignore-unknown "$file" >/dev/null 2>&1 || true
