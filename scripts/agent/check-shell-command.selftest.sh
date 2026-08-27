#!/usr/bin/env bash
# check-shell-command.sh の手動確認。通すべきものと止めるべきものを並べて出す。
cd "$(dirname "$0")/../.." || exit 1

run() {
  local expected=$1 cmd=$2 out rc
  out=$(printf '%s' "$cmd" | bash scripts/agent/check-shell-command.sh 2>&1)
  rc=$?
  local mark='ok '
  [ "$rc" = "$expected" ] || mark='NG '
  printf '%s want=%s got=%s  %s\n' "$mark" "$expected" "$rc" "$cmd"
  [ "$rc" = 0 ] || printf '        → %s\n' "$(head -1 <<<"$out")"
}

run 0 'npm run lint'
run 0 'git log --oneline -1 | head -3'
run 0 'bash scripts/agent/watch-prs.sh --issues 732 2>&1 | tail -2'
run 0 'cat CLAUDE.md > /dev/null'
run 0 'sed -n 1,5p CLAUDE.md'
run 0 'gh issue view 732 --json body > /tmp/body.json'
run 0 'node /tmp/fix.cjs'
run 1 "sed -i 's/a/b/' src/x.ts"
run 1 'echo hi > src/x.ts'
run 1 'cat x | tee CLAUDE.md'
run 1 'npm run build >> build.log'
run 1 "perl -i -pe 's/a/b/' CLAUDE.md"
