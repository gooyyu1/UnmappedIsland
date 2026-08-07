"""生成した紙のテクスチャから、スロットボタンの下地（slot_button_paper.png）を切り出す。

ボタンの地はカードと同じ紙に見えてほしい。だからといって**実行時にカードのテクスチャを使い回しては
いけない**——ボタンとカードは別の概念で、片方の都合（切り出しをフレームとして足す等）がもう片方の
描画を壊す。同じ生成物から切り出した、ボタン専用のPNGを持たせる。

    python button_paper.py paper.png --out slot_button_paper.png --at 37,40 --at 37,236 --at 37,432

**ボタンごとに別の場所を取る。** 同じ場所だと3つのボタンに同じ染みが並び、模様として目に付く。
切り出す大きさはボタンと同じ縦横比にしておく（引き伸ばすと紙の粒が一方向へ伸びる）。

出来上がりは切り出しを縦に積んだシートで、ゲーム側はスプライトシートとして読む。
紙の色合わせと染みの薄め方は card_frame.py と同じで、値もレシピで揃える。
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import numpy as np
from PIL import Image

from card_frame import CARD_HEIGHT, CARD_WIDTH, cover

# ボタンの絵の寸法（theme.ts の SIZE.slotButton の2倍。絵はuの2倍で描く約束）。
TILE_WIDTH = 336
TILE_HEIGHT = 168

AT_PATTERN = re.compile(r"^(\d+),(\d+)$")


def position(text: str) -> tuple[int, int]:
    matched = AT_PATTERN.match(text.strip())
    if matched is None:
        raise argparse.ArgumentTypeError(f"'{text}' は X,Y の形ではありません")
    return int(matched.group(1)), int(matched.group(2))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", help="紙のテクスチャの生成物（card_frame.json と同じもの）")
    parser.add_argument("--out", required=True)
    parser.add_argument("--at", type=position, action="append", required=True, metavar="X,Y",
                        help="切り出す左上の位置（410x640に均した紙の座標）。ボタンの数だけ重ねる")
    parser.add_argument("--width", type=int, default=TILE_WIDTH)
    parser.add_argument("--height", type=int, default=TILE_HEIGHT)
    parser.add_argument("--paper", default="#fcf8e6", help="紙の色を寄せる目標（#RRGGBB）")
    parser.add_argument("--wash", type=float, default=0.0, help="ムラを平均へ寄せる度合い（0〜1）")
    args = parser.parse_args()

    rgb = np.asarray(cover(Image.open(args.source).convert("RGB"), CARD_WIDTH, CARD_HEIGHT), dtype=np.float64)

    goal = np.array([int(args.paper.lstrip("#")[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)
    mean = rgb.reshape(-1, 3).mean(axis=0)
    rgb = np.clip(rgb * np.divide(goal, mean, out=np.ones(3), where=mean > 0), 0, 255)
    if args.wash > 0:
        rgb = rgb * (1 - args.wash) + goal * args.wash

    sheet = Image.new("RGB", (args.width, args.height * len(args.at)))
    for index, (x, y) in enumerate(args.at):
        if x + args.width > CARD_WIDTH or y + args.height > CARD_HEIGHT:
            raise SystemExit(f"切り出し({x},{y})が紙({CARD_WIDTH}x{CARD_HEIGHT})からはみ出します")
        tile = rgb[y : y + args.height, x : x + args.width]
        sheet.paste(Image.fromarray(tile.clip(0, 255).astype(np.uint8), "RGB"), (0, index * args.height))

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)

    settings = {
        "source": Path(args.source).name,
        "at": [list(at) for at in args.at],
        "width": args.width,
        "height": args.height,
        "paper": args.paper,
        "wash": args.wash,
    }
    out.with_suffix(".json").write_text(json.dumps(settings, ensure_ascii=False, indent=2), "utf-8")
    print(f"{out}  {sheet.width}x{sheet.height}  {len(args.at)}枚")


if __name__ == "__main__":
    main()
