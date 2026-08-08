"""生成した紙のテクスチャから、スロットボタンの下地（slot_button_paper.png）を切り出す。

ボタンの地はカードと同じ紙に見えてほしい。だからといって**実行時にカードのテクスチャを使い回しては
いけない**——ボタンとカードは別の概念で、片方の都合（切り出しをフレームとして足す等）がもう片方の
描画を壊す。同じ生成物から切り出した、ボタン専用のPNGを持たせる。

    python button_paper.py paper.png --out slot_button_paper.png \
        --at 37,40 --tint "#c2cdd8" --at 37,236 --tint "#c7d4c1" --at 37,432 --tint "#d7c2b5"

**ボタンごとに別の場所を取る。** 同じ場所だと3つのボタンに同じ染みが並び、模様として目に付く。
切り出す大きさはボタンと同じ縦横比にしておく（引き伸ばすと紙の粒が一方向へ伸びる）。

**染めと角丸は絵に焼く。** カードの枠（card_frame.py）と同じ扱いで、ゲーム側は敷くだけにする
（実行時の乗算・切り抜きはWebGL専用で、WebGLの無い環境では色も角丸も消える）。

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

from card_frame import CARD_HEIGHT, CARD_WIDTH, cover, rounded_mask

# ボタンの絵の寸法と角丸（theme.ts の SIZE.slotButton / SIZE.radius の2倍。絵はuの2倍で描く約束）。
TILE_WIDTH = 336
TILE_HEIGHT = 168
RADIUS = 24

AT_PATTERN = re.compile(r"^(\d+),(\d+)$")


def position(text: str) -> tuple[int, int]:
    matched = AT_PATTERN.match(text.strip())
    if matched is None:
        raise argparse.ArgumentTypeError(f"'{text}' は X,Y の形ではありません")
    return int(matched.group(1)), int(matched.group(2))


def rgb_of(text: str) -> np.ndarray:
    return np.array([int(text.lstrip("#")[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", help="紙のテクスチャの生成物（card_frame.json と同じもの）")
    parser.add_argument("--out", required=True)
    parser.add_argument("--at", type=position, action="append", required=True, metavar="X,Y",
                        help="切り出す左上の位置（410x640に均した紙の座標）。ボタンの数だけ重ねる")
    parser.add_argument("--tint", action="append", metavar="#RRGGBB",
                        help="タイルへ乗算する色（染めた紙）。--at と同じ数だけ、同じ順で並べる")
    parser.add_argument("--width", type=int, default=TILE_WIDTH)
    parser.add_argument("--height", type=int, default=TILE_HEIGHT)
    parser.add_argument("--radius", type=int, default=RADIUS, help="角丸の半径（0で角丸なし）")
    parser.add_argument("--paper", default="#fcf8e6", help="紙の色を寄せる目標（#RRGGBB）")
    parser.add_argument("--wash", type=float, default=0.0, help="ムラを平均へ寄せる度合い（0〜1）")
    args = parser.parse_args()

    tints = args.tint or []
    if tints and len(tints) != len(args.at):
        raise SystemExit(f"--tint は {len(args.at)} 個（--at と同じ数）必要です")

    rgb = np.asarray(cover(Image.open(args.source).convert("RGB"), CARD_WIDTH, CARD_HEIGHT), dtype=np.float64)

    goal = rgb_of(args.paper)
    mean = rgb.reshape(-1, 3).mean(axis=0)
    rgb = np.clip(rgb * np.divide(goal, mean, out=np.ones(3), where=mean > 0), 0, 255)
    if args.wash > 0:
        rgb = rgb * (1 - args.wash) + goal * args.wash

    alpha = rounded_mask(args.width, args.height, 0, args.radius) * 255

    sheet = Image.new("RGBA", (args.width, args.height * len(args.at)))
    for index, (x, y) in enumerate(args.at):
        if x + args.width > CARD_WIDTH or y + args.height > CARD_HEIGHT:
            raise SystemExit(f"切り出し({x},{y})が紙({CARD_WIDTH}x{CARD_HEIGHT})からはみ出します")
        tile = rgb[y : y + args.height, x : x + args.width]
        # 染めはゲーム側の乗算（Phaserの既定のtintMode）と同じ式。焼いても見え方が変わらない。
        if tints:
            tile = tile * rgb_of(tints[index]) / 255
        tile = Image.fromarray(np.dstack([tile, alpha]).clip(0, 255).astype(np.uint8), "RGBA")
        sheet.paste(tile, (0, index * args.height))

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)

    settings = {
        "source": Path(args.source).name,
        "at": [list(at) for at in args.at],
        "tint": tints,
        "width": args.width,
        "height": args.height,
        "radius": args.radius,
        "paper": args.paper,
        "wash": args.wash,
    }
    out.with_suffix(".json").write_text(json.dumps(settings, ensure_ascii=False, indent=2), "utf-8")
    print(f"{out}  {sheet.width}x{sheet.height}  {len(args.at)}枚  角丸{args.radius}")


if __name__ == "__main__":
    main()
