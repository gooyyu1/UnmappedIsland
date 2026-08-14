"""レシピ1つから、絵を1枚作り直す（生成 → 後処理）。

同じ絵をもう一度得るために必要な値は、すべて recipes/*.json に入っている。作り直したいときは
このスクリプトを走らせるだけでよく、手順を覚えている必要はない。

    python build.py recipes/rocky_field_fixtures_lane.json

後処理はレシピが postprocess を持つならレーンの背景として（postprocess.py）、cardArt を持つなら
カードの絵として（card_art.py）扱う。mark があれば、その後に絵文字の形を色替えして重ね
（icon_mark.py）、tint があれば陰影を残したまま一部の色を寄せる（skin_tint.py）。
edit を持つレシピは、生成の代わりに別レシピの生データを
基準にした Qwen Image Edit で生データを作る（README「既存の絵からの派生」節）。stain を持つレシピは
生成も後処理もせず、乗算で載る染みの層を描くだけ（skin_tint.py --layer）。puff も同じく描くだけで、
砂埃の粒を1枚出す（dust_puff.py）。

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


def echo(text: str) -> None:
    """コンソールの文字コードで出せない文字があっても落ちないように出す。

    Windowsの既定はcp932で、絵文字（icon_mark.pyへ渡す形）を出そうとするとUnicodeEncodeErrorに
    なる。**落ちるのは実行ではなく、実行したコマンドを見せる行**なので、出せない文字は潰してよい。
    """
    encoding = sys.stdout.encoding or "utf-8"
    print(text.encode(encoding, "replace").decode(encoding), flush=True)


def run(script: str, args: list[str]) -> None:
    command = [sys.executable, str(HERE / script), *args]
    echo("$ " + " ".join(command))
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


def base_workflow(recipe: dict, recipes_dir: Path) -> str | None:
    """editの連鎖を根まで辿り、生成に使うワークフロー名を返す。生成しないレシピではNone。"""
    while "edit" in recipe:
        source = recipe["edit"].get("source")
        if source is None:
            recipe = {k: v for k, v in recipe.items() if k != "edit"}
            break
        recipe = json.loads((recipes_dir / source).read_text("utf-8"))
    return recipe.get("workflow")


def produce_raw(recipe: dict, recipes_dir: Path, raw_dir: Path, server: str) -> Path:
    """レシピの生データ（後処理前の絵）を作り、そのパスを返す。

    edit を持つレシピは基準の生データを先に作り、それを Qwen Image Edit で派生させる
    （実 → 皮を剥いだ実 → … のような連鎖はここの再帰で解決される）。基準は source が指す別レシピで、
    source を持たない edit は同じレシピの edit を外したもの——つまり自分の paint / 生成——を指す。

    paint を持つレシピは、生成の代わりに sky_art.py で下地を描く。glyph を持つレシピは絵文字を
    白い紙へ描く（emoji_page.py）。どちらも edit と組み合わせると、描いたものが Qwen の下絵になる。
    """
    edit = recipe.get("edit")
    if edit is not None:
        source = (
            json.loads((recipes_dir / edit["source"]).read_text("utf-8"))
            if edit.get("source")
            else {k: v for k, v in recipe.items() if k != "edit"}
        )
        source_raw = produce_raw(source, recipes_dir, raw_dir, server)
        edited = raw_dir / f"{Path(recipe['output']).stem}_edit_{edit['seed']}.png"
        run(
            "qwen_edit.py",
            [
                str(source_raw),
                "--out", str(edited),
                "--prompt", edit["prompt"],
                "--seed", str(edit["seed"]),
                "--server", server,
            ],
        )
        return edited

    under = recipe.get("underlay")
    if under is not None:
        cut = raw_dir / f"{Path(recipe['output']).stem}_underlay.png"
        run(
            "multiply_layer.py",
            [
                "underlay",
                str(REPO / under["ground"]),
                str(REPO / under["layer"]),
                "--out", str(cut),
            ],
        )
        return cut

    stain = recipe.get("stain")
    if stain is not None:
        drawn = raw_dir / f"{Path(recipe['output']).stem}_stain.png"
        run(
            "skin_tint.py",
            [
                "--layer", stain["size"],
                "--out", str(drawn),
                *[str(v) for spot in stain.get("spots", []) for v in ("--spot", spot)],
                *[str(v) for line in stain.get("slashes", []) for v in ("--slash", line)],
            ],
        )
        # groundを持つレシピでは、描いたものは下絵。地に載せてQwenへ渡し、後で同じ地で割る。
        if recipe.get("ground") is None:
            return drawn
        on_ground = raw_dir / f"{Path(recipe['output']).stem}_on_ground.png"
        run(
            "multiply_layer.py",
            ["apply", str(REPO / recipe["ground"]), str(drawn), "--out", str(on_ground)],
        )
        return on_ground

    puff = recipe.get("puff")
    if puff is not None:
        grain = raw_dir / f"{Path(recipe['output']).stem}_puff.png"
        run(
            "dust_puff.py",
            [
                "--out", str(grain),
                "--size", str(puff["size"]),
                "--colour", puff["colour"],
                "--lit", puff["lit"],
                "--feather", str(puff["feather"]),
                "--core", str(puff["core"]),
                *(["--opacity", str(puff["opacity"])] if "opacity" in puff else []),
            ],
        )
        return grain

    glyph = recipe.get("glyph")
    if glyph is not None:
        drawn = raw_dir / f"{Path(recipe['output']).stem}_glyph.png"
        run(
            "emoji_page.py",
            [
                "--out", str(drawn),
                "--emoji", glyph["emoji"],
                "--page", str(glyph["page"]),
                "--size", str(glyph["size"]),
            ],
        )
        return drawn

    paint = recipe.get("paint")
    if paint is not None:
        painted = raw_dir / f"{Path(recipe['output']).stem}_base.png"
        run(
            "sky_art.py",
            [
                "--out", str(painted),
                "--size", *map(str, paint["size"]),
                *[str(v) for stop in paint["stops"] for v in ("--stop", stop)],
                *(["--glow", ",".join(map(str, paint["glow"]))] if paint.get("glow") else []),
                *(["--glow-color", paint["glowColor"]] if paint.get("glowColor") else []),
                *(["--rays", ",".join(map(str, paint["rays"]))] if paint.get("rays") else []),
                # 0は「中心を埋めない」という指定なので、getの真偽で見てはいけない。
                *(["--core", str(paint["core"])] if "core" in paint else []),
                *(["--noise", str(paint["noise"])] if "noise" in paint else []),
                *(["--seed", str(paint["seed"])] if "seed" in paint else []),
            ],
        )
        return painted

    run(
        "generate.py",
        [
            recipe["prompt"],
            "--out", str(raw_dir),
            "--seed", str(recipe["seed"]),
            "--width", str(recipe["width"]),
            "--height", str(recipe["height"]),
            "--workflow", recipe["workflow"],
            *(["--prompts", recipe["prompts"]] if recipe.get("prompts") else []),
            *(["--lora", recipe["lora"]] if recipe.get("lora") else []),
            # 0は「LoRAを効かせない」という指定なので、getの真偽で見てはいけない。
            *(["--lora-strength", str(recipe["loraStrength"])] if "loraStrength" in recipe else []),
            *(["--no-trigger"] if recipe.get("noTrigger") else []),
            "--server", server,
        ],
    )
    raw = raw_dir / f"{recipe['prompt']}_{recipe['seed']}.png"
    if not raw.exists():
        raise SystemExit(f"生成物が見つかりません: {raw}")
    return raw


def ensure_fresh_process(workflow: str | None, server: str) -> None:
    """タイリングを使う生成と使わない生成が同じプロセスに混ざらないようにする。

    パディングの差し替えは掛けたぶんを戻しているが、それでも完全には元へ戻らない（実測で、
    タイリングを挟むと後続の生成が平均1.94ずれる。挟まなければ差は0）。絵としては同じでも
    レシピから同じPNGが得られなくなるので、種類が変わる境目でプロセスごと作り直す。

    SDXLの生成を含まないレシピ（paintだけを基準にするもの）はパディングに触れないので、
    種類の判定から外す。
    """
    if workflow is None:
        return
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

    recipe_path = Path(args.recipe)
    recipe = json.loads(recipe_path.read_text("utf-8"))
    recipes_dir = recipe_path.resolve().parent
    output = REPO / recipe["output"]
    ensure_fresh_process(base_workflow(recipe, recipes_dir), args.server)

    with tempfile.TemporaryDirectory() as tmp:
        raw_dir = Path(args.keep_raw) if args.keep_raw else Path(tmp)
        raw_dir.mkdir(parents=True, exist_ok=True)
        raw = produce_raw(recipe, recipes_dir, raw_dir, args.server)

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
                    *(["--canvas", *map(str, card["canvas"])] if card.get("canvas") else []),
                    *(["--crop", *map(str, card["crop"])] if card.get("crop") else []),
                    *(["--diagonal"] if card.get("diagonal") else []),
                    *(["--below-plate"] if card.get("belowPlate") else []),
                    *(["--oilify", *map(str, card["oilify"])] if card.get("oilify") else []),
                    *(["--tolerance", str(card["tolerance"])] if "tolerance" in card else []),
                    *(["--edge", str(card["edge"])] if "edge" in card else []),
                    *(["--shadow", str(card["shadow"])] if "shadow" in card else []),
                    *(["--reach", str(card["reach"])] if "reach" in card else []),
                    *(["--neutral-shadow", str(card["neutralShadow"])] if "neutralShadow" in card else []),
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
                    "--paper", frame["paper"],
                    "--wash", str(frame["wash"]),
                    "--edge", frame["edge"],
                    "--edge-width", str(frame["edgeWidth"]),
                    "--shadow-offset", *map(str, frame["shadowOffset"]),
                    "--shadow-blur", str(frame["shadowBlur"]),
                    "--shadow-alpha", str(frame["shadowAlpha"]),
                ],
            )
        elif "buttonPaper" in recipe:
            paper = recipe["buttonPaper"]
            run(
                "button_paper.py",
                [
                    str(raw),
                    "--out", str(processed),
                    *[str(v) for at in paper["at"] for v in ("--at", at)],
                    *[str(v) for tint in paper.get("tint", []) for v in ("--tint", tint)],
                    *(["--radius", str(paper["radius"])] if "radius" in paper else []),
                    "--paper", paper["paper"],
                    "--wash", str(paper["wash"]),
                ],
            )
        elif "flipCard" in recipe:
            flip = recipe["flipCard"]
            run(
                "flip_card.py",
                [
                    str(raw),
                    "--out", str(processed),
                    "--paper", flip["paper"],
                    "--wash", str(flip["wash"]),
                    "--edge", flip["edge"],
                    "--edge-width", str(flip["edgeWidth"]),
                    "--shadow-offset", *map(str, flip["shadowOffset"]),
                    "--shadow-blur", str(flip["shadowBlur"]),
                    "--shadow-alpha", str(flip["shadowAlpha"]),
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
        elif "ground" in recipe:
            # 地の上で描き直させたものは、同じ地で割って層へ戻す。
            run(
                "multiply_layer.py",
                ["extract", str(REPO / recipe["ground"]), str(raw), "--out", str(processed)],
            )
        elif "postprocess" not in recipe:
            # 後処理の要らないレシピ（染みの層は、描いた時点で出来上がっている）。
            processed = raw
        else:
            post = recipe["postprocess"]
            run(
                "postprocess.py",
                [
                    str(raw),
                    "--out", str(processed),
                    *(["--crop", *map(str, post["crop"])] if post.get("crop") else []),
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

        # 印（icon_mark.py）は切り出しの後。透過した絵の上へ重ねるので、順番を逆にすると
        # 紙・物・影の分離が印まで拾ってしまう。
        mark = recipe.get("mark")
        if mark is not None:
            run(
                "icon_mark.py",
                [
                    str(processed),
                    "--out", str(processed),
                    "--emoji", mark["emoji"],
                    "--size", str(mark["size"]),
                    "--at", *map(str, mark["at"]),
                    *(["--hue", str(mark["hue"])] if "hue" in mark else []),
                    *(["--saturation", str(mark["saturation"])] if "saturation" in mark else []),
                    *(["--value", str(mark["value"])] if "value" in mark else []),
                    *(["--shift", str(mark["shift"])] if "shift" in mark else []),
                    *(["--opacity", str(mark["opacity"])] if "opacity" in mark else []),
                ],
            )

        # 染み（skin_tint.py）も切り出しの後。切り出しは紙より暗い塊を物と見なすので、先に色を
        # 沈めると輪郭の判定が変わってしまう。
        tint = recipe.get("tint")
        if tint is not None:
            run(
                "skin_tint.py",
                [
                    str(processed),
                    "--out", str(processed),
                    *[str(v) for spot in tint["spots"] for v in ("--spot", spot)],
                ],
            )

        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(processed.read_bytes())
        print(f"-> {output}", flush=True)


if __name__ == "__main__":
    main()
