"""Qwen Image Edit 2511 で、既存の絵から派生画像を1枚作る。

入力画像を ComfyUI の /upload/image へ上げ、workflows/qwen_image_edit_2511.api.json に
プロンプトと seed を差し込んで /prompt へ投げる。標準ライブラリだけで動く。

    python qwen_edit.py <入力PNG> --out <出力PNG> --prompt "<英語の編集指示>" --seed 1

同一プロセス・同一入力・同一 seed なら同じ絵が返る。--raw-store を渡すと、置き場（raw_store.py）に
同じ入力の絵があればComfyUIへ投げずにそれを使う。使い方の全体は README.md を参照。
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

import raw_store
from generate import DEFAULT_SERVER, download, ensure_running, fill, post_prompt, wait_for_images

HERE = Path(__file__).resolve().parent
WORKFLOW = "qwen_image_edit_2511.api.json"
PREFIX = "unmapped-island/qwen_edit"


def upload_image(server: str, path: Path) -> str:
    """入力画像をComfyUIへ上げ、LoadImageに渡すファイル名を返す。"""
    boundary = uuid.uuid4().hex
    body = b"".join(
        [
            f"--{boundary}\r\n".encode(),
            b'Content-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n',
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="image"; filename="{path.name}"\r\n'.encode(),
            b"Content-Type: image/png\r\n\r\n",
            path.read_bytes(),
            f"\r\n--{boundary}--\r\n".encode(),
        ]
    )
    request = urllib.request.Request(
        f"{server}/upload/image",
        body,
        {"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(request) as response:
        return json.load(response)["name"]


def free_models(server: str) -> None:
    """載っているモデルをVRAMから降ろさせる。

    Qwen Image Edit はSDXLと並べてVRAM 16GBに収まらない。直前の生成が載ったままだとあふれるので、
    投げる前に空ける。降ろせなくても生成自体は試みる（失敗すればそちらで分かる）。
    """
    body = json.dumps({"unload_models": True, "free_memory": True}).encode()
    request = urllib.request.Request(f"{server}/free", body, {"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(request, timeout=60)
    except (urllib.error.URLError, OSError) as error:
        print(f"VRAMを空けられませんでした（続行します）: {error}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="基準にする画像（生成の生データなど）")
    parser.add_argument("--out", required=True, help="PNGの保存先ファイル")
    parser.add_argument("--prompt", required=True, help="編集指示（英語）")
    parser.add_argument("--seed", type=int, required=True)
    parser.add_argument("--raw-store", help="生データの置き場。同じ入力の絵があれば編集しない")
    parser.add_argument("--server", default=DEFAULT_SERVER)
    parser.add_argument("--timeout", type=float, default=900)
    args = parser.parse_args()

    template = json.loads((HERE / "workflows" / WORKFLOW).read_text("utf-8"))
    source = Path(args.input).read_bytes()
    values = {"prompt": args.prompt, "seed": args.seed, "prefix": PREFIX}
    # 鍵は入力画像の中身（source）で表すので、ワークフローの側は $image を伏せたまま渡す。
    # ComfyUIへ上げたときのファイル名は絵を決めないので、鍵に入れてはいけない。
    raw_key = raw_store.key(raw_store.digest(source), fill(template, {"image": "$input", **values}))
    out = Path(args.out)
    store = raw_store.Store(args.raw_store) if args.raw_store else None
    data = store.get(out.stem, raw_key) if store else None

    if data is None:
        ensure_running(args.server)
        free_models(args.server)
        workflow = fill(template, {"image": upload_image(args.server, Path(args.input)), **values})
        print(f"seed={args.seed} 編集中...")
        started = time.time()
        prompt_id = post_prompt(args.server, workflow)
        images = wait_for_images(args.server, prompt_id, args.timeout)
        print(f"    {time.time() - started:.0f}秒で完了")
        data = download(args.server, images[0])
        if store:
            print(f"    置き場へ {store.put(out.stem, raw_key, data).name}")
    else:
        print(f"seed={args.seed} 置き場の生データを使います")

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)
    print(f"    -> {out}")


if __name__ == "__main__":
    main()
