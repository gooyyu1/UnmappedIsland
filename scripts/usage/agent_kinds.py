"""エージェントの種別ごとに集計し、stats/usage/by_agent_kind.tsv へ書く。

    python agent_kinds.py <YYYY-MM-DD 以降> [YYYY-MM-DD 未満]

金額は各セッションの `cost_usd` を正とする（単価はモデル混在と長文脈の割増で線形に
解けない）。セッション内の主エージェント／サブエージェントの按分だけ、イベントの
cache_read + cache_write の比で行う。

コストと件数は全セッションで出せるが、turn 数・サブエージェント按分・文脈の畳みは
イベントが要る（sweep_events.py を通した範囲だけ）。

畳みの検出：イベントにコンパクションの印は無いので、主エージェントの cache_read が
直前までの最大より大きく落ちた点を拾う。ただしそこには2種類が混ざる——落ちたあと
小さい値から登り直すのが本当の畳みで、次の turn で元の水準へ戻るのはキャッシュの失効
（アイドルで TTL が切れ、文脈は同じまま書き直しだけ起きる）。直後3turnの戻り方で分ける。
"""

import json
import os
import sys
from collections import defaultdict

from paths import cost, data, stats

DROP = 0.6  # 直前までの最大の6割を下回ったら急落
FLOOR = 40_000  # 立ち上がり途中の小さな揺れを拾わないための下限
BACK = 0.9  # 直後3turnで元の9割まで戻ればキャッシュの失効

# タグの接頭辞 -> 種別。左に無いタグしか付いていなければ環境で分ける。
ALIAS = {"shirei": "commander", "parallel": "commander"}
KNOWN = ("task", "review", "commander", "shirei", "parallel", "adviser", "grammar", "issue", "held")


def kind(s):
    pre = {t.split("-")[0] for t in (s.get("tags") or [])}
    for name in KNOWN:
        if name in pre:
            return ALIAS.get(name, name)
    return "bridge" if s.get("environment_kind") == "bridge" else "untagged"


def drops(rows):
    """主エージェントの cache_read 系列から (畳み, 失効, 畳む直前の平均) を返す。"""
    main = sorted((r for r in rows if not r["parent_tool_use_id"]), key=lambda r: r["ts"] or "")
    fold, miss, peaks, run = 0, 0, [], 0
    for i, r in enumerate(main):
        cr = r["cache_read"]
        if run >= FLOOR and cr < DROP * run:
            if max((x["cache_read"] for x in main[i + 1 : i + 4]), default=0) >= BACK * run:
                miss += 1
            else:
                fold += 1
                peaks.append(run)
            run = cr
        else:
            run = max(run, cr)
    return fold, miss, (sum(peaks) / len(peaks)) if peaks else 0, len(main)


def main():
    since = (sys.argv[1] if len(sys.argv) > 1 else "2000-01-01") + "T00:00:00Z"
    until = (sys.argv[2] if len(sys.argv) > 2 else "2999-01-01") + "T00:00:00Z"
    sessions = [json.loads(l) for l in open(data("sessions.jsonl"), encoding="utf-8")]

    agg = defaultdict(lambda: defaultdict(float))
    for s in sessions:
        if not (since <= s["created_at"] < until):
            continue
        a = agg[kind(s)]
        a["sessions"] += 1
        a["cost"] += cost(s)

        path = data("events", s["id"] + ".jsonl")
        if not os.path.exists(path):
            continue
        rows = [json.loads(l) for l in open(path, encoding="utf-8")]
        sub = [r for r in rows if r["parent_tool_use_id"]]
        tok = sum(r["cache_read"] + r["cache_write"] for r in rows)
        tok_sub = sum(r["cache_read"] + r["cache_write"] for r in sub)
        fold, miss, _, n_main = drops(rows)
        a["with_events"] += 1
        a["turns"] += len(rows)
        a["turns_sub"] += len(sub)
        a["subagent_calls"] += len({r["parent_tool_use_id"] for r in sub})
        a["cost_sub"] += cost(s) * (tok_sub / tok) if tok else 0
        a["folds"] += fold
        a["misses"] += miss
        a["ctx_main"] += sum(r["cache_read"] for r in rows if not r["parent_tool_use_id"])
        a["ctx_sub"] += sum(r["cache_read"] for r in sub)
        a["n_main"] += n_main

    cols = (
        "sessions", "cost_usd", "with_events", "turns", "turns_sub",
        "subagent_calls", "cost_sub_usd", "folds", "cache_misses", "ctx_main_avg", "ctx_sub_avg",
    )
    order = sorted(agg.items(), key=lambda x: -x[1]["cost"])
    with open(stats("by_agent_kind.tsv"), "w", encoding="utf-8", newline="\n") as f:
        f.write("kind\t%s\n" % "\t".join(cols))
        for k, a in order:
            f.write(
                "%s\t%d\t%.4f\t%d\t%d\t%d\t%d\t%.4f\t%d\t%d\t%.0f\t%.0f\n"
                % (
                    k, a["sessions"], a["cost"], a["with_events"], a["turns"], a["turns_sub"],
                    a["subagent_calls"], a["cost_sub"], a["folds"], a["misses"],
                    a["ctx_main"] / a["n_main"] if a["n_main"] else 0,
                    a["ctx_sub"] / a["turns_sub"] if a["turns_sub"] else 0,
                )
            )

    print("期間 %s 〜 %s" % (since[:10], until[:10]))
    print("%-10s %5s %11s %7s %9s %8s %9s %7s %7s" % ("種別", "件数", "コスト", "turn", "$/turn", "sub起動", "sub按分", "畳み", "失効"))
    for k, a in order:
        print(
            "%-10s %5d $%10.2f %7d $%8.3f %8d $%8.2f %7d %7d"
            % (k, a["sessions"], a["cost"], a["turns"], a["cost"] / a["turns"] if a["turns"] else 0,
               a["subagent_calls"], a["cost_sub"], a["folds"], a["misses"])
        )
    t = lambda c: sum(a[c] for a in agg.values())
    print(
        "%-10s %5d $%10.2f %7d $%8.3f %8d $%8.2f %7d %7d"
        % ("合計", t("sessions"), t("cost"), t("turns"), t("cost") / t("turns") if t("turns") else 0,
           t("subagent_calls"), t("cost_sub"), t("folds"), t("misses"))
    )
    miss = t("sessions") - t("with_events")
    if miss:
        print("\n※ turn 以降の列は、イベントを取得済みの %d 本のみ（未取得 %d 本）" % (t("with_events"), miss))


if __name__ == "__main__":
    main()
