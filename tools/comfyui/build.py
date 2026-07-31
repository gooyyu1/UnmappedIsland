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
    workflow = recipe.get("workflow", "lane_background.api.json")
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
                *(["--lora-strength", str(recipe["loraStrength"])] if recipe.get("loraStrength") else []),
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
                    "--white", str(card["white"]),
                    "--opaque", str(card["opaque"]),
                    "--feather", str(card["feather"]),
                    *(["--keep-paper"] if card.get("keepPaper") else []),
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
