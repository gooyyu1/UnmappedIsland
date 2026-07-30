"""ComfyUIのHTTP APIでレーンの背景画像を生成する。

ComfyUIの画面を操作せず、API形式のワークフロー（workflows/*.api.json）へプロンプトなどを
差し込んで /prompt へ投げる。標準ライブラリだけで動くので、どのPythonからでも実行できる。

生成物と一緒に、実際に使われた値（seedを含む）を .json として書き出す。これがあれば同じ絵を
作り直せる。

    python generate.py rocky_field_fixture --out ../../src/assets/lanes/_raw

使い方の全体は README.md を参照。
"""

from __future__ import annotations

import argparse
import json
import random
import time
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_SERVER = "http://127.0.0.1:8188"

# 切り出しの余白を持たせるため、仕上がり（2048x512）より広く生成する。中央へ寄りがちな
# 特徴物を避けて切り出せるようにするのが狙い（README「大きめに生成して切り出す」）。
DEFAULT_WIDTH = 2560
DEFAULT_HEIGHT = 640


def fill(node_tree: dict, values: dict) -> dict:
    """ワークフローの "$name" プレースホルダを values の中身へ置き換える。"""

    def walk(node: object) -> object:
        if isinstance(node, dict):
            return {k: walk(v) for k, v in node.items() if not k.startswith("_")}
        if isinstance(node, list):
            return [walk(v) for v in node]
        if isinstance(node, str) and node.startswith("$"):
            key = node[1:]
            if key not in values:
                raise KeyError(f"ワークフローの ${key} に対する値がありません")
            return values[key]
        return node

    return walk(node_tree)  # type: ignore[return-value]


def post_prompt(server: str, workflow: dict) -> str:
    body = json.dumps({"prompt": workflow}).encode()
    request = urllib.request.Request(
        f"{server}/prompt", body, {"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(request) as response:
        return json.load(response)["prompt_id"]


def wait_for_images(server: str, prompt_id: str, timeout: float) -> list[dict]:
    """生成が終わるまで待ち、出力された画像の {filename, subfolder, type} を返す。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        with urllib.request.urlopen(f"{server}/history/{prompt_id}") as response:
            history = json.load(response)
        entry = history.get(prompt_id)
        if entry is not None:
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                raise RuntimeError(f"生成に失敗しました: {json.dumps(status, ensure_ascii=False)}")
            images = [
                image
                for output in entry.get("outputs", {}).values()
                for image in output.get("images", [])
            ]
            if images:
                return images
        time.sleep(2)
    raise TimeoutError(f"{timeout}秒待っても生成が終わりませんでした")


def download(server: str, image: dict, destination: Path) -> None:
    query = urllib.parse.urlencode(
        {
            "filename": image["filename"],
            "subfolder": image.get("subfolder", ""),
            "type": image.get("type", "output"),
        }
    )
    with urllib.request.urlopen(f"{server}/view?{query}") as response:
        destination.write_bytes(response.read())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("name", help="prompts/lane_backgrounds.json のキー（例: rocky_field_fixture）")
    parser.add_argument("--out", required=True, help="PNGの保存先ディレクトリ")
    parser.add_argument("--seed", type=int, help="省略すると乱数。記録されるので後から再現できる")
    parser.add_argument("--width", type=int, default=DEFAULT_WIDTH)
    parser.add_argument("--height", type=int, default=DEFAULT_HEIGHT)
    parser.add_argument("--count", type=int, default=1, help="seedを変えて複数枚出す")
    parser.add_argument("--server", default=DEFAULT_SERVER)
    parser.add_argument("--timeout", type=float, default=900)
    args = parser.parse_args()

    prompts = json.loads((HERE / "prompts" / "lane_backgrounds.json").read_text("utf-8"))
    if args.name not in prompts:
        raise SystemExit(f"'{args.name}' は prompts/lane_backgrounds.json にありません")
    entry = prompts[args.name]
    template = json.loads((HERE / "workflows" / "lane_background.api.json").read_text("utf-8"))

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    for index in range(args.count):
        seed = args.seed if args.seed is not None else random.getrandbits(48)
        if args.seed is not None and args.count > 1:
            seed += index

        negative = prompts["sharedNegative"]
        if entry.get("negativeExtra"):
            negative += ", " + entry["negativeExtra"]

        values = {
            "positive": entry["positive"],
            "negative": negative,
            "width": args.width,
            "height": args.height,
            "seed": seed,
            "prefix": f"unmapped-island/{args.name}",
        }
        workflow = fill(template, values)

        print(f"[{index + 1}/{args.count}] seed={seed} {args.width}x{args.height} 生成中...")
        started = time.time()
        prompt_id = post_prompt(args.server, workflow)
        images = wait_for_images(args.server, prompt_id, args.timeout)
        print(f"    {time.time() - started:.0f}秒で完了")

        for image_index, image in enumerate(images):
            suffix = "" if len(images) == 1 else f"_{image_index}"
            stem = f"{args.name}_{seed}{suffix}"
            download(args.server, image, out_dir / f"{stem}.png")
            # 同じ絵を作り直すのに要る情報を、絵の隣へ丸ごと残す。
            (out_dir / f"{stem}.json").write_text(
                json.dumps(
                    {"name": args.name, "seed": seed, "values": values, "workflow": workflow},
                    ensure_ascii=False,
                    indent=2,
                ),
                "utf-8",
            )
            print(f"    -> {out_dir / f'{stem}.png'}")


if __name__ == "__main__":
    main()
