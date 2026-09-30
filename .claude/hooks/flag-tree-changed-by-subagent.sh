#!/bin/bash
# PreToolUse / PostToolUse / PostToolUseFailure hook（Agent）: サブエージェントが走っている間に作業ツリーが
# 変わったら、親へ告げる。
#
# サブエージェントは親と同じチェックアウトに居るので、子が書き換えたまま返ると親の push に混ざる。
# 書き換えてよいかは指示の側（`CLAUDE.md`「PRを出す前に、サブエージェントへ一次レビューさせる」）が
# 線を引き、ここは破れたときに親が気づく側を持つ。
#
# 前後で比べるので、**効くのは結果を待って受け取る立て方だけ**——背景へ回すと、Post は子が走り出した
# 直後に来る。一次レビューは待つ形で立てると決めてあるので、そこは覆う。子が失敗・中断で返ったときは
# PostToolUse ではなく PostToolUseFailure が来るので、そちらでも同じく比べる。
# 比べるのは「HEAD」と「HEADから変わっているファイルの中身」。子が書き換えて戻したものは差に出ない
# （戻っているなら害は無い）。
set -euo pipefail

input=$(cat)
event=$(jq -r '.hook_event_name // ""' <<<"$input")
id=$(jq -r '.tool_use_id // ""' <<<"$input")
dir=$(jq -r '.cwd // ""' <<<"$input")
dir=${dir:-${CLAUDE_PROJECT_DIR:-$PWD}}

# 呼び出しを1つに引けないと、別の呼び出しの控えと比べてしまう。黙って抜ける。
[ -n "$id" ] || exit 0
top=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$top"
git_dir=$(git rev-parse --absolute-git-dir)

store="$git_dir/subagent-tree"
saved="$store/${id//[^A-Za-z0-9_-]/_}"

snapshot() {
  printf 'HEAD %s\n' "$(git rev-parse HEAD 2>/dev/null || echo none)"
  { git diff HEAD --name-only -z 2>/dev/null; git ls-files -o --exclude-standard -z; } |
    sort -zu |
    while IFS= read -r -d '' path; do
      if [ -e "$path" ]; then
        printf '%s %s\n' "$(git hash-object -- "$path")" "$path"
      else
        printf 'deleted %s\n' "$path"
      fi
    done
}

case "$event" in
PreToolUse)
  mkdir -p "$store"
  snapshot >"$saved"
  ;;
PostToolUse | PostToolUseFailure)
  [ -f "$saved" ] || exit 0
  changed=$(diff "$saved" <(snapshot) | awk '/^[<>] / { if ($2 == "HEAD") print "HEAD"; else { sub(/^[<>] [^ ]+ /, ""); print } }' | sort -u || true)
  rm -f "$saved"
  [ -n "$changed" ] || exit 0
  reason="サブエージェントが走っている間に、作業ツリー（HEAD か次のファイル）が変わった: ${changed//$'\n'/, }。その間に自分で書いたものでなければ、子が書き換えたまま戻していない。push の前に \`git status\` と \`git diff\` で確かめ、子の書き換えは戻すこと。"
  jq -n --arg event "$event" --arg reason "$reason" \
    '{hookSpecificOutput: {hookEventName: $event, additionalContext: $reason}}'
  ;;
esac
