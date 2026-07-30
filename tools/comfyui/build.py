"""レシピ1つから、レーンの背景画像を作り直す（生成 → 後処理）。

同じ絵をもう一度得るために必要な値は、すべて recipes/*.json に入っている。作り直したいときは
このスクリプトを走らせるだけでよく、手順を覚えている必要はない。

    python build.py recipes/rocky_field_fixture.json

--keep-raw を付けると、後処理前の生成物を残す（プロンプトを詰め直すときに見比べられる）。
ComfyUIが起動している必要がある（README参照）。
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent


def run(script: str, args: list[str]) -> None:
    command = [sys.executable, str(HERE / script), *args]
    print("$", " ".join(command))
    subprocess.run(command, check=True, cwd=HERE)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("recipe")
    parser.add_argument("--keep-raw", metavar="DIR", help="後処理前の生成物を残すディレクトリ")
    parser.add_argument("--server", default="http://127.0.0.1:8188")
    args = parser.parse_args()

    recipe = json.loads(Path(args.recipe).read_text("utf-8"))
    post = recipe["postprocess"]
    output = REPO / recipe["output"]

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
                "--workflow", recipe.get("workflow", "lane_background.api.json"),
                "--server", args.server,
            ],
        )
        raw = raw_dir / f"{recipe['prompt']}_{recipe['seed']}.png"
        if not raw.exists():
            raise SystemExit(f"生成物が見つかりません: {raw}")

        # 後処理の設定は絵の隣ではなくレシピ側が持つので、書き出された .json は捨ててよい。
        processed = raw_dir / f"{raw.stem}_processed.png"
        run(
            "postprocess.py",
            [
                str(raw),
                "--out", str(processed),
                "--top", str(post["top"]),
                "--oilify-radius", str(post["oilifyRadius"]),
                "--oilify-levels", str(post["oilifyLevels"]),
            ],
        )

        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(processed.read_bytes())
        print(f"-> {output}")


if __name__ == "__main__":
    main()
