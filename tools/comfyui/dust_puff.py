"""砂埃の粒を1枚描く（💭 の形を借りて、色と縁を作り直す）。

    python dust_puff.py --out dust_puff.png --size 192 --colour #cbbca4

**形は絵文字から借りる。** もくもくした塊は生成でも編集でも安定して出ない（雲か煙になり、粒として
散らすには輪郭が読めない）。💭 は輪郭が定まっていて小さくても塊に見えるので、形だけを借りる。

借りるのは**いちばん大きい連結成分だけ**——吹き出しの付け根（小さい丸）は別の成分なので、これで落ちる。
色は絵文字のもの（淡い藤色）を使わず、塗り直す。埃は色そのものが意味なので、借りるのは形だけでよい。

**縁は暈して、中心を明るくする。** 平らに塗ると紙を切り抜いた札に見え、散らしても埃にならない。
縁の暈しは輪郭の凹凸が読める程度に留める（強くかけると丸い玉になる）。

PIL が要る。絵文字のフォントは Windows 同梱の Segoe UI Emoji（COLR/CPAL）を使う。
"""

from __future__ import annotations

import argparse

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

EMOJI_FONT = "C:/Windows/Fonts/seguiemj.ttf"
# Segoe UI Emojiのカラーグリフはこの大きさでしか出ない（icon_mark.py と同じ制約）。
EMOJI_RENDER_SIZE = 109

PUFF = "\U0001f4ad"


def balloon_silhouette() -> Image.Image:
    """💭 の輪郭（8bitのマスク）。付け根の小さい丸は落とす。"""
    font = ImageFont.truetype(EMOJI_FONT, EMOJI_RENDER_SIZE)
    canvas = Image.new("RGBA", (EMOJI_RENDER_SIZE * 2, EMOJI_RENDER_SIZE * 2), (0, 0, 0, 0))
    ImageDraw.Draw(canvas).text(
        (EMOJI_RENDER_SIZE // 2, EMOJI_RENDER_SIZE // 2), PUFF, font=font, embedded_color=True
    )
    box = canvas.getbbox()
    if box is None:
        raise SystemExit(f"'{PUFF}' が描けない。フォントがこの絵文字を持っていない")

    alpha = np.asarray(canvas.crop(box), dtype=np.uint8)[:, :, 3]
    return Image.fromarray(largest_component(alpha > 8) * alpha, "L")


def largest_component(solid: np.ndarray) -> np.ndarray:
    """いちばん大きい連結成分（4近傍）だけを立てた真偽の面を返す。"""
    height, width = solid.shape
    label = np.zeros((height, width), dtype=np.int32)
    sizes = [0]
    for y in range(height):
        for x in range(width):
            if not solid[y, x] or label[y, x]:
                continue
            sizes.append(0)
            stack = [(y, x)]
            label[y, x] = len(sizes) - 1
            while stack:
                cy, cx = stack.pop()
                sizes[-1] += 1
                for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                    if 0 <= ny < height and 0 <= nx < width and solid[ny, nx] and not label[ny, nx]:
                        label[ny, nx] = len(sizes) - 1
                        stack.append((ny, nx))
    return (label == int(np.argmax(sizes))).astype(np.uint8)


def square(mask: Image.Image, size: int, margin: float) -> np.ndarray:
    """縦横比を保ったまま正方形の真ん中へ収め、0〜1の面として返す。marginは暈しの逃げ場。"""
    inner = round(size * (1 - margin * 2))
    scale = inner / max(mask.size)
    resized = mask.resize((round(mask.width * scale), round(mask.height * scale)), Image.LANCZOS)
    canvas = Image.new("L", (size, size), 0)
    canvas.paste(resized, ((size - resized.width) // 2, (size - resized.height) // 2))
    return np.asarray(canvas, dtype=np.float64) / 255


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True)
    parser.add_argument("--size", type=int, default=192, help="書き出す正方形の一辺（px）")
    parser.add_argument("--colour", default="#cbbca4", help="埃の色（縁の側の色）")
    parser.add_argument("--lit", default="#ece2cf", help="中心の色（光が回っている側）")
    parser.add_argument("--opacity", type=float, default=0.95, help="いちばん濃いところの不透明度")
    parser.add_argument("--feather", type=float, default=0.035, help="縁の暈し（一辺に対する比）")
    parser.add_argument("--core", type=float, default=0.16, help="中心の明るみの広さ（一辺に対する比）")
    args = parser.parse_args()

    shape = square(balloon_silhouette(), args.size, margin=args.feather * 2.5)
    blurred = Image.fromarray((shape * 255).astype(np.uint8), "L")
    alpha = np.asarray(
        blurred.filter(ImageFilter.GaussianBlur(args.size * args.feather)), dtype=np.float64
    ) / 255
    # 中心の明るみは、輪郭を強く暈したもの——塊の真ん中ほど深いので、そのまま光の回り方になる。
    core = np.asarray(
        blurred.filter(ImageFilter.GaussianBlur(args.size * args.core)), dtype=np.float64
    ) / 255

    edge = np.array(Image.new("RGB", (1, 1), args.colour).getpixel((0, 0)), dtype=np.float64)
    lit = np.array(Image.new("RGB", (1, 1), args.lit).getpixel((0, 0)), dtype=np.float64)
    rgb = edge + (lit - edge) * core[:, :, None]

    out = np.dstack([rgb, alpha * args.opacity * 255])
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA").save(args.out)
    print(f"-> {args.out}", flush=True)


if __name__ == "__main__":
    main()
