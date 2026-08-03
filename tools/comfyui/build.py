"""レシピ1つから、絵を1枚作り直す（生成 → 後処理）。

同じ絵をもう一度得るために必要な値は、すべて recipes/*.json に入っている。作り直したいときは
このスクリプトを走らせるだけでよく、手順を覚えている必要はない。

    python build.py recipes/rocky_field_fixture.json

後処理はレシピが postprocess を持つならレーンの背景として（postprocess.py）、cardArt を持つなら
カードの絵として（card_art.py）扱う。

--keep-raw を付けると、後処理前の生成物を残す（プロンプトを詰め直すときに見比べられる）。
ComfyUIは要るが、起動していなければこちらで起動する。
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
COMFY = Path(os.environ.get("LOCALAPPDATA", "")) / "Comfy-Desktop/ComfyUI-Installs/ComfyUI/ComfyUI"
# 直前に流したワークフローの種類。リポジトリではなく実行環境の状態なので一時ディレクトリに置く。
STATE = Path(tempfile.gettempdir()) / "unmapped-island-comfyui-workflow.txt"


def run(script: str, args: list[str]) -> None:
    command = [sys.executable, str(HERE / script), *args]
    print("$", " ".join(command), flush=True)
    subprocess.run(command, check=True, cwd=HERE)


def restart_server(server: str) -> None:
    """ComfyUIを起動し直し、応答するまで待つ。"""
    port = server.rsplit(":", 1)[-1]
    subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | "
         f"Where-Object {{ $_.CommandLine -like '*main.py --port {port}*' }} | "
         "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"],
        check=False,
    )
    subprocess.Popen(
        [str(COMFY / ".venv/Scripts/python.exe"), "main.py", "--port", port],
        cwd=COMFY, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    for _ in range(60):
        try:
            urllib.request.urlopen(f"{server}/system_stats", timeout=5)
            print("ComfyUIを起動し直しました", flush=True)
            return
        except (urllib.error.URLError, OSError):
            time.sleep(3)
    raise SystemExit("ComfyUIが起動しません")


def ensure_fresh_process(workflow: str, server: str) -> None:
    """タイリングを使う生成と使わない生成が同じプロセスに混ざらないようにする。

    パディングの差し替えは掛けたぶんを戻しているが、それでも完全には元へ戻らない（実測で、
    タイリングを挟むと後続の生成が平均1.94ずれる。挟まなければ差は0）。絵としては同じでも
    レシピから同じPNGが得られなくなるので、種類が変わる境目でプロセスごと作り直す。
    """
    kind = "tiling" if "tiling" in workflow else "plain"
    if STATE.exists() and STATE.read_text("utf-8").strip() == kind:
        return
    restart_server(server)
    STATE.write_text(kind, "utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("recipe")
    parser.add_argument("--keep-raw", metavar="DIR", help="後処理前の生成物を残すディレクトリ")
    parser.add_argument("--server", default="http://127.0.0.1:8188")
    args = parser.parse_args()

    recipe = json.loads(Path(args.recipe).read_text("utf-8"))
    output = REPO / recipe["output"]
    workflow = recipe["workflow"]
    ensure_fresh_process(workflow, args.server)

    with tempfile.TemporaryDirectory() as tmp:
        raw_dir = Path(args.keep_raw) if args.keep_raw else Path(tmp)
        raw_dir.mkdir(parents=True, exist_ok=True)

        run(
            "generate.py",
            [
                recipe["prompt"],
                "--out", str(raw_dir),
                "--seed", str(recipe["seed"]),
                "--width", str(recipe["width"]),
                "--height", str(recipe["height"]),
                "--workflow", workflow,
                *(["--prompts", recipe["prompts"]] if recipe.get("prompts") else []),
                *(["--lora", recipe["lora"]] if recipe.get("lora") else []),
                # 0は「LoRAを効かせない」という指定なので、getの真偽で見てはいけない。
                *(["--lora-strength", str(recipe["loraStrength"])] if "loraStrength" in recipe else []),
                *(["--no-trigger"] if recipe.get("noTrigger") else []),
                "--server", args.server,
            ],
        )
        raw = raw_dir / f"{recipe['prompt']}_{recipe['seed']}.png"
        if not raw.exists():
            raise SystemExit(f"生成物が見つかりません: {raw}")

        # 後処理の設定は絵の隣ではなくレシピ側が持つので、書き出された .json は捨ててよい。
        processed = raw_dir / f"{raw.stem}_processed.png"
        if "cardArt" in recipe:
            card = recipe["cardArt"]
            run(
                "card_art.py",
                [
                    str(raw),
                    "--out", str(processed),
                    "--size", str(card["size"]),
                    *(["--mode", card["mode"]] if card.get("mode") else []),
                    *(["--crop", *map(str, card["crop"])] if card.get("crop") else []),
                    *(["--diagonal"] if card.get("diagonal") else []),
                    *(["--tolerance", str(card["tolerance"])] if "tolerance" in card else []),
                    *(["--edge", str(card["edge"])] if "edge" in card else []),
                    *(["--shadow", str(card["shadow"])] if "shadow" in card else []),
                    *(["--reach", str(card["reach"])] if "reach" in card else []),
                    *(["--white", str(card["white"])] if "white" in card else []),
                    *(["--opaque", str(card["opaque"])] if "opaque" in card else []),
                    *(["--feather", str(card["feather"])] if "feather" in card else []),
                    *(["--drop-shadow", str(card["dropShadow"])] if "dropShadow" in card else []),
                    *(["--drop-offset", str(card["dropOffset"])] if "dropOffset" in card else []),
                    *(["--drop-blur", str(card["dropBlur"])] if "dropBlur" in card else []),
                    *(["--saturation", str(card["saturation"])] if "saturation" in card else []),
                    *(["--gamma", str(card["gamma"])] if "gamma" in card else []),
                ],
            )
        elif "cardFrame" in recipe:
            frame = recipe["cardFrame"]
            run(
                "card_frame.py",
                [
                    str(raw),
                    "--out", str(processed),
                    *(["--width", str(frame["width"])] if "width" in frame else []),
                    *(["--height", str(frame["height"])] if "height" in frame else []),
                    *(["--margin", str(frame["margin"])] if "margin" in frame else []),
                    *(["--radius", str(frame["radius"])] if "radius" in frame else []),
                    "--paper", frame["paper"],
                    "--wash", str(frame["wash"]),
                    "--edge", frame["edge"],
                    "--edge-width", str(frame["edgeWidth"]),
                    "--shadow-offset", *map(str, frame["shadowOffset"]),
                    "--shadow-blur", str(frame["shadowBlur"]),
                    "--shadow-alpha", str(frame["shadowAlpha"]),
                ],
            )
        elif "pageArt" in recipe:
            page = recipe["pageArt"]
            run(
                "page_art.py",
                [
                    str(raw),
                    "--out", str(processed),
                    "--crop", *map(str, page["crop"]),
                    "--cover-side", page["coverSide"],
                    "--fade", str(page["fade"]),
                    "--short", str(page["short"]),
                    "--blend", str(page["blend"]),
                    *(["--paper", page["paper"],
                       "--paper-curve", *map(str, page["paperCurve"])] if page.get("paper") else []),
                    *[str(v) for start, end in page.get("cut", []) for v in ("--cut", start, end)],
                    *[str(v) for start, end in page.get("cutRows", []) for v in ("--cut-rows", start, end)],
                ],
            )
        else:
            post = recipe["postprocess"]
            run(
                "postprocess.py",
                [
                    str(raw),
                    "--out", str(processed),
                    "--width", str(post["width"]),
                    "--height", str(post["height"]),
                    "--oilify-radius", str(post["oilifyRadius"]),
                    "--oilify-levels", str(post["oilifyLevels"]),
                    *(["--flatten", str(post["flatten"])] if post.get("flatten") else []),
                    # 色味を寄せる基準は、リポジトリ内の出来上がった絵を指す（同じ土地の別レーンなど）。
                    *(["--match", str(REPO / post["matchTone"]),
                       "--match-strength", str(post["matchStrength"])] if post.get("matchTone") else []),
                ],
            )

        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(processed.read_bytes())
        print(f"-> {output}", flush=True)


if __name__ == "__main__":
    main()
