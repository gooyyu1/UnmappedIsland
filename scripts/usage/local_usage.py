"""ローカル（~/.claude/projects/**）の transcript から usage を1行1メッセージで抜く。

CCR に記録の無いセッション（Claude Code を直接使った分）を数えるために要る。
CCR 側と違って `cost_usd` は持たないが、メッセージ単位の時刻を持つので時間別は正確。

同じ message.id が複数行へ割れて届くので、id ごとに各項目の最大値を採る。
サブエージェントは <session>/subagents/agent-*.jsonl に分かれているので is_sub で印を付ける。
"""

import glob
import json
import os

from paths import data

ROOT = os.path.expanduser("~/.claude/projects")

by_id = {}
files = glob.glob(os.path.join(ROOT, "**", "*.jsonl"), recursive=True)
for p in files:
    is_sub = 1 if os.sep + "subagents" + os.sep in p else 0
    # サブエージェントのファイルは <session>/subagents/ の下にあるので、親から辿る
    sid = os.path.basename(os.path.dirname(os.path.dirname(p))) if is_sub else os.path.basename(p)[:-6]
    try:
        fh = open(p, encoding="utf-8")
    except OSError:
        continue
    with fh:
        for line in fh:
            if '"usage"' not in line:
                continue
            try:
                d = json.loads(line)
            except ValueError:
                continue
            m = d.get("message") or {}
            u = m.get("usage") or {}
            mid = m.get("id")
            if not mid or not u:
                continue
            r = by_id.setdefault(
                mid,
                {
                    "session_id": sid,
                    "ts": d.get("timestamp"),
                    "model": m.get("model"),
                    "is_sub": is_sub,
                    "input": 0,
                    "output": 0,
                    "cache_write": 0,
                    "cache_read": 0,
                },
            )
            for k, src in (
                ("input", "input_tokens"),
                ("output", "output_tokens"),
                ("cache_write", "cache_creation_input_tokens"),
                ("cache_read", "cache_read_input_tokens"),
            ):
                r[k] = max(r[k], u.get(src) or 0)

out = data("local_usage.jsonl")
with open(out, "w", encoding="utf-8") as f:
    for r in sorted(by_id.values(), key=lambda r: r["ts"] or ""):
        f.write(json.dumps(r, ensure_ascii=False) + "\n")
stamps = [r["ts"] for r in by_id.values() if r["ts"]]
print("ファイル %d / メッセージ %d -> %s" % (len(files), len(by_id), os.path.relpath(out)))
print("最古 %s / 最新 %s" % (min(stamps), max(stamps)))
