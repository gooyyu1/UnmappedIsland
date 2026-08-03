"""生成した紙のテクスチャから、日時のフリップカードの絵（flip_digit.png）を組み立てる。

紙だけでなく、留具の穴・そこを通る金属リング・落ち影まで1枚に描き込む。静止した表示なので
実行時に図形を重ねるより焼き込むほうが描画が少なく、質感も出せる（card_frame.py と同じ考え方）。

    python flip_card.py paper.png --out flip_digit.png

使った設定は出力の隣へ .json として残す。
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

from card_frame import cover, rounded_mask

# 寸法（px、1u=2px）。紙の上にリングが伸びるぶんだけ、キャンバスは紙より背が高い。
# FlipCalendar.ts は紙の高さを桁の寸法に合わせて表示するので、PAPER_HEIGHT と OVERHEAD の比を
# 変えたらあちらの定数も揃えること（ずれるとリングが桁から浮く）。
WIDTH = 128
PAPER_HEIGHT = 176
OVERHEAD = 20
HEIGHT = OVERHEAD + PAPER_HEIGHT
MARGIN = 4
RADIUS = 12

# 留具。リングは紙の上端の少し上を中心とする輪で、下側の線が穴の上半分を通る。
# 線を穴の中心より上へ通すことで、穴の下側が開いて見える（中心を通すと穴がほぼ隠れて汚れに見えた）。
RING_X = (26, WIDTH - 26)
RING_CY = OVERHEAD + MARGIN - 6
RING_RADIUS = 14
RING_WIRE = 6
HOLE_CY = OVERHEAD + MARGIN + 12
HOLE_RADIUS = 8
# 穴の縁は内側へ暗く落とし、紙に厚みがあるように見せる。
HOLE_RIM = 2.5
HOLE_RIM_DARK = 0.22


def color(value: str) -> np.ndarray:
    return np.array([int(value.lstrip("#")[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", help="紙のテクスチャの生成物")
    parser.add_argument("--out", required=True)
    parser.add_argument("--paper", default="#fdfdfb", help="紙の色を寄せる目標（#RRGGBB）")
    parser.add_argument("--wash", type=float, default=0.4,
                        help="ムラを平均へ寄せる度合い（0〜1）。生成物の染みが強すぎるときに上げる")
    parser.add_argument("--edge", default="#b0aba0", help="縁の線の色")
    parser.add_argument("--edge-width", type=float, default=2, help="縁の線の太さ")
    parser.add_argument("--shadow-offset", type=int, nargs=2, metavar=("DX", "DY"), default=(0, 3),
                        help="影をずらす量（右・下）")
    parser.add_argument("--shadow-blur", type=float, default=1.0, help="影のぼかし")
    parser.add_argument("--shadow-alpha", type=float, default=0.85, help="影の濃さ（0〜1）")
    args = parser.parse_args()

    # 紙。目標の色へ寄せ、染みを薄める（card_frame.py と同じ手順）。
    paper = np.asarray(cover(Image.open(args.source).convert("RGB"), WIDTH, PAPER_HEIGHT), dtype=np.float64)
    goal = color(args.paper)
    mean = paper.reshape(-1, 3).mean(axis=0)
    paper = np.clip(paper * np.divide(goal, mean, out=np.ones(3), where=mean > 0), 0, 255)
    if args.wash > 0:
        paper = paper * (1 - args.wash) + goal * args.wash

    rgb = np.zeros((HEIGHT, WIDTH, 3), dtype=np.float64)
    rgb[OVERHEAD:] = paper
    alpha = np.vstack([np.zeros((OVERHEAD, WIDTH)), rounded_mask(WIDTH, PAPER_HEIGHT, MARGIN, RADIUS)])

    # 縁の線（マスクの内側だけに乗るよう、少し内側の角丸との差で描く）。
    if args.edge_width > 0:
        inner = np.vstack([
            np.zeros((OVERHEAD, WIDTH)),
            rounded_mask(WIDTH, PAPER_HEIGHT, MARGIN + round(args.edge_width), RADIUS),
        ])
        line = np.clip(alpha - inner, 0, 1)[:, :, None]
        rgb = rgb * (1 - line) + color(args.edge) * line

    yy, xx = np.mgrid[0:HEIGHT, 0:WIDTH].astype(np.float64)

    # 留具の穴。打ち抜いて、縁を内側へ暗く落とす。
    for cx in RING_X:
        distance = np.hypot(xx - cx, yy - HOLE_CY)
        alpha *= 1 - np.clip(HOLE_RADIUS + 0.5 - distance, 0, 1)
        rim = np.clip(1 - (distance - HOLE_RADIUS) / HOLE_RIM, 0, 1)
        rgb *= (1 - HOLE_RIM_DARK * rim)[:, :, None]

    # リング。上ほど明るい金属の輪として描き、紙の上へ重ねる（穴の中でも見える）。
    torus = np.zeros((HEIGHT, WIDTH))
    for cx in RING_X:
        distance = np.hypot(xx - cx, yy - RING_CY)
        torus = np.maximum(torus, np.clip(RING_WIRE / 2 + 0.5 - np.abs(distance - RING_RADIUS), 0, 1))
    shade = np.clip((yy - (RING_CY - RING_RADIUS)) / (2 * RING_RADIUS), 0, 1)
    metal = 200 - 125 * shade + 35 * np.clip(1 - np.abs(shade - 0.15) / 0.15, 0, 1)
    metal_rgb = np.dstack([metal, metal + 2, metal + 5])

    # リングが紙へ落とす小さな影。リング自身が覆う場所は後の合成で隠れる。
    contact = gaussian_filter(torus, sigma=1.0) * 0.22
    rgb *= (1 - contact)[:, :, None]

    merged = torus + alpha * (1 - torus)
    rgb = np.divide(
        metal_rgb * torus[:, :, None] + rgb * (alpha * (1 - torus))[:, :, None],
        merged[:, :, None],
        out=np.zeros_like(rgb),
        where=merged[:, :, None] > 0,
    )
    alpha = merged

    # 落ち影（card_frame.py と同じ合成）。狭く濃くして、ぶら下がったカードの浮きを出す。
    if args.shadow_alpha > 0:
        dx, dy = args.shadow_offset
        shadow = gaussian_filter(np.roll(alpha, (dy, dx), axis=(0, 1)), sigma=args.shadow_blur)
        shadow = np.clip(shadow * args.shadow_alpha * (1 - alpha), 0, 1)
        merged = alpha + shadow
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
        "shadowOffset": args.shadow_offset,
        "shadowBlur": args.shadow_blur,
        "shadowAlpha": args.shadow_alpha,
    }
    out.with_suffix(".json").write_text(json.dumps(settings, ensure_ascii=False, indent=2), "utf-8")
    print(f"{out}  {WIDTH}x{HEIGHT}  紙{WIDTH}x{PAPER_HEIGHT} リングの余白{OVERHEAD}")


if __name__ == "__main__":
    main()
