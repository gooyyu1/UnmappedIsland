"""使用量を時間・日・週ごとに集計し、stats/usage/ へ書く。

    python timeline.py [YYYY-MM-DD この日以降だけ測り直す]

**ローカルの transcript は古いものから消える**（Claude Code が無期限には持たない）ので、
**一度測った時間は取り直せない。** 何も渡さずに走らせると、消えたぶんだけ過去の額が痩せた
表で上書きしてしまう。境目を渡すと、**それより前の時間は既に在る `by_hour.tsv` の値を
そのまま持ち越す**——渡す値は、生データを取り直した範囲の先頭に合わせる。

出どころが2つあり、重なっている。

  - CCR (list_sessions): `cost_usd` を持つ。メタデータの時刻はセッション単位しか無いので、
    **イベントの記録が在ればその時刻ごとのトークン量で配り**、無ければ created_at〜updated_at
    へ均等に割る（`hour_weights`）。クラウドと bridge の両方を含む。
  - ローカル (~/.claude/projects): メッセージ単位の時刻を持つが `cost_usd` が無い。

bridge（ローカル実行）は両方に現れるので、CCR 側で数えて、対応するローカルの
transcript を落とす。残ったローカル分は公称単価 × RATE で CCR の額と揃える
（RATE は calibrate.py で実測した比）。

週の区切りは課金の窓に合わせ、木曜16:00 UTC 始まり（`seven_day` のリセット時刻）。
"""

import datetime as dt
import csv
import json
import os
import sys
from collections import defaultdict

from calibrate import PRICE, linked_session_files
from paths import data, stats, usage

START = dt.datetime(2000, 1, 1, tzinfo=dt.timezone.utc)
RATE = 1 / 2.69  # 公称単価から CCR の cost_usd へ揃える係数（calibrate.py の実測）
COLS = ("input", "output", "cache_write", "cache_read")
# 時間へ配る重みに使うトークン。**`output` は入れない**——イベントの `output_tokens` は
# メタデータと合わない固定値が入っている（README「数字の限界」）。
WEIGHT_COLS = ("input", "cache_write", "cache_read")


def ts(s):
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def week_start(t):
    """木曜16:00 UTC 始まりの週の、始まりの日付。"""
    b = t - dt.timedelta(hours=16)
    return (b - dt.timedelta(days=(b.weekday() - 3) % 7)).strftime("%Y-%m-%d")


def hour_weights(session, keep):
    """セッションの額を時間へ配る割合（時刻 -> 割合。合計1）。

    **イベントの記録が在れば、その時刻ごとのトークン量で配る。** メタデータは
    created_at〜updated_at しか持たず、均等に割ると**止まっていた時間にも額が乗る**——枠が
    尽きて数日空き、同じセッションが再開した区間で、イベントが1件しか無い2日間へ $345 が
    塗られていた（2026-09-01〜09-02）。イベントの無いセッションは均等割りのまま。

    **`keep` より前に始まったセッションは、イベントが在っても均等割りにする。** `keep` より前の
    時間は**旧の集計から持ち越す**ので、境目を跨ぐセッションを別の配り方で数え直すと、持ち越した
    取り分と数え直した取り分が噛み合わず、**そのセッションの額が二重に乗るか、消える**。配り方を
    揃えておけば、前半は持ち越し・後半は計算のままで合計がちょうど `cost_usd` になる。

    重みは公称単価でトークンを足したもの。配るのは既知の総額なので、要るのは比だけ。
    """
    if keep is None or ts(session["created_at"]) >= keep:
        path = data("events", "%s.jsonl" % session["id"])
        if os.path.exists(path):
            weight = defaultdict(float)
            with open(path, encoding="utf-8") as f:
                for line in f:
                    r = json.loads(line)
                    if not r.get("ts"):
                        continue
                    at = ts(r["ts"]).replace(minute=0, second=0, microsecond=0)
                    weight[at] += sum((r.get(c) or 0) * PRICE[c] for c in WEIGHT_COLS)
            total = sum(weight.values())
            if total > 0:
                return {at: w / total for at, w in weight.items()}
    a = ts(session["created_at"])
    b = ts(session.get("updated_at") or session["created_at"])
    n = max(1, int((b - a).total_seconds() // 3600) + 1)
    return {a + dt.timedelta(hours=i): 1 / n for i in range(n)}


def main():
    # 測り直す範囲の先頭。渡されなければ全部を測り直す（持ち越し無し）。
    keep = (
        dt.datetime.fromisoformat(sys.argv[1]).replace(tzinfo=dt.timezone.utc)
        if len(sys.argv) > 1
        else None
    )
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
        tok = {
            "input": u.get("input_tokens", 0),
            "output": u.get("output_tokens", 0),
            "cache_write": u.get("cache_write_tokens", 0),
            "cache_read": u.get("cache_read_tokens", 0),
        }
        for at, share in hour_weights(s, keep).items():
            add(at, c * share, {k: v * share for k, v in tok.items()})
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

    if keep is not None:
        for t in [t for t in hour if t < keep]:
            del hour[t]
        carried = 0
        with open(stats("by_hour.tsv"), encoding="utf-8") as f:
            for r in csv.DictReader(f, delimiter="\t"):
                t = ts(r["hour_utc"].replace("T", " ").replace(":00Z", ":00:00Z"))
                if t >= keep:
                    continue
                hour[t]["cost"] += float(r["cost_usd"])
                for c in COLS:
                    hour[t][c] += float(r[c])
                carried += 1
        print("%s より前の %d 時間は、既にある集計から持ち越し" % (sys.argv[1], carried))

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

    # 持ち越した時間はこの2つに入らないので、書いた表の合計は別に足す。
    print("CCR $%.2f + ローカル(CCR未記録分) $%.2f / 表の合計 $%.2f" % (ccr_cost, local_cost, sum(v["cost"] for v in hour.values())))
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
