"""生データの置き場と、CCR のメタデータから値を取り出す小道具。

生データ（セッション一覧の生JSON・イベント）はリポジトリへ入れない。セッションIDと
環境ID、それにタイトルとして残る指示の原文が入るため。既定の置き場 `.usage-data/` は
.gitignore 済みで、`USAGE_DATA_DIR` で外へ移せる。
"""

import os

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.environ.get("USAGE_DATA_DIR") or os.path.join(REPO, ".usage-data")
STATS = os.path.join(REPO, "stats", "usage")


def data(*parts):
    """生データの置き場の下のパスを返す。途中のディレクトリは作る。"""
    p = os.path.join(DATA, *parts)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    return p


def stats(*parts):
    """集計結果（リポジトリへ入れる）の置き場の下のパスを返す。"""
    p = os.path.join(STATS, *parts)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    return p


def usage(session):
    """セッションのメタデータから usage を取り出す。欠けていれば空の辞書。"""
    return ((session.get("external_metadata") or {}).get("usage") or {}) or {}


def cost(session):
    return usage(session).get("cost_usd") or 0.0
