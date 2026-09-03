"""セッションのイベントを遡り、assistant メッセージの usage を1行1件で残す。

`parent_tool_use_id` が入っている行はサブエージェント（Task ツールの中で回った分）。

1つのメッセージは複数イベントに割れて届き、そのたび usage が更新される。message.id ごとに
各項目の最大値を採らないと桁が変わる。ただし **イベント側の output_tokens は使えない**
——同じメッセージのどのイベントでも一桁〜数十の固定値が入っていて、メタデータの
output_tokens と合わない。cache 系はメタデータと一致するので、按分はそちらで行う。

    python fetch_events.py <session_id> [出力jsonl]

単体で使うほか、sweep_events.py から並列に呼ばれる。
"""

import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def call(tool, args):
    """ccr_meta のツールを1回呼び、結果の中身（ccr の下）を返す。"""
    out = subprocess.run(
        ["bash", os.path.join(HERE, "mcp.sh"), tool, json.dumps(args)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    ).stdout
    text = json.loads(out)["result"]["content"][0]["text"]
    # ツール結果の本文に生の制御文字が混じることがある（strict=False で許容する）
    return json.loads(text[text.index('{"ccr"') : text.rindex("}") + 1], strict=False)["ccr"]


def fetch(session_id):
    """新しい方から before_id で遡り、usage を持つ assistant メッセージを返す。"""
    by_id, before, guard = {}, None, 0
    while True:
        args = {"session_id": session_id, "limit": 100}
        if before:
            args["before_id"] = before
        d = call("list_events", args)
        batch = d.get("data") or []
        for e in batch:
            body = e.get("assistant")
            if not body:
                continue
            c = body.get("internal_anthropic_catchall") or {}
            if isinstance(c, str):
                c = json.loads(c)
            m = c.get("message") or {}
            usage = m.get("usage") or {}
            mid = m.get("id")
            if not mid:
                continue
            row = by_id.setdefault(
                mid,
                {
                    "session_id": session_id,
                    "ts": c.get("timestamp") or e.get("created_at"),
                    "message_id": mid,
                    "request_id": c.get("request_id"),
                    "model": m.get("model"),
                    "parent_tool_use_id": c.get("parent_tool_use_id"),
                    "input": 0,
                    "output": 0,
                    "cache_write": 0,
                    "cache_read": 0,
                },
            )
            for key, src in (
                ("input", "input_tokens"),
                ("output", "output_tokens"),
                ("cache_write", "cache_creation_input_tokens"),
                ("cache_read", "cache_read_input_tokens"),
            ):
                row[key] = max(row[key], usage.get(src) or 0)
            if c.get("parent_tool_use_id"):
                row["parent_tool_use_id"] = c["parent_tool_use_id"]
        guard += 1
        if not batch or not d.get("has_more") or guard > 400:
            return list(by_id.values())
        before = d["first_id"]


if __name__ == "__main__":
    rows = fetch(sys.argv[1])
    out = sys.argv[2] if len(sys.argv) > 2 else "events-%s.jsonl" % sys.argv[1]
    with open(out, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    sub = sum(1 for r in rows if r["parent_tool_use_id"])
    print("%s: %d messages (subagent %d) -> %s" % (sys.argv[1], len(rows), sub, out))
