"""CCR のセッション一覧を古い方まで遡って落とす。

    python sweep_sessions.py [YYYY-MM-DD まで遡る]

ページの生JSONを残すのは、後から別の切り口で数え直せるようにするため。
一覧は新しい順に返り、`after_id` に前ページの `last_id` を渡すと古い方へ進む。
"""

import json
import os
import sys

from fetch_events import call
from paths import data

CUTOFF = (sys.argv[1] if len(sys.argv) > 1 else "2000-01-01") + "T00:00:00Z"

after, page, seen = None, 0, {}
while True:
    args = {"limit": 100}
    if after:
        args["after_id"] = after
    d = call("list_sessions", args)
    batch = d.get("data") or []
    with open(data("pages", "page-%03d.json" % page), "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False)
    for s in batch:
        seen[s["id"]] = s
    oldest = min((s["created_at"] for s in batch), default="")
    print("page %3d: %3d件 最古 %s 累計 %d" % (page, len(batch), oldest[:19], len(seen)), flush=True)
    page += 1
    if not batch or not d.get("has_more") or oldest < CUTOFF or page > 300:
        break
    after = d["last_id"]

out = data("sessions.jsonl")
with open(out, "w", encoding="utf-8") as f:
    for s in sorted(seen.values(), key=lambda s: s["created_at"]):
        f.write(json.dumps(s, ensure_ascii=False) + "\n")
print("保存 %d セッション -> %s" % (len(seen), os.path.relpath(out)))
