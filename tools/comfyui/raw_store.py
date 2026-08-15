"""ComfyUIの生成物（後処理前の生データ）の置き場。

生データは別リポジトリ（[UnmappedIsland-art-raw](https://github.com/gooyyu1/UnmappedIsland-art-raw)）に
置く。名前・鍵の決め方と、なぜ分けているかはそちらのREADMEにある。ここが持つのは、

- 手の入力から鍵を作る（`key`）
- 置き場にあれば返し、無ければ台帳（`raw.lock.json`）を見て取ってくる（`Store.get`）
- 作った生データを置いて台帳へ書く（`Store.put`）

の3つ。`generate.py` と `qwen_edit.py` が、ComfyUIへ投げる前にここへ訊く。**あるものは作らない**ので、
連鎖の途中や複数のレシピが共有する絵が二度生成されず、ComfyUIの無い環境でも後処理だけを掛け直せる。
"""

from __future__ import annotations

import hashlib
import json
import os
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
# 台帳は recipes/ へ置かない。あそこを *.json で走査すると、台帳自身がレシピとして拾われる。
LOCK = HERE / "raw.lock.json"
ENV_DIR = "UNMAPPED_ISLAND_ART_RAW"
REMOTE = "https://raw.githubusercontent.com/gooyyu1/UnmappedIsland-art-raw/main/raw"


def default_dir() -> Path:
    """置き場の既定。環境変数で別リポジトリのcloneを直接指せる。"""
    from_env = os.environ.get(ENV_DIR)
    return Path(from_env) if from_env else REPO / ".art-raw"


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def key(source: str | None, workflow: dict) -> str:
    """生成の1手を、その入力そのものから12桁で表す。

    source は入力画像のsha256（入力を取らない生成ではNone）、workflow は ComfyUI へ投げる直前の
    ワークフロー。**入力画像のファイル名はワークフローへ入れずに source で表す**（qwen_edit.py が
    `$input` のまま鍵を作るのはこのため）。名前は置き場での置き方に過ぎず、絵を決めないので、
    鍵に入れると同じ絵が別の鍵を持つ。
    """
    canonical = json.dumps(
        {"source": source, "workflow": workflow},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:12]


class Store:
    """生データの置き場。台帳の読み書きと取得を引き受ける。"""

    def __init__(self, directory: str | Path | None = None) -> None:
        self.directory = Path(directory) if directory else default_dir()

    def path(self, name: str, raw_key: str) -> Path:
        return self.directory / f"{name}_{raw_key}.png"

    def get(self, name: str, raw_key: str) -> bytes | None:
        """置き場にあれば中身を返す。無ければ台帳にあるものだけ取ってくる。作るべきならNone。"""
        path = self.path(name, raw_key)
        recorded = self._lock().get(path.name)
        if path.exists():
            data = path.read_bytes()
            if recorded is not None and digest(data) != recorded:
                raise SystemExit(
                    f"生データが台帳と一致しません: {path}\n"
                    f"  台帳 {recorded}\n  実物 {digest(data)}"
                )
            return data
        if recorded is None:
            return None
        return self._download(path, recorded)

    def put(self, name: str, raw_key: str, data: bytes) -> Path:
        """作った生データを置き、台帳へsha256を書く。"""
        path = self.path(name, raw_key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        lock = self._lock()
        lock[path.name] = digest(data)
        LOCK.parent.mkdir(parents=True, exist_ok=True)
        LOCK.write_text(
            json.dumps(lock, indent=2, sort_keys=True, ensure_ascii=False) + "\n", "utf-8"
        )
        return path

    def _lock(self) -> dict[str, str]:
        return json.loads(LOCK.read_text("utf-8")) if LOCK.exists() else {}

    def _download(self, path: Path, expected: str) -> bytes:
        url = f"{REMOTE}/{path.name}"
        print(f"生データを取得中: {url}", flush=True)
        try:
            with urllib.request.urlopen(url, timeout=120) as response:
                data = response.read()
        except (urllib.error.URLError, OSError) as error:
            raise SystemExit(f"生データを取得できません: {url}\n  {error}") from error
        if digest(data) != expected:
            raise SystemExit(
                f"取得した生データが台帳と一致しません: {url}\n"
                f"  台帳 {expected}\n  実物 {digest(data)}"
            )
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return data
