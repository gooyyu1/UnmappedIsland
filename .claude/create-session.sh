#!/usr/bin/env bash
# タスクのセッションをクラウドへ立てる。**メタMCPが切れていても動く。**
#
#   bash .claude/create-session.sh 774 "#774 時間表を定義から数える" <<'EOF'
#   （セッションへの指示をここに書く）
#   EOF
#
# 出力はセッションIDと claude.ai のURL。
#
# ## なぜ curl なのか
#
# 普段の道は `mcp__ccr_meta__create_session`。あちらは**起動時のヘッダを掴んだまま**なので、走って
# いる最中にトークンが切れると、登録を直してもそのセッションからは二度と使えない（2026-08-25 に
# 2回起きた）。**ここは呼ぶたびに `~/.claude/.credentials.json` から読み直す**ので切れない。
#
# `RemoteTrigger` でも立てられるが、**トリガー発火の実行はセッション一覧に出ない**ので、ユーザーが
# 進み具合を見に行けない。こちらは普通のセッションとして出る（タグも付く）。
#
# ## 触ってはいけないこと
#
# **`DELETE /v1/code/sessions/<id>` を畳むつもりで打たない。** あれは畳まずに**消す**（2026-08-25 に
# 実測。消した後は `not found`）。畳むのは `mcp__ccr_meta__archive_session` だけで、RESTの `PUT` は
# `status` を無視する（`title` と `tags` は変えられる）。

set -euo pipefail

ISSUE="${1:?issue番号を渡す}"
TITLE="${2:?タイトルを渡す}"
ENVIRONMENT="${CCR_ENVIRONMENT_ID:-env_01JEqw2RUbL6EFo4p8EgRLSC}" # 既定はクラウド
REPO="${CCR_SOURCE_URL:-https://github.com/gooyyu1/UnmappedIsland}"

PROMPT=$(cat)
[ -n "$PROMPT" ] || { echo "指示が空。標準入力で渡す" >&2; exit 1; }

TOKEN=$(node -e "
  const fs = require('node:fs');
  const path = (process.env.USERPROFILE || process.env.HOME) + '/.claude/.credentials.json';
  process.stdout.write(JSON.parse(fs.readFileSync(path, 'utf8')).claudeAiOauth.accessToken);
")

# JSONの組み立てはnodeに任せる（指示に改行も引用符も入るため）。
BODY=$(ISSUE="$ISSUE" TITLE="$TITLE" ENVIRONMENT="$ENVIRONMENT" REPO="$REPO" PROMPT="$PROMPT" node -e "
  const e = process.env;
  process.stdout.write(JSON.stringify({
    environment_id: e.ENVIRONMENT,
    title: e.TITLE,
    tags: ['issue-' + e.ISSUE, 'parallel-work'],
    config: {
      model: 'claude-opus-5',
      // **形は平ら。** {git_repository: {...}} と入れ子にすると
      // 'must contain type field' で弾かれる。
      sources: [{ type: 'git_repository', url: e.REPO, revision: 'main' }],
    },
    prompt: e.PROMPT,
  }));
")

curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: oauth-2025-04-20" \
  -H "content-type: application/json" \
  --data "$BODY" \
  "https://api.anthropic.com/v1/code/sessions" |
  node -e "
    let s = '';
    process.stdin.on('data', (d) => (s += d)).on('end', () => {
      const parsed = JSON.parse(s);
      if (parsed.error) {
        console.error('失敗:', JSON.stringify(parsed.error));
        process.exit(1);
      }
      const session = parsed.session ?? parsed;
      console.log(session.id);
      console.log('https://claude.ai/code/' + session.id);
    });
  "
