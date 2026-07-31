"""生成した紙のテクスチャから、カードの枠（card_frame.png）を組み立てる。

カードの枠は「角丸の紙」でしかないが、角丸の半径と余白は card_art.py の定数と一致していなければ
ならない（絵が枠からはみ出す）。生成では保証できないので、**紙だけ生成させて形はここで作る**。

直接カードとして生成するのは無理だった。「playing card」と言うとトランプの絵札になり、外すと今度は
カードの形が消えて水彩の滲みだけになる（12枚で全滅）。一方、紙のテクスチャは安定して出る。

    python card_frame.py paper.png --out card_frame.png

使った設定は出力の隣へ .json として残す。
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter

# 出来上がりの寸法と、紙が占める範囲（card_art.py の PAPER_MARGIN / PAPER_RADIUS、
# および Card.ts の FRAME_INSET / FRAME_RADIUS と揃っていなければならない）。
CARD_WIDTH = 410
CARD_HEIGHT = 640
MARGIN = 5
RADIUS = 32
# 角丸の縁を滑らかにするための倍率。この倍で描いてから縮める。
SUPERSAMPLE = 4


def cover(image: Image.Image, width: int, height: int) -> Image.Image:
    """縦横比を保ったまま、指定の寸法を覆うよう拡大縮小して中央で切り出す。"""
    scale = max(width / image.width, height / image.height)
    resized = image.resize((round(image.width * scale), round(image.height * scale)), Image.LANCZOS)
    left = (resized.width - width) // 2
    top = (resized.height - height) // 2
    return resized.crop((left, top, left + width, top + height))


def rounded_mask(width: int, height: int, margin: int, radius: int) -> np.ndarray:
    """角丸のマスク。拡大して描いてから縮めることで、縁の階段を消す。"""
    big = Image.new("L", (width * SUPERSAMPLE, height * SUPERSAMPLE), 0)
    ImageDraw.Draw(big).rounded_rectangle(
        [
            margin * SUPERSAMPLE,
            margin * SUPERSAMPLE,
            (width - margin) * SUPERSAMPLE - 1,
            (height - margin) * SUPERSAMPLE - 1,
        ],
        radius=radius * SUPERSAMPLE,
        fill=255,
    )
    return np.asarray(big.resize((width, height), Image.BOX), dtype=np.float64) / 255.0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", help="紙のテクスチャの生成物")
    parser.add_argument("--out", required=True)
    parser.add_argument("--paper", default="#fcf8e6", help="紙の色を寄せる目標（#RRGGBB）")
    parser.add_argument("--wash", type=float, default=0.0,
                        help="ムラを平均へ寄せる度合い（0〜1）。生成物の染みが強すぎるときに上げる")
    parser.add_argument("--edge", default="#9c8862", help="縁の線の色")
    parser.add_argument("--edge-width", type=float, default=1.5, help="縁の線の太さ")
    parser.add_argument("--margin", type=int, default=MARGIN)
    parser.add_argument("--radius", type=int, default=RADIUS)
    # 影を置けるのは余白の5pxだけ。広く薄く散らすと見えなくなるので、狭く濃くする。
    parser.add_argument("--shadow-offset", type=int, nargs=2, metavar=("DX", "DY"), default=(2, 2),
                        help="影をずらす量（右・下）")
    parser.add_argument("--shadow-blur", type=float, default=1.6, help="影のぼかし")
    parser.add_argument("--shadow-alpha", type=float, default=0.7, help="影の濃さ（0〜1）")
    args = parser.parse_args()

    rgb = np.asarray(cover(Image.open(args.source).convert("RGB"), CARD_WIDTH, CARD_HEIGHT), dtype=np.float64)

    # 生成された紙は濃いので、目標の色へ寄せる。全面が紙なので、平均を合わせるだけでよい。
    goal = np.array([int(args.paper.lstrip("#")[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)
    mean = rgb.reshape(-1, 3).mean(axis=0)
    rgb = np.clip(rgb * np.divide(goal, mean, out=np.ones(3), where=mean > 0), 0, 255)
    # 生成物の染みは、カードの下地としては強すぎることがある。平均へ寄せて薄める。
    if args.wash > 0:
        rgb = rgb * (1 - args.wash) + goal * args.wash

    alpha = rounded_mask(CARD_WIDTH, CARD_HEIGHT, args.margin, args.radius)

    # 縁の線は、マスクの内側だけに乗るよう、少し内側の角丸との差で描く。
    if args.edge_width > 0:
        inner = rounded_mask(CARD_WIDTH, CARD_HEIGHT, args.margin + round(args.edge_width), args.radius)
        line = np.clip(alpha - inner, 0, 1)[:, :, None]
        edge = np.array([int(args.edge.lstrip("#")[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)
        rgb = rgb * (1 - line) + edge * line

    # 影は絵に描き込む。カードを回すような動きは無いので、別に描くと描画が増えるだけになる。
    if args.shadow_alpha > 0:
        dx, dy = args.shadow_offset
        shadow = gaussian_filter(np.roll(alpha, (dy, dx), axis=(0, 1)), sigma=args.shadow_blur)
        shadow = np.clip(shadow * args.shadow_alpha * (1 - alpha), 0, 1)
        merged = alpha + shadow
        # 影は黒なので、合成後の色はカードの色をカードの不透明度で割ったものになる。
        rgb = rgb * np.divide(alpha, merged, out=np.zeros_like(alpha), where=merged > 0)[:, :, None]
        alpha = merged

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.dstack([rgb, alpha * 255]).clip(0, 255).astype(np.uint8), "RGBA").save(out)

    settings = {
        "source": Path(args.source).name,
        "paper": args.paper,
        "wash": args.wash,
        "edge": args.edge,
        "edgeWidth": args.edge_width,
        "margin": args.margin,
        "radius": args.radius,
        "shadowOffset": args.shadow_offset,
        "shadowBlur": args.shadow_blur,
        "shadowAlpha": args.shadow_alpha,
    }
    out.with_suffix(".json").write_text(json.dumps(settings, ensure_ascii=False, indent=2), "utf-8")
    print(f"{out}  {CARD_WIDTH}x{CARD_HEIGHT}  余白{args.margin} 角丸{args.radius}")


if __name__ == "__main__":
    main()
