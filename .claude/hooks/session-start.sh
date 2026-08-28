#!/bin/bash
# SessionStart hook: セッションが始まった時点で `npm run lint` / `npm run typecheck` / `npm test` と
# run skill の開発サーバがそのまま動く状態にする。**依存の在り方が2通りあるので、見る所も2通り。**
#
# - Claude Code on the web（`CLAUDE_CODE_REMOTE=true`）: コンテナに何も無いので、自分で入れる。
# - 手元の作業ツリー（`<repo>/.claude/worktrees/**`）: リポジトリの中に居るので、Node も npm も親を
#   遡って**本体の `node_modules` をそのまま共有する**。入れると250MBの複製ができて共有が終わる
#   だけなので、**入れずに、共有先が自分の `package-lock.json` を満たしているかだけ見る**。
#
# 満たしていないときも直さない。**本体を進めるのは `scripts/agent/merge-and-close.sh` の仕事**で、
# ここで `npm install` を打つと、共有先を読んでいる他のセッションの足元が揺れる。ここは促すだけ。
#
# 同期実行（`{"async": true}` を出さない）。セッションが始まった時点で node_modules が
# 揃っていることを保証し、準備前にテストやリンタを走らせてしまう競合を避ける。冪等・非対話。
set -euo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
REPO_DIR="$(pwd)"

# --- Claude Code on the web: 依存を導入する -----------------------------------
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  # Unity/C#からTypeScriptへ移行した際、追跡対象のC#ファイルはcheckoutで消えたが、
  # dotnet restoreが作ったTests/obj以下（未追跡）はgitが触らないため環境に残りうる。
  # gitが1つも追跡していないことを確かめてから消す（誤って実体を消さないため）。
  if [ -d Tests ] && [ -z "$(git ls-files Tests)" ]; then
    echo "[session-start] C#時代の残骸 Tests/ を削除します。"
    rm -rf Tests
  fi

  # コンテナの状態はフック完了後にキャッシュされるため、差分だけを入れ直せる
  # npm install を使う（npm ci は毎回node_modulesを作り直す）。
  echo "[session-start] npm install を実行します..."
  npm install --no-fund --no-audit

  echo "[session-start] 準備完了。'npm run lint' / 'npm run typecheck' / 'npm test' が利用できます。"
  exit 0
fi

# --- 手元の作業ツリー: 共有先が古くないかだけ見る -----------------------------
command -v node >/dev/null || exit 0
[ -f package-lock.json ] || exit 0
# 自前で持っているなら、そちらが解決されるので共有先は関係ない。
[ ! -e node_modules/.package-lock.json ] || exit 0

common=$(git rev-parse --git-common-dir 2>/dev/null) || exit 0
[ -n "$common" ] || exit 0
# ここは促すだけの経路なので、辿れなければ黙って降りる。**フックが落ちるとセッションが始まらない。**
MAIN_DIR=$(cd "$common/.." 2>/dev/null && pwd) || exit 0
[ -n "$MAIN_DIR" ] || exit 0
[ "$MAIN_DIR" != "$REPO_DIR" ] || exit 0

INSTALLED="$MAIN_DIR/node_modules/.package-lock.json"
if [ ! -e "$INSTALLED" ]; then
  echo "[session-start] 共有先の本体（$MAIN_DIR）に node_modules がありません。"
  echo "[session-start] 本体で 'npm install' を実行してください。"
  exit 0
fi

# `.package-lock.json` は実際に入っている木。プラットフォーム依存の任意依存は入っていなくて
# 当たり前なので（実測で272件中80件）、`optional`・`os`・`cpu` の付いた宣言は数えない。
short=$(node -e '
const fs = require("fs");
const read = (path) => JSON.parse(fs.readFileSync(path, "utf8")).packages ?? {};
const want = read(process.argv[1]);
const have = read(process.argv[2]);
const needed = Object.keys(want).filter(
  (key) =>
    key.startsWith("node_modules/") && !want[key].optional && !want[key].os && !want[key].cpu,
);
const short = needed.filter((key) => !have[key] || have[key].version !== want[key].version);
process.stdout.write(short.map((key) => key.replace(/^node_modules\//, "")).join(" "));
' package-lock.json "$INSTALLED")

[ -n "$short" ] || exit 0

count=$(wc -w <<<"$short")
echo "[session-start] 共有している本体（$MAIN_DIR）の依存が、この作業ツリーの package-lock.json に"
echo "[session-start] $count 件足りていません: $(cut -d' ' -f1-5 <<<"$short")"
echo "[session-start] このまま走らせると 'Cannot find module' ではなく、古い版が解決されて一部だけ"
echo "[session-start] 壊れます。この作業ツリーで 'npm install' を実行してください（本体は次のマージで"
echo "[session-start] 追いつきます）。"
