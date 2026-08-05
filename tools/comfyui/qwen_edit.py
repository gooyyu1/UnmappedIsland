"""Qwen Image Edit 2511 で、既存の絵から派生画像を1枚作る。

入力画像を ComfyUI の /upload/image へ上げ、workflows/qwen_image_edit_2511.api.json に
プロンプトと seed を差し込んで /prompt へ投げる。標準ライブラリだけで動く。

    python qwen_edit.py <入力PNG> --out <出力PNG> --prompt "<英語の編集指示>" --seed 1

同一プロセス・同一入力・同一 seed なら同じ絵が返る。使い方の全体は README.md を参照。
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.request
import uuid
from pathlib import Path

from generate import DEFAULT_SERVER, download, fill, post_prompt, wait_for_images

HERE = Path(__file__).resolve().parent
WORKFLOW = "qwen_image_edit_2511.api.json"


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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="基準にする画像（生成の生データなど）")
    parser.add_argument("--out", required=True, help="PNGの保存先ファイル")
    parser.add_argument("--prompt", required=True, help="編集指示（英語）")
    parser.add_argument("--seed", type=int, required=True)
    parser.add_argument("--server", default=DEFAULT_SERVER)
    parser.add_argument("--timeout", type=float, default=900)
    args = parser.parse_args()

    template = json.loads((HERE / "workflows" / WORKFLOW).read_text("utf-8"))
    image_name = upload_image(args.server, Path(args.input))
    workflow = fill(
        template,
        {
            "image": image_name,
            "prompt": args.prompt,
            "seed": args.seed,
            "prefix": "unmapped-island/qwen_edit",
        },
    )

    print(f"seed={args.seed} 編集中...")
    started = time.time()
    prompt_id = post_prompt(args.server, workflow)
    images = wait_for_images(args.server, prompt_id, args.timeout)
    print(f"    {time.time() - started:.0f}秒で完了")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    download(args.server, images[0], out)
    print(f"    -> {out}")


if __name__ == "__main__":
    main()
