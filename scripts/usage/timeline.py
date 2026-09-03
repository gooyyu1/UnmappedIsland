"""使用量を時間・日・週ごとに集計し、stats/usage/ へ書く。

出どころが2つあり、重なっている。

  - CCR (list_sessions): `cost_usd` を持つ。時刻はセッション単位しか無いので
    created_at〜updated_at の区間へ均等に割る。クラウドと bridge の両方を含む。
  - ローカル (~/.claude/projects): メッセージ単位の時刻を持つが `cost_usd` が無い。

bridge（ローカル実行）は両方に現れるので、CCR 側で数えて、対応するローカルの
transcript を落とす。残ったローカル分は公称単価 × RATE で CCR の額と揃える
（RATE は calibrate.py で実測した比）。

週の区切りは課金の窓に合わせ、木曜16:00 UTC 始まり（`seven_day` のリセット時刻）。
"""

import datetime as dt
import json
import os
from collections import defaultdict

from calibrate import PRICE, linked_session_files
from paths import data, stats, usage

START = dt.datetime(2000, 1, 1, tzinfo=dt.timezone.utc)
RATE = 1 / 2.69  # 公称単価から CCR の cost_usd へ揃える係数（calibrate.py の実測）
COLS = ("input", "output", "cache_write", "cache_read")


def ts(s):
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def week_start(t):
    """木曜16:00 UTC 始まりの週の、始まりの日付。"""
    b = t - dt.timedelta(hours=16)
    return (b - dt.timedelta(days=(b.weekday() - 3) % 7)).strftime("%Y-%m-%d")


def main():
    hour = defaultdict(lambda: defaultdict(float))

    def add(t, c, tok):
        if t < START:
            return
        k = t.replace(minute=0, second=0, microsecond=0)
        hour[k]["cost"] += c
        for a, b in tok.items():
            hour[k][a] += b

    sessions = [json.loads(l) for l in open(data("sessions.jsonl"), encoding="utf-8")]
    ccr_cost = 0.0
    for s in sessions:
        u = usage(s)
        c = u.get("cost_usd") or 0
        if not c:
            continue
        a, b = ts(s["created_at"]), ts(s.get("updated_at") or s["created_at"])
        n = max(1, int((b - a).total_seconds() // 3600) + 1)
        tok = {
            "input": u.get("input_tokens", 0),
            "output": u.get("output_tokens", 0),
            "cache_write": u.get("cache_write_tokens", 0),
            "cache_read": u.get("cache_read_tokens", 0),
        }
        for i in range(n):
            add(a + dt.timedelta(hours=i), c / n, {k: v / n for k, v in tok.items()})
        ccr_cost += c

    linked = linked_session_files(sessions)
    local_cost = 0.0
    for r in (json.loads(l) for l in open(data("local_usage.jsonl"), encoding="utf-8")):
        if r["session_id"] in linked or not r["ts"]:
            continue
        tok = {k: r[k] for k in COLS}
        c = sum(tok[k] * PRICE[k] / 1e6 for k in COLS) * RATE
        add(ts(r["ts"]), c, tok)
        local_cost += c

    def dump(name, keyf, label):
        agg = defaultdict(lambda: defaultdict(float))
        for t, v in hour.items():
            for k, x in v.items():
                agg[keyf(t)][k] += x
        with open(stats(name), "w", encoding="utf-8", newline="\n") as f:
            f.write("%s\tcost_usd\t%s\n" % (label, "\t".join(COLS)))
            for k in sorted(agg):
                v = agg[k]
                f.write("%s\t%.4f\t%s\n" % (k, v["cost"], "\t".join("%d" % v[c] for c in COLS)))
        return agg

    dump("by_hour.tsv", lambda t: t.strftime("%Y-%m-%dT%H:00Z"), "hour_utc")
    dump("by_day.tsv", lambda t: t.strftime("%Y-%m-%d"), "day_utc")
    wk = dump("by_week.tsv", week_start, "week_start_thu16utc")

    print("CCR $%.2f + ローカル(CCR未記録分) $%.2f = 合計 $%.2f" % (ccr_cost, local_cost, ccr_cost + local_cost))
    print()
    print("%-14s %11s %10s %10s %11s %11s" % ("週(木16:00UTC〜)", "コスト", "入力", "出力", "cacheWrite", "cacheRead"))
    for k in sorted(wk):
        v = wk[k]
        print(
            "%-14s $%10.2f %9.2fM %9.2fM %10.0fM %10.0fM"
            % (k, v["cost"], v["input"] / 1e6, v["output"] / 1e6, v["cache_write"] / 1e6, v["cache_read"] / 1e6)
        )
    print()
    print("保存: %s (時間 %d行 / 日 / 週)" % (os.path.relpath(stats("")), len(hour)))


if __name__ == "__main__":
    main()
