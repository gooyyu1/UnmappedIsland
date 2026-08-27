#!/usr/bin/env bash
# deny-shell-file-write.sh の手動確認。Claude Code が渡すのと同じ形の JSON を流す。
cd "$(dirname "$0")/../.." || exit 1
export CLAUDE_PROJECT_DIR="$PWD"

run() {
  local want=$1 cmd=$2 out
  out=$(jq -n --arg c "$cmd" '{tool_input: {command: $c}}' |
    bash .claude/hooks/deny-shell-file-write.sh)
  # 何も出さずに終わるのが「通す」。出したときだけ中身を見る。
  if [ -z "$out" ]; then
    out=allow
  else
    out=$(jq -r '.hookSpecificOutput.permissionDecision' <<<"$out")
  fi
  local mark='ok '
  [ "$out" = "$want" ] || mark='NG '
  printf '%s want=%s got=%s  %s\n' "$mark" "$want" "$out" "$cmd"
}

run allow 'npm run lint'
run allow 'sed -n 1,5p CLAUDE.md'
run deny "sed -i 's/a/b/' CLAUDE.md"
run deny 'echo hi > src/x.ts'
