"""ローカル分のコスト換算に使う係数を、実測から求める。

ローカルの transcript は `cost_usd` を持たないので、公称単価で計算するしかない。
ところが CCR の `cost_usd` は公称単価では出ない額になっている。両方に現れる
セッション（bridge = ローカル実行）で突き合わせれば、その比が分かる。

bridge は worktree 名に CCR の session id 後半が入るので、~/.claude/projects の
ディレクトリ名から突き合わせられる。
"""

import glob
import json
import os
import re
from collections import defaultdict

from paths import cost, data

ROOT = os.path.expanduser("~/.claude/projects")
# $/Mtok（Opus の公称）
PRICE = {"input": 15.0, "output": 75.0, "cache_write": 18.75, "cache_read": 1.5}


def linked_dirs(sessions):
    """CCR のセッションIDに対応するローカルのディレクトリを返す（id 後半 -> パス）。"""
    ids = {s["id"] for s in sessions}
    out = {}
    for d in glob.glob(os.path.join(ROOT, "*")):
        m = re.search(r"([0-9A-Za-z]{24})$", os.path.basename(d))
        if m and ("session_" + m.group(1)) in ids:
            out[m.group(1)] = d
    return out


def linked_session_files(sessions):
    """CCR に記録済みのローカル transcript のファイル名（= ローカル側の session_id）。"""
    out = set()
    for d in linked_dirs(sessions).values():
        out.update(os.path.basename(p)[:-6] for p in glob.glob(os.path.join(d, "*.jsonl")))
    return out


def main():
    sessions = [json.loads(l) for l in open(data("sessions.jsonl"), encoding="utf-8")]
    bridge = {s["id"]: s for s in sessions if s.get("environment_kind") == "bridge"}
    dirs = linked_dirs(sessions)

    tok = defaultdict(lambda: defaultdict(int))
    for r in (json.loads(l) for l in open(data("local_usage.jsonl"), encoding="utf-8")):
        for k in PRICE:
            tok[r["session_id"]][k] += r[k]

    rows, hit = [], 0
    for sid, s in bridge.items():
        d = dirs.get(sid.replace("session_", ""))
        if not d:
            continue
        hit += 1
        agg = defaultdict(int)
        for p in glob.glob(os.path.join(d, "*.jsonl")):
            for k, v in tok.get(os.path.basename(p)[:-6], {}).items():
                agg[k] += v
        calc = sum(agg[k] * PRICE[k] / 1e6 for k in PRICE)
        real = cost(s)
        if real:
            rows.append((real, calc, s["title"][:26].replace("\n", " ")))

    print("bridge %d本中 %d本をローカルのディレクトリと照合できた" % (len(bridge), hit))
    print()
    print("%9s %10s %6s  %s" % ("CCRの額", "公称単価で", "比", "タイトル"))
    for real, calc, t in sorted(rows, key=lambda x: -x[0])[:10]:
        print("$%8.2f $%9.2f %5.2fx  %s" % (real, calc, calc / real, t))
    tr, tc = sum(r[0] for r in rows), sum(r[1] for r in rows)
    print()
    print("照合 %d本: CCR $%.2f / 公称単価 $%.2f" % (len(rows), tr, tc))
    print("係数 RATE = 1/%.2f （timeline.py はこれを使う）" % (tc / tr))


if __name__ == "__main__":
    main()
