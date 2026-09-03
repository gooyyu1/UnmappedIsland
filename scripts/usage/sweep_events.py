"""セッションごとのイベントをまとめて落とす。

    python sweep_events.py [YYYY-MM-DD 以降]

途中で止めても、既に落ちているセッションは飛ばして続きから走る。
1セッションあたり数十回のHTTPになるので、全期間へ広げると時間がかかる。
"""

import concurrent.futures as cf
import json
import os
import sys
import traceback

from fetch_events import fetch
from paths import cost, data

SINCE = (sys.argv[1] if len(sys.argv) > 1 else "2000-01-01") + "T00:00:00Z"


def one(sid):
    path = data("events", sid + ".jsonl")
    if os.path.exists(path):
        return sid, -1
    rows = fetch(sid)
    tmp = path + ".part"
    with open(tmp, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    os.replace(tmp, path)
    return sid, len(rows)


def main():
    sessions = [json.loads(line) for line in open(data("sessions.jsonl"), encoding="utf-8")]
    ids = [s["id"] for s in sessions if s["created_at"] >= SINCE]
    # 重いものから先に流して、末尾で1本だけ残るのを避ける
    by_cost = {s["id"]: cost(s) for s in sessions}
    ids.sort(key=lambda i: -by_cost.get(i, 0))
    print("対象 %d セッション" % len(ids), flush=True)

    done = fail = 0
    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(one, i): i for i in ids}
        for fut in cf.as_completed(futs):
            sid = futs[fut]
            try:
                fut.result()
            except Exception:
                fail += 1
                print("FAIL %s\n%s" % (sid, traceback.format_exc(limit=1)), file=sys.stderr, flush=True)
                continue
            done += 1
            if done % 25 == 0:
                print("%d/%d done (fail %d)" % (done, len(ids), fail), flush=True)
    print("完了 done=%d fail=%d" % (done, fail))


main()
