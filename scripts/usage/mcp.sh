#!/usr/bin/env bash
# ccr_meta の HTTP MCP を叩く。
#   mcp.sh <tool-name> <arguments-json>
#
# 認証ヘッダは ~/.claude.json から毎回読み、ディスクにも標準出力にも残さない。
set -euo pipefail

ENDPOINT='https://api.anthropic.com/v1/code/mcp/meta'

auth_header() {
  python - <<'PY'
import json, os

# bash 形式のパスは python が開けないので、ホームから組み立てる。
path = os.path.join(os.path.expanduser("~"), ".claude.json")
with open(path, encoding="utf-8") as f:
    d = json.load(f)
print("Authorization:", d["mcpServers"]["ccr_meta"]["headers"]["Authorization"])
PY
}

tool="$1"
args="$2"

payload=$(python - "$tool" "$args" <<'PY'
import json, sys

print(json.dumps({
    "jsonrpc": "2.0", "id": 1, "method": "tools/call",
    "params": {"name": sys.argv[1], "arguments": json.loads(sys.argv[2])},
}))
PY
)

curl -s -X POST "$ENDPOINT" \
  -H "$(auth_header)" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d "$payload"
